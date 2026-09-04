import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { platformToContinent } from "@/lib/riot";
import { QUEST_TYPES } from "@/lib/quests";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const RIOT_REQUEST_DELAY_MS = Number(process.env.RIOT_API_REQUEST_DELAY_MS) || 100;
const RANKED_SOLO_QUEUE_ID = 420;
const RIOT_FETCH_MAX_ATTEMPTS = 2;
const MAX_RETRY_AFTER_SECONDS = 3;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function riotFetch(url: string, apiKey: string, attempt = 1): Promise<Response> {
  const res = await fetch(url, { headers: { "X-Riot-Token": apiKey }, cache: "no-store" });
  if (res.status !== 429 || attempt >= RIOT_FETCH_MAX_ATTEMPTS) return res;

  const retryAfterHeader = Number(res.headers.get("Retry-After"));
  const retryAfterSeconds = Math.min(
    Number.isFinite(retryAfterHeader) && retryAfterHeader > 0 ? retryAfterHeader : 2,
    MAX_RETRY_AFTER_SECONDS,
  );
  await sleep(retryAfterSeconds * 1000 + 250);

  return riotFetch(url, apiKey, attempt + 1);
}

interface ResetResult {
  nombre_display: string;
  estado: string;
  /** Match id de Riot en el que quedó parado el cursor (null = sin ninguna partida ranked en su historial, arranca de cero de verdad). */
  cursor_nuevo: string | null;
}

/**
 * Uso único y manual (no es un cron): reinicia mangos + progreso de
 * misiones de los participantes indicados por nombre, y — a diferencia de
 * poner last_processed_match_id en null a mano por SQL — deja el cursor de
 * misiones parado en su ÚLTIMA partida ranked REAL en Riot en este mismo
 * momento, no en null.
 *
 * Por qué hace falta esto y no alcanza con SQL: un cursor en null le dice
 * al motor de misiones (findNewMatchIds en /api/update-rankings) "primera
 * vez que veo a este participante, tomá TODA la ventana reciente
 * (MATCH_HISTORY_WINDOW, 20 partidas) como nueva" — un backfill pensado
 * para un participante genuinamente nuevo. El problema real reportado: en
 * un reinicio de temporada, varios participantes siguen jugando con LA
 * MISMA cuenta de Riot que ya tenían antes del reinicio — un cursor en
 * null hace que el motor evalúe sus últimas ~20 partidas REALES (jugadas
 * antes del reinicio, con victorias/KDA de verdad) como si fueran nuevas,
 * y les otorga mangos sin que hayan jugado nada después del reinicio (bug
 * reportado, mismo patrón que el caso de Anthony). Parar el cursor en la
 * partida más reciente ACTUAL evita este backfill por completo: solo una
 * partida jugada DESPUÉS de este momento cuenta como nueva.
 *
 * Query param: `?nombre=Nombre1,Nombre2,...` (nombre_display, sin
 * distinguir mayúsculas) — obligatorio, no corre para todos sin filtro a
 * propósito (esto es destructivo: borra mangos).
 */
export async function GET(request: Request) {
  if (!(await isAdminAuthenticated(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const riotApiKey = process.env.RIOT_API_KEY;
  if (!riotApiKey) {
    return NextResponse.json({ error: "RIOT_API_KEY no está configurada" }, { status: 500 });
  }

  const url = new URL(request.url);
  const nombresParam = url.searchParams.get("nombre");
  if (!nombresParam) {
    return NextResponse.json(
      { error: "Falta ?nombre=Nombre1,Nombre2,... (obligatorio, no corre para todos sin filtro)" },
      { status: 400 },
    );
  }
  const nombresFilter = new Set(
    nombresParam.split(",").map((n) => n.trim().toLowerCase()).filter(Boolean),
  );

  const supabase = createAdminClient();
  const { data: allParticipants, error } = await supabase
    .from("participants")
    .select("id, puuid, region_platform, nombre_display");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const participants = (allParticipants ?? []).filter((p) =>
    nombresFilter.has(p.nombre_display.toLowerCase()),
  );
  const foundNames = new Set(participants.map((p) => p.nombre_display.toLowerCase()));
  const notFound = [...nombresFilter].filter((n) => !foundNames.has(n));

  const results: ResetResult[] = [];

  for (const participant of participants) {
    try {
      // 1. Borrar mangos conectados a este participante (dueño o remitente)
      // y los castigos que generaron — mismo criterio que la limpieza
      // manual anterior, ver la conversación: un mango nacido de una
      // misión fantasma no debería quedar ni en inventario ni como castigo
      // ya entregado a otra persona.
      const { data: relatedMangos } = await supabase
        .from("mangos")
        .select("id")
        .or(`owner_participant_id.eq.${participant.id},sent_by_participant_id.eq.${participant.id}`);
      const relatedMangoIds = (relatedMangos ?? []).map((m) => m.id);

      if (relatedMangoIds.length > 0) {
        const { error: penaltyDeleteError } = await supabase
          .from("penalty_progress")
          .delete()
          .in("mango_id", relatedMangoIds);
        if (penaltyDeleteError) throw penaltyDeleteError;

        const { error: mangoDeleteError } = await supabase
          .from("mangos")
          .delete()
          .in("id", relatedMangoIds);
        if (mangoDeleteError) throw mangoDeleteError;
      }

      // 2. Última partida ranked REAL de este participante, ahora mismo —
      // el nuevo cursor. Sin ninguna partida ranked todavía, se deja en
      // null (no hay nada que backfillear, arranca de cero de verdad).
      const continent = platformToContinent(participant.region_platform);
      let latestMatchId: string | null = null;
      if (continent) {
        const idsRes = await riotFetch(
          `https://${continent}.api.riotgames.com/lol/match/v5/matches/by-puuid/${participant.puuid}/ids?start=0&count=1&queue=${RANKED_SOLO_QUEUE_ID}`,
          riotApiKey,
        );
        await sleep(RIOT_REQUEST_DELAY_MS);
        if (idsRes.ok) {
          const ids = (await idsRes.json()) as string[];
          latestMatchId = ids[0] ?? null;
        }
      }

      // 3. Progreso de las 5 misiones a 0, cursor parado en la partida de
      // arriba (NO null) — evita el backfill del punto 2 de este mismo
      // comentario de arriba.
      const { error: questUpdateError } = await supabase
        .from("quest_progress")
        .update({ current_progress: 0, last_processed_match_id: latestMatchId })
        .eq("participant_id", participant.id)
        .in("quest_type", QUEST_TYPES);
      if (questUpdateError) throw questUpdateError;

      results.push({
        nombre_display: participant.nombre_display,
        estado: "ok",
        cursor_nuevo: latestMatchId,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`reset-quests falló para ${participant.nombre_display}:`, message);
      results.push({
        nombre_display: participant.nombre_display,
        estado: `error: ${message}`,
        cursor_nuevo: null,
      });
    }
  }

  return NextResponse.json({ ok: true, procesados: results.length, no_encontrados: notFound, results });
}

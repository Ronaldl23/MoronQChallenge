import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { buildOpggUrl } from "@/lib/opgg";
import { QUEST_TYPES } from "@/lib/quests";
import {
  resolvePuuid,
  RiotAccountNotFoundError,
  RiotApiError,
  SUPPORTED_PLATFORMS,
} from "@/lib/riot";

export const dynamic = "force-dynamic";

/**
 * Reemplaza la cuenta de Riot de un participante YA existente (ej. le
 * banearon la cuenta y arranca con una nueva) sin tocar su lugar en el
 * torneo: mismo `id` (así snapshots/mangos/penalty_progress/pickem_picks/
 * chat_messages, todo lo que referencia participant_id, sigue apuntando a
 * la misma fila) y mismo `nombre_display` — nada de eso se pide en el
 * body, no hay por qué tocarlo.
 *
 * Lo que SÍ se resetea porque queda inválido/engañoso con la cuenta
 * vieja: los snapshots existentes se borran (mezclar el elo_score de una
 * cuenta con el de otra rompería ±LP/racha/cambio de posición, que asumen
 * una progresión continua de la MISMA cuenta) y el progreso de misiones
 * vuelve a 0 con el cursor de partidas limpio (referenciaban match ids de
 * la cuenta vieja). mangos/penalty_progress/pickem_picks/chat_messages NO
 * se tocan — son historial del PARTICIPANTE en el torneo, no de su cuenta
 * de LoL puntual.
 *
 * EXCEPCIÓN (bug real reportado, caso Joseito): si Riot forzó un cambio de
 * NOMBRE (riot_game_name/riot_tag) sin que la cuenta cambie de verdad — el
 * puuid resuelto por Riot para el Riot ID nuevo es el MISMO que ya tenía
 * el participante — no hay ninguna "cuenta vieja" de la que despegarse:
 * es la misma cuenta de siempre, solo con otro nombre. En ese caso NO se
 * toca nada de lo de arriba (snapshots, progreso de misiones, ícono,
 * in_game, aegis_count) — antes este endpoint lo borraba todo igual sin
 * chequear esto, lo que dejaba al jugador "sin partidas" un rato y
 * después el cron le reprocesaba sus últimas ~20 partidas como si fueran
 * nuevas de una (backfill no intencional, mismo patrón que el bug de
 * reset-quests con Anthony/Biangelo).
 */
export async function POST(request: Request) {
  if (!(await isAdminAuthenticated(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const riotApiKey = process.env.RIOT_API_KEY;
  if (!riotApiKey) {
    return NextResponse.json(
      { error: "RIOT_API_KEY no está configurada" },
      { status: 500 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const { participant_id, riot_game_name, riot_tag, region_platform } =
    (body ?? {}) as Record<string, unknown>;

  if (
    typeof participant_id !== "string" ||
    !participant_id.trim() ||
    typeof riot_game_name !== "string" ||
    !riot_game_name.trim() ||
    typeof riot_tag !== "string" ||
    !riot_tag.trim() ||
    typeof region_platform !== "string" ||
    !region_platform.trim()
  ) {
    return NextResponse.json(
      {
        error:
          "Faltan campos requeridos: participant_id, riot_game_name, riot_tag, region_platform",
      },
      { status: 400 },
    );
  }

  const platform = region_platform.trim().toUpperCase();
  if (!SUPPORTED_PLATFORMS.includes(platform as (typeof SUPPORTED_PLATFORMS)[number])) {
    return NextResponse.json(
      { error: `region_platform inválida. Usa una de: ${SUPPORTED_PLATFORMS.join(", ")}` },
      { status: 400 },
    );
  }

  const supabase = createAdminClient();

  const { data: existing, error: existingError } = await supabase
    .from("participants")
    .select("id, puuid")
    .eq("id", participant_id)
    .maybeSingle();

  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: "Participante no encontrado" }, { status: 404 });
  }

  let account;
  try {
    account = await resolvePuuid({
      gameName: riot_game_name.trim(),
      tagLine: riot_tag.trim(),
      regionPlatform: platform,
      apiKey: riotApiKey,
    });
  } catch (err) {
    if (err instanceof RiotAccountNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof RiotApiError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Error desconocido al consultar Riot",
      },
      { status: 500 },
    );
  }

  const opggUrl = buildOpggUrl({
    riotGameName: account.gameName,
    riotTag: account.tagLine,
    regionPlatform: platform,
  });

  // Mismo puuid que ya tenía = no es una cuenta distinta, es un cambio de
  // nombre forzado por Riot sobre la MISMA cuenta — ver el comentario largo
  // arriba (caso Joseito). Decide si este request touchea o no
  // snapshots/misiones/ícono/aegis más abajo.
  const isSameAccount = existing.puuid === account.puuid;

  const { data: updated, error: updateError } = await supabase
    .from("participants")
    .update({
      riot_game_name: account.gameName,
      riot_tag: account.tagLine,
      puuid: account.puuid,
      region_platform: platform,
      opgg_url: opggUrl,
      ...(isSameAccount ? {} : { profile_icon_id: null, in_game: false, aegis_count: 0 }),
    })
    .eq("id", participant_id)
    .select()
    .single();

  if (updateError) {
    if (updateError.code === "23505") {
      return NextResponse.json(
        {
          error:
            "Ese Riot ID ya está en uso por otro participante (puuid o riot_game_name+riot_tag duplicado).",
        },
        { status: 409 },
      );
    }
    console.error("Reemplazo de cuenta falló:", updateError.code, updateError.message);
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  if (isSameAccount) {
    return NextResponse.json({ participant: updated, same_account: true });
  }

  // Best-effort, en paralelo: ninguno de los dos debe bloquear la
  // respuesta si el otro falla — el reemplazo de la cuenta en sí (arriba)
  // ya se guardó, que es lo que de verdad importa.
  const [snapshotsResult, questProgressResult] = await Promise.all([
    supabase.from("snapshots").delete().eq("participant_id", participant_id),
    supabase
      .from("quest_progress")
      .update({ current_progress: 0, last_processed_match_id: null })
      .eq("participant_id", participant_id)
      .in("quest_type", QUEST_TYPES),
  ]);

  if (snapshotsResult.error) {
    console.error(
      "Reemplazo de cuenta: no se pudieron borrar los snapshots viejos:",
      snapshotsResult.error.message,
    );
  }
  if (questProgressResult.error) {
    console.error(
      "Reemplazo de cuenta: no se pudo resetear el progreso de misiones:",
      questProgressResult.error.message,
    );
  }

  return NextResponse.json({ participant: updated, same_account: false });
}

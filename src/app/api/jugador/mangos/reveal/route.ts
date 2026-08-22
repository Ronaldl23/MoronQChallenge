import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedParticipantId } from "@/lib/player-auth";
import { getChampionList, type Champion } from "@/lib/champions";
import { getSummonerSpellList, type SummonerSpell } from "@/lib/summoner-spells";
import { resolveAssignedPunishment } from "@/lib/mango-launch";
import { postMangoEventChatMessage } from "@/lib/chat-system-messages";

export const dynamic = "force-dynamic";

interface ChampionResult {
  id: string;
  name: string;
  iconUrl: string;
  /** true si el castigo es "jugar SIN Flash" — el cliente le superpone la X sobre el ícono de Flash (ver PunishmentIcon), nunca un ícono nuevo. */
  noFlash?: boolean;
}

/**
 * Revela un mango en 'pending_reveal' — el azar YA se decidió en el
 * momento del lanzamiento (ver /api/jugador/mangos/launch); esto solo
 * confirma la identidad de quien tiene que verlo y devuelve el resultado
 * ya guardado para que el cliente anime la ruleta hasta ahí. Marca el
 * mango 'sent' en el mismo request — una vez que el cliente tiene el
 * resultado no tiene sentido dejarlo "pendiente" (se re-ofrecería en el
 * próximo poll aunque ya se haya mostrado).
 */
export async function POST(request: Request) {
  const participantId = await getAuthenticatedParticipantId();
  if (!participantId) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const { mango_id } = (body ?? {}) as Record<string, unknown>;
  if (typeof mango_id !== "string") {
    return NextResponse.json({ error: "Falta mango_id" }, { status: 400 });
  }

  const supabase = createAdminClient();

  const { data: mango, error: mangoError } = await supabase
    .from("mangos")
    .select("id, status, champion_assigned, sent_by_participant_id")
    .eq("id", mango_id)
    .maybeSingle();

  if (mangoError) {
    console.error("reveal: fallo consultando el mango:", mangoError.message);
    return NextResponse.json({ error: mangoError.message }, { status: 500 });
  }
  if (!mango || mango.status !== "pending_reveal") {
    return NextResponse.json(
      { error: "Ese mango no está esperando revelación" },
      { status: 409 },
    );
  }

  // La víctima real es quien tiene el penalty_progress de ESTE mango, no
  // necesariamente owner_participant_id (en un rebote, el mango lo "posee"
  // el objetivo original, pero la víctima es quien lanzó) — esto ES el
  // límite de autorización: sin esto, cualquier sesión autenticada podría
  // revelar el mango de otra persona pasándole el id a mano.
  const { data: penalty, error: penaltyError } = await supabase
    .from("penalty_progress")
    .select("id")
    .eq("mango_id", mango_id)
    .eq("participant_id", participantId)
    .maybeSingle();

  if (penaltyError) {
    console.error("reveal: fallo consultando penalty_progress:", penaltyError.message);
    return NextResponse.json({ error: penaltyError.message }, { status: 500 });
  }
  if (!penalty) {
    return NextResponse.json(
      { error: "Ese mango no te corresponde a vos" },
      { status: 403 },
    );
  }

  // .select("id") además del filtro: así se sabe si ESTA request fue la que
  // de verdad hizo el flip (filas devueltas) o si llegó tarde a la carrera
  // entre dos pestañas (0 filas, sin error) — el anuncio en el chat solo
  // debe publicarse una vez, no en cada intento de revelación.
  const { data: updatedRows, error: updateError } = await supabase
    .from("mangos")
    .update({ status: "sent" })
    .eq("id", mango_id)
    .eq("status", "pending_reveal") // evita una doble-revelación por una carrera entre dos pestañas
    .select("id");
  if (updateError) {
    console.error("reveal: fallo marcando el mango 'sent':", updateError.message);
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }
  const didTransition = (updatedRows?.length ?? 0) > 0;

  let champions: Champion[] = [];
  let spells: SummonerSpell[] = [];
  try {
    [champions, spells] = await Promise.all([getChampionList(), getSummonerSpellList()]);
  } catch {
    // resolveAssignedPunishment cae al id crudo si no hay lista — igual se puede revelar.
  }
  const championById = new Map(champions.map((c) => [c.id, c]));
  const spellById = new Map(spells.map((s) => [s.id, s]));
  const resolved = resolveAssignedPunishment(mango.champion_assigned, championById, spellById);

  const result: ChampionResult = {
    id: mango.champion_assigned!,
    name: resolved.name,
    iconUrl: resolved.iconUrl ?? "/MangoAngry.png",
    noFlash: resolved.noFlash,
  };

  // Anuncio público en el chat — best-effort, no debe romper la revelación
  // si falla. sent_by_participant_id puede ser null en teoría (tipo de la
  // columna), aunque en la práctica launch/route.ts siempre lo completa;
  // sin remitente no hay a quién nombrar, así que se omite el anuncio.
  if (didTransition && mango.sent_by_participant_id) {
    try {
      const { data: people } = await supabase
        .from("participants")
        .select("id, nombre_display")
        .in("id", [participantId, mango.sent_by_participant_id]);
      const nameById = new Map((people ?? []).map((p) => [p.id, p.nombre_display]));
      const receptorName = nameById.get(participantId);
      const remitenteName = nameById.get(mango.sent_by_participant_id);
      if (receptorName && remitenteName) {
        await postMangoEventChatMessage(supabase, {
          receptorParticipantId: participantId,
          receptorName,
          remitenteName,
          prizeLabel: resolved.name,
        });
      }
    } catch (err) {
      console.error("reveal: fallo publicando el evento de mango en el chat:", err);
    }
  }

  return NextResponse.json({ champion: result });
}

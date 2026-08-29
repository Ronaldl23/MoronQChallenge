import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedParticipantId } from "@/lib/player-auth";
import { isParticipantDisqualified } from "@/lib/disqualification";
import { getChampionList } from "@/lib/champions";
import { getSummonerSpellList } from "@/lib/summoner-spells";
import {
  canDiscardMango,
  rollIsMoldy,
  rollPenaltyOutcome,
  SUPPORT_ASSIGNMENT,
  NO_FLASH_ASSIGNMENT,
  type PunishmentOutcome,
} from "@/lib/mango-launch";

export const dynamic = "force-dynamic";

/** Mismo helper que /api/jugador/mangos/launch — qué guardar en champion_assigned para cada tipo de resultado. */
function toStoredAssignment(outcome: PunishmentOutcome): string {
  if (outcome.kind === "support") return SUPPORT_ASSIGNMENT;
  if (outcome.kind === "spell") return outcome.noFlash ? NO_FLASH_ASSIGNMENT : outcome.spell.id;
  return outcome.champion.id;
}

/**
 * Tirar a la basura un mango podrido que ya pasó la ventana de
 * MOLDY_TRASH_UNLOCK_HOURS (ver src/lib/mango-launch.ts) — ya no se puede
 * lanzar, solo descartar. 50% de que tenga hongos: si toca, le asigna un
 * castigo a quien lo tiró (mismo roll que un rebote, sin balde de rebote
 * de nuevo) y lo deja 'pending_reveal' para que su propia sesión dispare
 * la ruleta automática, igual que cualquier mango recibido — el anuncio en
 * el chat y el toast previo a la ruleta lo distinguen como "hongo" en vez
 * del genérico "recibiste un mango" (ver /api/jugador/mangos/reveal y
 * /api/jugador/notifications). Si no toca, el mango pasa a 'discarded' sin
 * generar ningún castigo — un aviso que solo ve quien lo tiró, sin anuncio
 * público.
 *
 * sent_by_participant_id se completa con el propio dueño en los DOS casos
 * (no null): así este descarte cuenta como "lanzado" en las estadísticas
 * del inventario (ver src/app/jugador/page.tsx) sin importar el resultado
 * — tirar el mango es la acción, tenga hongos o no.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const participantId = await getAuthenticatedParticipantId();
  if (!participantId) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { mango_id } = (body ?? {}) as Record<string, unknown>;
  if (typeof mango_id !== "string") {
    return NextResponse.json({ error: "Falta mango_id" }, { status: 400 });
  }

  const supabase = createAdminClient();

  // Mismo chequeo server-side que /api/jugador/mangos/launch — la UI ya
  // oculta el inventario entero a un jugador descalificado (ver
  // /jugador/page.tsx), pero eso solo esconde el botón; esto ES el límite
  // de autorización real.
  if (await isParticipantDisqualified(supabase, participantId)) {
    return NextResponse.json(
      { error: "Estás descalificado — no podés tirar mangos hasta que te perdonen" },
      { status: 403 },
    );
  }

  const { data: mango, error: mangoError } = await supabase
    .from("mangos")
    .select("id, owner_participant_id, status, inventory_since")
    .eq("id", mango_id)
    .maybeSingle();

  if (mangoError) {
    return NextResponse.json({ error: mangoError.message }, { status: 500 });
  }
  if (!mango || mango.owner_participant_id !== participantId || mango.status !== "in_inventory") {
    return NextResponse.json({ error: "Ese mango no está disponible" }, { status: 409 });
  }
  if (!canDiscardMango(mango.inventory_since)) {
    return NextResponse.json(
      { error: "Este mango todavía se puede lanzar — no se puede tirar a la basura" },
      { status: 409 },
    );
  }

  const moldy = rollIsMoldy();

  if (!moldy) {
    // UPDATE condicional + chequeo de filas afectadas, mismo patrón que
    // /api/jugador/mangos/launch contra una carrera entre dos requests
    // sobre el mismo mango (doble click).
    const { data: updatedRows, error: updateError } = await supabase
      .from("mangos")
      .update({ status: "discarded", sent_by_participant_id: participantId })
      .eq("id", mango.id)
      .eq("status", "in_inventory")
      .select("id");
    if (updateError) {
      console.error("discard: fallo marcando el mango 'discarded':", updateError.message);
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }
    if ((updatedRows?.length ?? 0) === 0) {
      return NextResponse.json({ error: "Ese mango no está disponible" }, { status: 409 });
    }
    return NextResponse.json({ ok: true, moldy: false });
  }

  let champions;
  let spells;
  try {
    [champions, spells] = await Promise.all([getChampionList(), getSummonerSpellList()]);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "No se pudo cargar la lista de campeones/hechizos" },
      { status: 502 },
    );
  }
  const outcome = rollPenaltyOutcome(champions, spells);

  const { data: updatedRows, error: updateError } = await supabase
    .from("mangos")
    .update({
      status: "pending_reveal",
      sent_by_participant_id: participantId,
      champion_assigned: toStoredAssignment(outcome),
      is_moldy_trash: true,
    })
    .eq("id", mango.id)
    .eq("status", "in_inventory")
    .select("id");
  if (updateError) {
    console.error("discard: fallo marcando el mango con hongo:", updateError.message);
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }
  if ((updatedRows?.length ?? 0) === 0) {
    return NextResponse.json({ error: "Ese mango no está disponible" }, { status: 409 });
  }

  const { error: penaltyError } = await supabase.from("penalty_progress").insert({
    participant_id: participantId,
    mango_id: mango.id,
  });
  if (penaltyError) {
    console.error("discard: fallo insertando penalty_progress del hongo:", penaltyError.message);
    return NextResponse.json({ error: penaltyError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, moldy: true });
}

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedParticipantId } from "@/lib/player-auth";
import { isParticipantDisqualified } from "@/lib/disqualification";
import { fetchRankOrder } from "@/lib/ranking";
import { getChampionList } from "@/lib/champions";
import { getSummonerSpellList } from "@/lib/summoner-spells";
import {
  rollFirstOutcome,
  rollPenaltyOutcome,
  MAX_ACTIVE_PENALTIES,
  canLaunchMango,
  BOUNCE_PROBABILITY_PERCENT,
  EXPIRED_BOUNCE_PROBABILITY_PERCENT,
  isMangoExpired,
  computeBullyingBonusPercent,
  SUPPORT_ASSIGNMENT,
  NO_FLASH_ASSIGNMENT,
  type PunishmentOutcome,
} from "@/lib/mango-launch";

export const dynamic = "force-dynamic";

/**
 * `champion_assigned` a guardar en la fila de `mangos` — el azar se decide
 * ACÁ, en el momento del lanzamiento, como siempre (por seguridad: nunca en
 * el cliente ni al momento de revelar). La diferencia contra la Fase 3
 * original es que ya no se le devuelve el resultado a quien lanza — queda
 * guardado como 'pending_reveal' hasta que la persona correcta lo revele en
 * su propia sesión (ver /api/jugador/mangos/reveal).
 */
function toStoredAssignment(outcome: PunishmentOutcome): string {
  if (outcome.kind === "support") return SUPPORT_ASSIGNMENT;
  if (outcome.kind === "spell") return outcome.noFlash ? NO_FLASH_ASSIGNMENT : outcome.spell.id;
  return outcome.champion.id;
}

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

  const { mango_id, target_participant_id } = (body ?? {}) as Record<string, unknown>;
  if (typeof mango_id !== "string" || typeof target_participant_id !== "string") {
    return NextResponse.json(
      { error: "Faltan mango_id o target_participant_id" },
      { status: 400 },
    );
  }

  if (target_participant_id === participantId) {
    return NextResponse.json(
      { error: "No podés lanzarte un mango a vos mismo" },
      { status: 400 },
    );
  }

  const supabase = createAdminClient();

  // Un jugador descalificado (por castigo sin cumplir o a mano desde
  // /admin, ver isParticipantDisqualified) no puede seguir lanzando
  // mangos hasta que lo perdonen — chequeo server-side, no alcanza con
  // ocultarle el inventario en /jugador (ver ese archivo), esto ES el
  // límite de autorización real.
  if (await isParticipantDisqualified(supabase, participantId)) {
    return NextResponse.json(
      { error: "Estás descalificado — no podés lanzar mangos hasta que te perdonen" },
      { status: 403 },
    );
  }

  // Vacío legal cerrado: MAX_ACTIVE_PENALTIES le pone techo a lo que a un
  // jugador le PUEDEN lanzar (chequeo del objetivo, más abajo), pero nada
  // le impedía a ÉL MISMO seguir lanzando más allá de su propio cupo — si
  // ya tenía 3 y le rebotaba, quedaba en 4 (la única excepción aceptada:
  // autoinfligida por su propio lanzamiento), pero podía seguir lanzando
  // de ahí en más y acumular un 5to, 6to sin límite. canLaunchMango permite
  // lanzar estando en el tope (para que ese rebote pueda pasar) y bloquea
  // recién en MAX_ACTIVE_PENALTIES+1 en adelante.
  const { count: ownActivePenaltyCount, error: ownCountError } = await supabase
    .from("penalty_progress")
    .select("id", { count: "exact", head: true })
    .eq("participant_id", participantId)
    .eq("status", "pending");
  if (ownCountError) {
    return NextResponse.json({ error: ownCountError.message }, { status: 500 });
  }
  if (!canLaunchMango(ownActivePenaltyCount ?? 0)) {
    return NextResponse.json(
      {
        error: `Ya tenés más de ${MAX_ACTIVE_PENALTIES} castigos activos — cumplí uno o esperá a que te perdonen antes de lanzar otro mango`,
      },
      { status: 403 },
    );
  }

  // El dueño del mango se valida acá, en código — no hay policy de RLS
  // atada a la sesión de /jugador (no usa Supabase Auth), así que el
  // service role + este chequeo explícito ES el límite de autorización.
  const { data: mango, error: mangoError } = await supabase
    .from("mangos")
    .select("id, owner_participant_id, status, inventory_since")
    .eq("id", mango_id)
    .maybeSingle();

  if (mangoError) {
    return NextResponse.json({ error: mangoError.message }, { status: 500 });
  }
  if (!mango || mango.owner_participant_id !== participantId || mango.status !== "in_inventory") {
    return NextResponse.json(
      { error: "Ese mango no está disponible para lanzar" },
      { status: 409 },
    );
  }

  const { data: target, error: targetError } = await supabase
    .from("participants")
    .select("id, nombre_display, mango_protection_until")
    .eq("id", target_participant_id)
    .maybeSingle();

  if (targetError) {
    return NextResponse.json({ error: targetError.message }, { status: 500 });
  }
  if (!target) {
    return NextResponse.json({ error: "Participante objetivo no encontrado" }, { status: 404 });
  }

  // Protección de PROTECTION_HOURS que gana un jugador al cumplir un
  // castigo teniendo sus MAX_ACTIVE_PENALTIES activos a la vez (ver
  // processParticipantPenalties en /api/update-rankings) — se chequea
  // ANTES que el cupo de abajo porque puede estar protegido con menos de
  // MAX_ACTIVE_PENALTIES activos (por diseño: recién liberó un cupo).
  if (target.mango_protection_until && new Date(target.mango_protection_until) > new Date()) {
    return NextResponse.json(
      { error: `${target.nombre_display} está protegido contra mangos por ahora` },
      { status: 409 },
    );
  }

  // Cupo de castigos ACTIVOS simultáneos (penalty_progress en 'pending') —
  // ya no importa cuándo los recibió, importa cuántos tiene sin resolver
  // ahora mismo (reemplaza al viejo límite "3 recibidos por día").
  const { count: activePenaltyCount, error: countError } = await supabase
    .from("penalty_progress")
    .select("id", { count: "exact", head: true })
    .eq("participant_id", target_participant_id)
    .eq("status", "pending");

  if (countError) {
    return NextResponse.json({ error: countError.message }, { status: 500 });
  }
  if ((activePenaltyCount ?? 0) >= MAX_ACTIVE_PENALTIES) {
    return NextResponse.json(
      { error: `${target.nombre_display} ya alcanzó el máximo de castigos disponibles` },
      { status: 409 },
    );
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

  // Mango "podrido" (24h+ sin lanzarse, ver isMangoExpired): más chance de
  // rebote — castiga holdear un mango sin usarlo en vez de acumularlo.
  const baseBounceProbabilityPercent = isMangoExpired(mango.inventory_since)
    ? EXPIRED_BOUNCE_PROBABILITY_PERCENT
    : BOUNCE_PROBABILITY_PERCENT;

  // Anti-bullying: +BULLYING_BOUNCE_PERCENT_PER_RANK de rebote por cada
  // puesto del ranking que el objetivo esté por debajo de quien lanza (ver
  // computeBullyingBonusPercent) — 0 si a cualquiera de los dos todavía no
  // se le puede calcular el rank (sin partidas ranked, ver fetchRankOrder).
  const rankOrder = await fetchRankOrder(supabase);
  const bullyingBonusPercent = computeBullyingBonusPercent(
    rankOrder.get(participantId) ?? null,
    rankOrder.get(target_participant_id) ?? null,
  );
  const bounceProbabilityPercent = Math.min(
    100,
    baseBounceProbabilityPercent + bullyingBonusPercent,
  );
  const outcome = rollFirstOutcome(champions, spells, bounceProbabilityPercent);

  if (outcome.kind !== "bounce") {
    // UPDATE condicional (.eq("status", "in_inventory")) + chequeo de filas
    // afectadas, mismo patrón que la doble-revelación en reveal/route.ts:
    // entre el SELECT de arriba y acá hubo varios await (listas de
    // campeones/hechizos, fetchRankOrder) — tiempo de sobra para que dos
    // requests casi simultáneas sobre el MISMO mango (doble click, retry de
    // red) pasen las dos el chequeo inicial y las dos lleguen hasta acá. Sin
    // esta condición, las dos ganan el UPDATE y las dos insertan su propia
    // fila en penalty_progress más abajo — duplicado real que después
    // rompe la revelación (.maybeSingle() truena con "multiple rows" en
    // reveal/route.ts) y desincroniza el conteo de castigos.
    const { data: updatedMangoRows, error: updateError } = await supabase
      .from("mangos")
      .update({
        status: "pending_reveal",
        sent_by_participant_id: participantId,
        champion_assigned: toStoredAssignment(outcome),
      })
      .eq("id", mango.id)
      .eq("status", "in_inventory")
      .select("id");
    if (updateError) {
      console.error("launch: fallo marcando el mango pending_reveal:", updateError.message);
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }
    if ((updatedMangoRows?.length ?? 0) === 0) {
      // Perdió la carrera: otra request ya lo lanzó entre el SELECT de
      // arriba y este UPDATE — no insertar un segundo penalty_progress.
      return NextResponse.json(
        { error: "Ese mango no está disponible para lanzar" },
        { status: 409 },
      );
    }

    const { error: penaltyError } = await supabase.from("penalty_progress").insert({
      participant_id: target_participant_id,
      mango_id: mango.id,
    });
    if (penaltyError) {
      console.error("launch: fallo insertando penalty_progress:", penaltyError.message);
      return NextResponse.json({ error: penaltyError.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, targetNombreDisplay: target.nombre_display });
  }

  // Rebote (BOUNCE_PROBABILITY_PERCENT normal, o EXPIRED_ si el mango
  // estaba podrido): el mango original SÍ se gasta — se marca 'returned'
  // (un status que ya existía en el schema desde la Fase 1 pero nunca se
  // usaba) para sacarlo del inventario, igual que un lanzamiento normal. El
  // segundo roll (solo champion/Support, sin balde de rebote — un rebote no
  // puede volver a rebotar) también se decide ACÁ, en el mismo request, así
  // que para cuando cualquiera revele algo, el azar ya terminó de principio
  // a fin. El castigo que le "rebota" a quien lo lanzó se modela con el
  // mismo patrón que un lanzamiento normal (fila nueva en mangos +
  // penalty_progress), solo que el mango nuevo lo "envía" el objetivo
  // (quien devolvió la jugada) y la víctima es quien lanzó originalmente.
  // No cuenta contra el cupo de inventario de nadie (nace directo en
  // status='pending_reveal') ni contra el cupo de castigos activos del
  // lanzador original — es una consecuencia automática de SU lanzamiento,
  // no un blanco nuevo que alguien eligió a propósito. El objetivo
  // original NUNCA se entera de nada de esto: ni mango, ni
  // penalty_progress, ni revelación — el rebote es invisible para él,
  // igual que en el diseño anterior.
  const bounceOutcome = rollPenaltyOutcome(champions, spells);

  // Mismo UPDATE condicional que el camino normal de arriba, por la misma
  // razón: dos requests casi simultáneas sobre el mismo mango no deben
  // terminar las dos acá abajo insertando su propio mango de rebote +
  // penalty_progress.
  const { data: updatedReturnedRows, error: returnedUpdateError } = await supabase
    .from("mangos")
    .update({ status: "returned" })
    .eq("id", mango.id)
    .eq("status", "in_inventory")
    .select("id");
  if (returnedUpdateError) {
    console.error("launch: fallo marcando el mango original 'returned':", returnedUpdateError.message);
    return NextResponse.json({ error: returnedUpdateError.message }, { status: 500 });
  }
  if ((updatedReturnedRows?.length ?? 0) === 0) {
    return NextResponse.json(
      { error: "Ese mango no está disponible para lanzar" },
      { status: 409 },
    );
  }

  const { data: bounceMango, error: bounceMangoError } = await supabase
    .from("mangos")
    .insert({
      owner_participant_id: target_participant_id,
      status: "pending_reveal",
      sent_by_participant_id: target_participant_id,
      champion_assigned: toStoredAssignment(bounceOutcome),
      is_bounce_back: true,
    })
    .select()
    .single();

  if (bounceMangoError || !bounceMango) {
    console.error("launch: fallo insertando el mango de rebote:", bounceMangoError?.message);
    return NextResponse.json(
      { error: bounceMangoError?.message ?? "No se pudo registrar el rebote" },
      { status: 500 },
    );
  }

  const { error: bouncePenaltyError } = await supabase.from("penalty_progress").insert({
    participant_id: participantId,
    mango_id: bounceMango.id,
  });
  if (bouncePenaltyError) {
    console.error("launch: fallo insertando penalty_progress del rebote:", bouncePenaltyError.message);
    return NextResponse.json({ error: bouncePenaltyError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, targetNombreDisplay: target.nombre_display });
}

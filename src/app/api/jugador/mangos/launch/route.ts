import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedParticipantId } from "@/lib/player-auth";
import { getChampionList } from "@/lib/champions";
import { rollBounce, pickRandomChampion, DAILY_RECEIVE_LIMIT, hoursAgoIso } from "@/lib/mango-launch";

export const dynamic = "force-dynamic";

interface ChampionResult {
  id: string;
  name: string;
  iconUrl: string;
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

  // El dueño del mango se valida acá, en código — no hay policy de RLS
  // atada a la sesión de /jugador (no usa Supabase Auth), así que el
  // service role + este chequeo explícito ES el límite de autorización.
  const { data: mango, error: mangoError } = await supabase
    .from("mangos")
    .select("id, owner_participant_id, status")
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
    .select("id, nombre_display")
    .eq("id", target_participant_id)
    .maybeSingle();

  if (targetError) {
    return NextResponse.json({ error: targetError.message }, { status: 500 });
  }
  if (!target) {
    return NextResponse.json({ error: "Participante objetivo no encontrado" }, { status: 404 });
  }

  const { count: receivedCount, error: countError } = await supabase
    .from("penalty_progress")
    .select("id", { count: "exact", head: true })
    .eq("participant_id", target_participant_id)
    .gte("created_at", hoursAgoIso(24));

  if (countError) {
    return NextResponse.json({ error: countError.message }, { status: 500 });
  }
  if ((receivedCount ?? 0) >= DAILY_RECEIVE_LIMIT) {
    return NextResponse.json(
      { error: `${target.nombre_display} ya alcanzó el límite diario de mangos recibidos` },
      { status: 409 },
    );
  }

  let champions;
  try {
    champions = await getChampionList();
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "No se pudo cargar la lista de campeones" },
      { status: 502 },
    );
  }

  const bounced = rollBounce();

  if (!bounced) {
    const champion = pickRandomChampion(champions);

    const { error: updateError } = await supabase
      .from("mangos")
      .update({
        status: "sent",
        sent_by_participant_id: participantId,
        champion_assigned: champion.id,
      })
      .eq("id", mango.id);
    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    const { error: penaltyError } = await supabase.from("penalty_progress").insert({
      participant_id: target_participant_id,
      mango_id: mango.id,
    });
    if (penaltyError) {
      return NextResponse.json({ error: penaltyError.message }, { status: 500 });
    }

    const result: ChampionResult = champion;
    return NextResponse.json({
      bounced: false,
      champion: result,
      targetNombreDisplay: target.nombre_display,
    });
  }

  // Rebote (10%): el mango original NO se toca — sigue 'in_inventory', tal
  // como pidió el usuario ("no se gasta"). El castigo que le "rebota" a
  // quien lo lanzó se modela con el mismo patrón que un lanzamiento normal
  // (fila nueva en mangos + penalty_progress), solo que el mango nuevo lo
  // "envía" el objetivo (quien devolvió la jugada) y la víctima es quien
  // lanzó originalmente. No cuenta contra el cupo de inventario de nadie
  // (nace directo en status='sent') ni contra el límite diario del
  // lanzador original — es una consecuencia automática de SU lanzamiento,
  // no un blanco nuevo que alguien eligió a propósito.
  const bounceChampion = pickRandomChampion(champions);

  const { data: bounceMango, error: bounceMangoError } = await supabase
    .from("mangos")
    .insert({
      owner_participant_id: target_participant_id,
      status: "sent",
      sent_by_participant_id: target_participant_id,
      champion_assigned: bounceChampion.id,
    })
    .select()
    .single();

  if (bounceMangoError || !bounceMango) {
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
    return NextResponse.json({ error: bouncePenaltyError.message }, { status: 500 });
  }

  const result: ChampionResult = bounceChampion;
  return NextResponse.json({
    bounced: true,
    champion: result,
    targetNombreDisplay: target.nombre_display,
  });
}

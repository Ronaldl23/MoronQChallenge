import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedParticipantId } from "@/lib/player-auth";
import { getChampionList, type Champion } from "@/lib/champions";
import { resolveAssignedPunishment } from "@/lib/mango-launch";

export const dynamic = "force-dynamic";

interface ChampionResult {
  id: string;
  name: string;
  iconUrl: string;
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
    .select("id, status, champion_assigned")
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

  const { error: updateError } = await supabase
    .from("mangos")
    .update({ status: "sent" })
    .eq("id", mango_id)
    .eq("status", "pending_reveal"); // evita una doble-revelación por una carrera entre dos pestañas
  if (updateError) {
    console.error("reveal: fallo marcando el mango 'sent':", updateError.message);
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  let champions: Champion[] = [];
  try {
    champions = await getChampionList();
  } catch {
    // resolveAssignedPunishment cae al id crudo si no hay lista — igual se puede revelar.
  }
  const championById = new Map(champions.map((c) => [c.id, c]));
  const resolved = resolveAssignedPunishment(mango.champion_assigned, championById);

  const result: ChampionResult = {
    id: mango.champion_assigned!,
    name: resolved.name,
    iconUrl: resolved.iconUrl ?? "/MangoAngry.png",
  };

  return NextResponse.json({ champion: result });
}

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { getChampionList, type Champion } from "@/lib/champions";
import { getSummonerSpellList, type SummonerSpell } from "@/lib/summoner-spells";
import { resolveAssignedPunishment } from "@/lib/mango-launch";

export const dynamic = "force-dynamic";

export interface DisqualifiedPenalty {
  id: string;
  participantId: string;
  participantName: string;
  senderName: string;
  championName: string;
  championIconUrl: string | null;
  noFlash?: boolean;
  createdAt: string;
}

export interface ManuallyDisqualifiedPlayer {
  participantId: string;
  participantName: string;
  reason: string | null;
}

/**
 * Dos vías de descalificación, independientes entre sí (un jugador puede
 * estar en las dos a la vez):
 *
 * 1. Automática (ver src/lib/penalty.ts): el jugador se pasó de las
 *    PENALTY_GAME_LIMIT partidas sin cumplir NINGUNO de sus castigos
 *    pendientes, así que TODOS los que le quedaban pendientes en ese
 *    momento pasaron a 'disqualified' juntos (misma causa), sin ningún
 *    paso de revisión manual en el medio. Incluye también
 *    'flagged_for_review' por compatibilidad con filas viejas de antes de
 *    ese cambio (ese status ya no lo escribe nada).
 * 2. Manual (ver /api/admin/participants/disqualify): un admin lo
 *    descalifica directo desde /admin, por motivos sin mango de por medio
 *    (trampa, conducta, etc.) — participants.manually_disqualified.
 *
 * El cliente (PenaltyReviewPanel) agrupa los castigos por participantId y
 * suma las descalificaciones manuales al mismo grupo — la única acción
 * posible en cualquiera de las dos vías es "Perdonar jugador" (ver
 * /api/admin/penalties/resolve), que limpia ambas de una.
 */
export async function GET(request: Request) {
  if (!(await isAdminAuthenticated(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();

  const [{ data: flagged, error }, { data: manuallyDisqualifiedRows, error: manualError }] =
    await Promise.all([
      supabase
        .from("penalty_progress")
        .select("id, participant_id, mango_id, created_at")
        .in("status", ["disqualified", "flagged_for_review"])
        .order("created_at", { ascending: true }),
      supabase
        .from("participants")
        .select("id, nombre_display, disqualification_reason")
        .eq("manually_disqualified", true),
    ]);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (manualError) {
    return NextResponse.json({ error: manualError.message }, { status: 500 });
  }

  const manuallyDisqualified: ManuallyDisqualifiedPlayer[] = (manuallyDisqualifiedRows ?? []).map(
    (p) => ({
      participantId: p.id,
      participantName: p.nombre_display,
      reason: p.disqualification_reason,
    }),
  );

  if (!flagged || flagged.length === 0) {
    return NextResponse.json({ penalties: [], manuallyDisqualified });
  }

  const { data: mangos } = await supabase
    .from("mangos")
    .select("id, champion_assigned, sent_by_participant_id, is_moldy_trash")
    .in(
      "id",
      flagged.map((f) => f.mango_id),
    );
  const mangoById = new Map((mangos ?? []).map((m) => [m.id, m]));

  const participantIds = [
    ...new Set([
      ...flagged.map((f) => f.participant_id),
      ...(mangos ?? [])
        .map((m) => m.sent_by_participant_id)
        .filter((id): id is string => id !== null),
    ]),
  ];
  const { data: participants } = participantIds.length
    ? await supabase.from("participants").select("id, nombre_display").in("id", participantIds)
    : { data: [] };
  const nameById = new Map((participants ?? []).map((p) => [p.id, p.nombre_display]));

  let champions: Champion[] = [];
  let spells: SummonerSpell[] = [];
  try {
    [champions, spells] = await Promise.all([getChampionList(), getSummonerSpellList()]);
  } catch {
    // Sin campeones/hechizos no podemos resolver el nombre — se cae al id crudo abajo.
  }
  const championById = new Map(champions.map((c) => [c.id, c]));
  const spellById = new Map(spells.map((s) => [s.id, s]));

  const penalties: DisqualifiedPenalty[] = flagged.map((f) => {
    const mango = mangoById.get(f.mango_id);
    const resolved = resolveAssignedPunishment(mango?.champion_assigned ?? null, championById, spellById);
    const senderName = mango?.is_moldy_trash
      ? "nadie — tirado a la basura con hongo"
      : (mango?.sent_by_participant_id && nameById.get(mango.sent_by_participant_id)) || "Alguien";
    return {
      id: f.id,
      participantId: f.participant_id,
      participantName: nameById.get(f.participant_id) ?? "Desconocido",
      senderName,
      championName: resolved.name,
      championIconUrl: resolved.iconUrl,
      noFlash: resolved.noFlash,
      createdAt: f.created_at,
    };
  });

  return NextResponse.json({ penalties, manuallyDisqualified });
}

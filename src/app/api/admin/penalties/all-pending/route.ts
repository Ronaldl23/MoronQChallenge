import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { getChampionList, type Champion } from "@/lib/champions";
import { getSummonerSpellList, type SummonerSpell } from "@/lib/summoner-spells";
import { resolveAssignedPunishment } from "@/lib/mango-launch";

export const dynamic = "force-dynamic";

export interface PendingPenaltyAdminView {
  id: string;
  participantId: string;
  participantName: string;
  championName: string;
  championIconUrl: string | null;
  noFlash?: boolean;
  createdAt: string;
  /** null si es autoinfligido (rebote/hongo/incumplimiento) — no hay a quién nombrar. */
  senderName: string | null;
  isBounceBack: boolean;
  isMoldyTrash: boolean;
  isNoncompliancePenalty: boolean;
  /** false mientras el mango siga 'pending_reveal' — el jugador todavía no lo vio, pero se muestra igual acá (a un admin no lo "arruina"). */
  revealed: boolean;
}

/**
 * TODOS los castigos pendientes (status='pending' en penalty_progress) de
 * TODO el roster, para el botón "Perdonar este castigo" en /admin — evita
 * tener que ir a Supabase a mano cada vez que un castigo se generó por un
 * problema puntual (cursor mal reseteado, bug de una corrida, etc.), ver
 * /api/admin/penalties/forgive.
 */
export async function GET(request: Request) {
  if (!(await isAdminAuthenticated(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();

  const { data: pendingRows, error: pendingError } = await supabase
    .from("penalty_progress")
    .select("id, participant_id, mango_id, created_at")
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  if (pendingError) {
    return NextResponse.json({ error: pendingError.message }, { status: 500 });
  }
  if (!pendingRows || pendingRows.length === 0) {
    return NextResponse.json({ penalties: [] satisfies PendingPenaltyAdminView[] });
  }

  const { data: mangos, error: mangosError } = await supabase
    .from("mangos")
    .select("id, champion_assigned, status, sent_by_participant_id, is_bounce_back, is_moldy_trash, is_noncompliance_penalty")
    .in(
      "id",
      pendingRows.map((p) => p.mango_id),
    );
  if (mangosError) {
    return NextResponse.json({ error: mangosError.message }, { status: 500 });
  }
  const mangoById = new Map((mangos ?? []).map((m) => [m.id, m]));

  const participantIds = [
    ...new Set([
      ...pendingRows.map((p) => p.participant_id),
      ...(mangos ?? []).map((m) => m.sent_by_participant_id).filter((id): id is string => id !== null),
    ]),
  ];
  const { data: participants, error: participantsError } = await supabase
    .from("participants")
    .select("id, nombre_display")
    .in("id", participantIds);
  if (participantsError) {
    return NextResponse.json({ error: participantsError.message }, { status: 500 });
  }
  const nameById = new Map((participants ?? []).map((p) => [p.id, p.nombre_display]));

  let champions: Champion[] = [];
  let spells: SummonerSpell[] = [];
  try {
    [champions, spells] = await Promise.all([getChampionList(), getSummonerSpellList()]);
  } catch {
    // Sin campeones/hechizos se cae al id crudo dentro de resolveAssignedPunishment.
  }
  const championById = new Map(champions.map((c) => [c.id, c]));
  const spellById = new Map(spells.map((s) => [s.id, s]));

  const penalties: PendingPenaltyAdminView[] = pendingRows.flatMap((row) => {
    const mango = mangoById.get(row.mango_id);
    if (!mango) return [];
    const resolved = resolveAssignedPunishment(mango.champion_assigned, championById, spellById);
    const isSelfInflicted = mango.is_bounce_back || mango.is_moldy_trash || mango.is_noncompliance_penalty;
    return [
      {
        id: row.id,
        participantId: row.participant_id,
        participantName: nameById.get(row.participant_id) ?? "Desconocido",
        championName: resolved.name,
        championIconUrl: resolved.iconUrl,
        noFlash: resolved.noFlash,
        createdAt: row.created_at,
        senderName: isSelfInflicted
          ? null
          : (mango.sent_by_participant_id && nameById.get(mango.sent_by_participant_id)) || "Alguien",
        isBounceBack: mango.is_bounce_back,
        isMoldyTrash: mango.is_moldy_trash,
        isNoncompliancePenalty: mango.is_noncompliance_penalty,
        revealed: mango.status !== "pending_reveal",
      },
    ];
  });

  return NextResponse.json({ penalties } satisfies { penalties: PendingPenaltyAdminView[] });
}

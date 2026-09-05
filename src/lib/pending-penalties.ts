import type { SupabaseClient } from "@supabase/supabase-js";
import type { Champion } from "@/lib/champions";
import type { SummonerSpell } from "@/lib/summoner-spells";
import { resolveAssignedPunishment } from "@/lib/mango-launch";
import type { Database } from "@/types/database";

export interface PendingPunishment {
  name: string;
  iconUrl: string | null;
  noFlash?: boolean;
  senderName: string;
  /** true si este castigo es el rebote (10%) de un lanzamiento propio — senderName acá es el objetivo original, no alguien que te lo mandó. */
  isBounceBack: boolean;
  /** true si este castigo salió de tirar a la basura un mango podrido que te tocó hongo (ver /api/jugador/mangos/discard) — autoinfligido, senderName no aplica (sent_by_participant_id queda en uno mismo, solo para las estadísticas). */
  isMoldyTrash: boolean;
  /** true si este castigo es el autoinfligido por no cumplir otro a tiempo (ver nonComplianceGrants en src/lib/penalty.ts) — igual que isMoldyTrash, senderName no aplica. */
  isNoncompliancePenalty: boolean;
}

/**
 * Castigos pendientes (status='pending' en penalty_progress) YA revelados
 * (status !== 'pending_reveal', mostrar uno sin revelar sería un spoiler y
 * saltearía la ruleta) de un participante, en formato listo para mostrar —
 * mismo shape que usan el banner de /jugador y GlobalPenaltyAlert (ícono de
 * castigo global, arriba del chat, ver src/components/GlobalPenaltyAlert.tsx).
 * Extraído acá para no duplicar esta consulta+mapeo en los dos lugares.
 *
 * `pendingPenalties` (crudo, id + mango_id) lo trae el caller — en
 * /jugador/page.tsx ya sale de un Promise.all con el resto de la página (se
 * necesita también para `launchBlocked`, sin filtrar 'pending_reveal'), así
 * que pedirlo de nuevo acá sería una consulta redundante.
 */
export async function fetchPendingPunishments(
  supabase: SupabaseClient<Database>,
  pendingPenalties: { id: string; mango_id: string }[],
  champions: Champion[],
  spells: SummonerSpell[],
): Promise<PendingPunishment[]> {
  if (pendingPenalties.length === 0) return [];

  const championById = new Map(champions.map((c) => [c.id, c]));
  const spellById = new Map(spells.map((s) => [s.id, s]));

  const { data: pendingMangos } = await supabase
    .from("mangos")
    .select(
      "id, status, champion_assigned, sent_by_participant_id, is_bounce_back, is_moldy_trash, is_noncompliance_penalty",
    )
    .in(
      "id",
      pendingPenalties.map((p) => p.mango_id),
    );
  const mangoById = new Map((pendingMangos ?? []).map((m) => [m.id, m]));

  const senderIds = [
    ...new Set((pendingMangos ?? []).map((m) => m.sent_by_participant_id).filter((id) => id !== null)),
  ];
  const { data: senders } = senderIds.length
    ? await supabase.from("participants").select("id, nombre_display").in("id", senderIds)
    : { data: [] };
  const senderNameById = new Map((senders ?? []).map((s) => [s.id, s.nombre_display]));

  // Filtra los que todavía están 'pending_reveal': ver el comentario de arriba.
  return pendingPenalties
    .filter((p) => mangoById.get(p.mango_id)?.status !== "pending_reveal")
    .map((p) => {
      const mango = mangoById.get(p.mango_id);
      const resolved = resolveAssignedPunishment(mango?.champion_assigned ?? null, championById, spellById);
      const senderName =
        (mango?.sent_by_participant_id && senderNameById.get(mango.sent_by_participant_id)) || "Alguien";
      return {
        ...resolved,
        senderName,
        isBounceBack: mango?.is_bounce_back ?? false,
        isMoldyTrash: mango?.is_moldy_trash ?? false,
        isNoncompliancePenalty: mango?.is_noncompliance_penalty ?? false,
      };
    });
}

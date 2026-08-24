import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedParticipantId } from "@/lib/player-auth";
import { getAuthenticatedGuestId } from "@/lib/pickem-guest-auth";
import { getLeaderboard } from "@/lib/leaderboard";
import { PICKEM_LOCK_DATE } from "@/lib/config";
import { isPickemLockedAt, normalizePickemName } from "@/lib/pickem-logic";
import type { ShowcaseParticipant } from "@/types/database";

export {
  validatePredictedOrder,
  normalizePickemName,
  computePickemResultStatus,
  type PickemPositionStatus,
} from "@/lib/pickem-logic";

/**
 * A partir de PICKEM_LOCK_DATE (3 días de gracia después de que arranca el
 * torneo — el Pick'em es algo casual, no parte de la competencia en sí, ver
 * el comentario en src/lib/config.ts) nadie puede guardar/editar su pick —
 * ni jugadores ni invitados, sin excepción (el pedido original es
 * explícito: "sin importar si son jugadores o invitados"). Se evalúa
 * server-side en /api/pickem/save (la fuente de verdad real) y también
 * client-side para deshabilitar la UI antes de intentar guardar, mismo
 * criterio que el resto del sitio (la UI es una comodidad, el servidor es
 * quien realmente lo hace cumplir).
 */
export function isPickemLocked(now: number = Date.now()): boolean {
  return isPickemLockedAt(now, PICKEM_LOCK_DATE);
}

export interface PickemViewerIdentity {
  ownerType: "participant" | "guest";
  ownerId: string;
  displayName: string;
}

/**
 * Un jugador con sesión de /jugador puede hacer su pick con esa misma
 * sesión, sin código aparte (pedido explícito). Si por algún motivo el
 * navegador tuviera las dos cookies a la vez, la de jugador gana — es la
 * identidad "más fuerte" (una cuenta real del torneo).
 */
export async function getPickemViewerIdentity(): Promise<PickemViewerIdentity | null> {
  const participantId = await getAuthenticatedParticipantId();
  if (participantId) {
    const supabase = createAdminClient();
    const { data } = await supabase
      .from("participants")
      .select("nombre_display")
      .eq("id", participantId)
      .maybeSingle();
    if (data) {
      return { ownerType: "participant", ownerId: participantId, displayName: data.nombre_display };
    }
    // Cookie firmada pero el participante ya no existe — sigue evaluando
    // la de invitado en vez de dejar a esta persona sin poder acceder.
  }

  const guestId = await getAuthenticatedGuestId();
  if (guestId) {
    const supabase = createAdminClient();
    const { data } = await supabase
      .from("pickem_guests")
      .select("display_name")
      .eq("id", guestId)
      .maybeSingle();
    if (data) {
      return { ownerType: "guest", ownerId: guestId, displayName: data.display_name };
    }
  }

  return null;
}

export async function getPickemRoster(): Promise<ShowcaseParticipant[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.from("showcase_participants").select("*");
  if (error) {
    console.error("Failed to load showcase_participants for pickem:", error.message);
    return [];
  }
  return (data ?? []).sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

export async function getPickemSettings(): Promise<{
  resultsRevealed: boolean;
  revealedAt: string | null;
}> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("pickem_settings")
    .select("results_revealed, revealed_at")
    .eq("id", true)
    .maybeSingle();
  return {
    resultsRevealed: data?.results_revealed ?? false,
    revealedAt: data?.revealed_at ?? null,
  };
}

export async function getSavedPickOrder(
  identity: Pick<PickemViewerIdentity, "ownerType" | "ownerId">,
): Promise<string[] | null> {
  const supabase = createAdminClient();
  const column = identity.ownerType === "participant" ? "participant_id" : "guest_id";
  const { data } = await supabase
    .from("pickem_picks")
    .select("predicted_order")
    .eq(column, identity.ownerId)
    .maybeSingle();
  return data?.predicted_order ?? null;
}

/**
 * Ranking final real (leaderboard de verdad), indexado por nombre
 * normalizado para el match contra showcase_participants.nombre (ver
 * computePickemResultStatus). Solo entries RANKEADAS — unrankedEntries
 * (sin ninguna partida jugada) no tiene una posición final real que
 * predecir/acertar, así que no entran acá (quedan "unknown" para quien las
 * haya elegido en alguna posición).
 */
export async function getFinalRankByName(): Promise<Map<string, number>> {
  const { entries } = await getLeaderboard();
  const map = new Map<string, number>();
  for (const entry of entries) {
    map.set(normalizePickemName(entry.participant.nombre_display), entry.rank);
  }
  return map;
}

export type CommunityPickemEntry =
  | {
      ownerType: "participant";
      ownerLabel: string;
      avatarUrl: string | null;
      profileIconId: number | null;
      order: string[];
    }
  | { ownerType: "guest"; ownerLabel: string; order: string[] };

/** Todas las personas que YA guardaron un pick — quien no guardó ninguno simplemente no aparece acá (pedido explícito, sin placeholders vacíos). */
export async function getCommunityPickem(): Promise<CommunityPickemEntry[]> {
  const supabase = createAdminClient();
  const { data: picks, error } = await supabase
    .from("pickem_picks")
    .select("participant_id, guest_id, predicted_order");
  if (error) {
    console.error("Failed to load pickem_picks:", error.message);
    return [];
  }
  if (!picks || picks.length === 0) return [];

  const participantIds = picks.map((p) => p.participant_id).filter((id): id is string => id !== null);
  const guestIds = picks.map((p) => p.guest_id).filter((id): id is string => id !== null);

  const [participantsRes, guestsRes] = await Promise.all([
    participantIds.length
      ? supabase
          .from("participants")
          .select("id, nombre_display, avatar_url, profile_icon_id")
          .in("id", participantIds)
      : Promise.resolve({
          data: [] as { id: string; nombre_display: string; avatar_url: string | null; profile_icon_id: number | null }[],
        }),
    guestIds.length
      ? supabase.from("pickem_guests").select("id, display_name").in("id", guestIds)
      : Promise.resolve({ data: [] as { id: string; display_name: string }[] }),
  ]);

  const participantById = new Map((participantsRes.data ?? []).map((p) => [p.id, p]));
  const nameByGuestId = new Map((guestsRes.data ?? []).map((g) => [g.id, g.display_name]));

  const entries: CommunityPickemEntry[] = picks
    .map((pick): CommunityPickemEntry | null => {
      if (pick.participant_id) {
        const participant = participantById.get(pick.participant_id);
        // Owner borrado (participante eliminado después) — el pick igual
        // existe (ON DELETE CASCADE no dispara solo por faltar el nombre),
        // pero sin nombre no hay nada que mostrar de forma útil.
        if (!participant) return null;
        return {
          ownerType: "participant",
          ownerLabel: participant.nombre_display,
          avatarUrl: participant.avatar_url,
          profileIconId: participant.profile_icon_id,
          order: pick.predicted_order,
        };
      }
      if (pick.guest_id) {
        const ownerLabel = nameByGuestId.get(pick.guest_id);
        if (!ownerLabel) return null;
        return { ownerType: "guest", ownerLabel, order: pick.predicted_order };
      }
      return null;
    })
    .filter((e): e is CommunityPickemEntry => e !== null);

  entries.sort((a, b) => a.ownerLabel.localeCompare(b.ownerLabel, "es"));
  return entries;
}

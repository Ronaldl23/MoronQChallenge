import type { SupabaseClient } from "@supabase/supabase-js";
import { TIER_LABEL } from "@/lib/tiers";
import type {
  Database,
  RankDivision,
  RankEventDirection,
  RankTier,
} from "@/types/database";

const SYSTEM_SENDER_NAME = "Sistema";

/**
 * Best-effort: si el insert falla, se loguea y listo — un mensaje de chat
 * que no salió nunca debería tirar abajo el flujo real (revelar un mango,
 * terminar de correr /api/update-rankings).
 */
async function insertSystemChatMessage(
  supabase: SupabaseClient<Database>,
  input: {
    participantId: string;
    message: string;
    type: "mango_event" | "rank_event";
    rankDirection?: RankEventDirection;
  },
) {
  const { error } = await supabase.from("chat_messages").insert({
    participant_id: input.participantId,
    sender_name: SYSTEM_SENDER_NAME,
    sender_avatar_url: null,
    sender_profile_icon_id: null,
    message: input.message,
    type: input.type,
    rank_direction: input.rankDirection ?? null,
  });
  if (error) {
    console.error(
      `No se pudo publicar el evento de sistema (${input.type}) en el chat:`,
      error.message,
    );
  }
}

/** Se publica al revelar un mango (pending_reveal -> sent) — ver /api/jugador/mangos/reveal. */
export function postMangoEventChatMessage(
  supabase: SupabaseClient<Database>,
  {
    receptorParticipantId,
    receptorName,
    remitenteName,
    prizeLabel,
  }: {
    receptorParticipantId: string;
    receptorName: string;
    remitenteName: string;
    prizeLabel: string;
  },
) {
  return insertSystemChatMessage(supabase, {
    participantId: receptorParticipantId,
    type: "mango_event",
    message: `${receptorName} recibió un mangazo de ${remitenteName}, le tocó: ${prizeLabel}`,
  });
}

function formatRankLabel(
  tier: RankTier,
  division: RankDivision | null,
): string {
  return division ? `${TIER_LABEL[tier]} ${division}` : TIER_LABEL[tier];
}

/** Se publica cuando un participante cambia de tier/división — ver /api/update-rankings. */
export function postRankEventChatMessage(
  supabase: SupabaseClient<Database>,
  {
    participantId,
    participantName,
    tier,
    division,
    direction,
  }: {
    participantId: string;
    participantName: string;
    tier: RankTier;
    division: RankDivision | null;
    direction: RankEventDirection;
  },
) {
  const verb = direction === "up" ? "ascendió" : "descendió";
  return insertSystemChatMessage(supabase, {
    participantId,
    type: "rank_event",
    rankDirection: direction,
    message: `${participantName} ${verb} a ${formatRankLabel(tier, division)}`,
  });
}

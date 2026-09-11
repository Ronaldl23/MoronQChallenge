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
    type:
      | "mango_event"
      | "rank_event"
      | "mango_moldy_event"
      | "mango_noncompliance_event"
      | "mango_shield_event";
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

/**
 * Se publica al revelar un mango (pending_reveal -> sent) — ver
 * /api/jugador/mangos/reveal. En un rebote (10%, ver
 * src/lib/mango-launch.ts) `remitenteName` es en realidad el objetivo
 * original al que `receptorName` le había lanzado el mango, no alguien que
 * de verdad se lo mandó — isBounceBack cambia el texto para reflejar eso
 * ("le rebotó...") en vez del genérico "recibió un mangazo de...", que
 * sería engañoso en ese caso.
 */
export function postMangoEventChatMessage(
  supabase: SupabaseClient<Database>,
  {
    receptorParticipantId,
    receptorName,
    remitenteName,
    prizeLabel,
    isBounceBack = false,
  }: {
    receptorParticipantId: string;
    receptorName: string;
    remitenteName: string;
    prizeLabel: string;
    isBounceBack?: boolean;
  },
) {
  const message = isBounceBack
    ? `Se le regresó a ${receptorName} el mango que le mandó a ${remitenteName}, le tocó: ${prizeLabel}`
    : `${receptorName} recibió un mangazo de ${remitenteName}, le tocó: ${prizeLabel}`;
  return insertSystemChatMessage(supabase, {
    participantId: receptorParticipantId,
    type: "mango_event",
    message,
  });
}

/**
 * Se publica al revelar un mango tirado a la basura que resultó "con
 * hongos" (ver /api/jugador/mangos/discard y MOLDY_PROBABILITY_PERCENT en
 * src/lib/mango-launch.ts) — autoinfligido, sin remitente real, así que
 * usa su propio texto en vez de postMangoEventChatMessage (que siempre
 * habla de un "remitente"). El ícono de este tipo de mensaje lo resuelve
 * ChatWidget (MangoPodridoFurioso en vez del genérico de mango_event).
 */
export function postMoldyMangoChatMessage(
  supabase: SupabaseClient<Database>,
  {
    participantId,
    participantName,
    prizeLabel,
  }: {
    participantId: string;
    participantName: string;
    prizeLabel: string;
  },
) {
  return insertSystemChatMessage(supabase, {
    participantId,
    type: "mango_moldy_event",
    message: `El mango de ${participantName} ha agarrado hongo y se ha infectado, le tocó: ${prizeLabel}`,
  });
}

/**
 * Se publica al revelar el castigo autoinfligido que se otorga por NO
 * cumplir un castigo pendiente a tiempo (ver nonComplianceGrants en
 * src/lib/penalty.ts) — autoinfligido, sin remitente real, así que usa su
 * propio texto en vez de postMangoEventChatMessage, mismo criterio que
 * postMoldyMangoChatMessage. El ícono de este tipo de mensaje (Peligro en
 * vez del mango genérico) lo resuelve ChatWidget.
 */
export function postNonComplianceChatMessage(
  supabase: SupabaseClient<Database>,
  {
    participantId,
    participantName,
    prizeLabel,
  }: {
    participantId: string;
    participantName: string;
    prizeLabel: string;
  },
) {
  return insertSystemChatMessage(supabase, {
    participantId,
    type: "mango_noncompliance_event",
    message: `${participantName} no ha cumplido su castigo en el plazo acordado, ha recibido otro castigo y le ha tocado: ${prizeLabel}`,
  });
}

/**
 * Se publica al revelar un mango que fue reflejado por el Escudo de quien
 * iba a recibirlo (Misión Escudo, ver 0033_shield_mission.sql) — a
 * diferencia de un rebote (mala suerte al azar), acá el motivo es explícito
 * y se cuenta: quién lo lanzó, a quién, y que el Escudo de esa persona lo
 * reflejó. `participantId` (quien recibe el mensaje en su fila de
 * chat_messages) es quien lanzó originalmente — es quien ahora tiene que
 * cumplir el castigo reflejado.
 */
export function postShieldReflectionChatMessage(
  supabase: SupabaseClient<Database>,
  {
    participantId,
    launcherName,
    shieldOwnerName,
    prizeLabel,
  }: {
    participantId: string;
    launcherName: string;
    shieldOwnerName: string;
    prizeLabel: string;
  },
) {
  return insertSystemChatMessage(supabase, {
    participantId,
    type: "mango_shield_event",
    message: `${launcherName} le lanzó un mango a ${shieldOwnerName}, pero fue reflejado gracias a su Escudo Protector — le tocó: ${prizeLabel}`,
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

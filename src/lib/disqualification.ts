import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * Un participante está descalificado si tiene AL MENOS UN penalty_progress
 * en status='disqualified' (no cumplió un castigo de mango a tiempo, ver
 * src/lib/penalty.ts) O si un admin lo descalificó manualmente
 * (participants.manually_disqualified, ver
 * 0019_manual_disqualification.sql) — mismo criterio que `isDisqualified`
 * en src/lib/leaderboard.ts (leaderboard público), extraído acá para
 * reusarlo también server-side en /jugador: mientras esté descalificado,
 * no puede lanzar mangos ni ver su inventario (ver
 * /api/jugador/mangos/launch y src/app/jugador/page.tsx).
 */
export async function isParticipantDisqualified(
  supabase: SupabaseClient<Database>,
  participantId: string,
): Promise<boolean> {
  const [{ data: participant }, { count }] = await Promise.all([
    supabase
      .from("participants")
      .select("manually_disqualified")
      .eq("id", participantId)
      .maybeSingle(),
    supabase
      .from("penalty_progress")
      .select("id", { count: "exact", head: true })
      .eq("participant_id", participantId)
      .eq("status", "disqualified"),
  ]);
  return (participant?.manually_disqualified ?? false) || (count ?? 0) > 0;
}

/**
 * Modo "For Fun" (participant.for_fun, ver 0039_for_fun_mode.sql) —
 * independiente de isParticipantDisqualified a propósito (no se mezclan):
 * un jugador "For Fun" no participa del sistema de Mangos para nada, ni
 * como lanzador ni como objetivo (ver /api/jugador/mangos/launch), pero
 * eso no significa que esté descalificado del ranking en sí.
 */
export async function isParticipantForFun(
  supabase: SupabaseClient<Database>,
  participantId: string,
): Promise<boolean> {
  const { data: participant } = await supabase
    .from("participants")
    .select("for_fun")
    .eq("id", participantId)
    .maybeSingle();
  return participant?.for_fun ?? false;
}

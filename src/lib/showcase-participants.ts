import { createClient } from "@/lib/supabase/server";
import type { ShowcaseParticipant } from "@/types/database";

/**
 * Roster público "Participantes" — orden de alta (más viejo primero), igual
 * que un roster real de inscripción. Público (RLS: select para todos), sin
 * relación con el ranking de LoL.
 */
export async function getShowcaseParticipants(): Promise<
  ShowcaseParticipant[]
> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("showcase_participants")
    .select("*")
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Failed to load showcase_participants:", error.message);
    return [];
  }

  return data ?? [];
}

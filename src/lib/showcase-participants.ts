import { createClient } from "@/lib/supabase/server";
import type { ShowcaseParticipant } from "@/types/database";

/**
 * Roster público "Participantes" — siempre alfabético por nombre (A-Z),
 * calculado en cada carga (no un orden guardado) para que un participante
 * nuevo aparezca en su posición correcta y no al final. Se ordena acá en
 * JS con localeCompare("es") en vez de un ORDER BY en la query: la
 * collation por default de Postgres no necesariamente ordena acentos/ñ
 * como corresponde en español (mismo criterio que ya usa
 * getChampionList en lib/champions.ts). Público (RLS: select para
 * todos), sin relación con el ranking de LoL.
 */
export async function getShowcaseParticipants(): Promise<
  ShowcaseParticipant[]
> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("showcase_participants")
    .select("*");

  if (error) {
    console.error("Failed to load showcase_participants:", error.message);
    return [];
  }

  return (data ?? []).sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

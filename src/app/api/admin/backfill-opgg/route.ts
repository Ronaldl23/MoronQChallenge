import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { buildOpggUrl } from "@/lib/opgg";

export const dynamic = "force-dynamic";

/**
 * Rellena opgg_url para participantes que ya existían antes de que ese
 * campo se calculara automáticamente al crearlos (ver /api/participants).
 * Reusa buildOpggUrl tal cual — misma lógica que la creación de
 * participantes, sin duplicarla. Solo toca filas con opgg_url en null; las
 * que ya lo tienen quedan intactas.
 *
 * Protegido con ADMIN_SECRET, mismo criterio que /api/update-rankings con
 * CRON_SECRET: se puede visitar directo desde el navegador agregando
 * ?secret=<ADMIN_SECRET> a la URL, sin pasar primero por el login de
 * /admin.
 */
export async function GET(request: Request) {
  if (!(await isAdminAuthenticated(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const { data: participants, error } = await supabase
    .from("participants")
    .select("id, riot_game_name, riot_tag, region_platform")
    .is("opgg_url", null);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const results: Array<{ participant: string; status: string; opgg_url?: string }> = [];
  let updated = 0;
  let skipped = 0;

  for (const participant of participants ?? []) {
    const label = `${participant.riot_game_name}#${participant.riot_tag}`;

    const opggUrl = buildOpggUrl({
      riotGameName: participant.riot_game_name,
      riotTag: participant.riot_tag,
      regionPlatform: participant.region_platform,
    });

    if (!opggUrl) {
      results.push({
        participant: label,
        status: `region_platform desconocida: ${participant.region_platform}`,
      });
      skipped++;
      continue;
    }

    const { error: updateError } = await supabase
      .from("participants")
      .update({ opgg_url: opggUrl })
      .eq("id", participant.id);

    if (updateError) {
      results.push({ participant: label, status: `db_error: ${updateError.message}` });
      skipped++;
      continue;
    }

    results.push({ participant: label, status: "ok", opgg_url: opggUrl });
    updated++;
  }

  return NextResponse.json({ updated, skipped, results });
}

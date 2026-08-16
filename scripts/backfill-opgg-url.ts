/**
 * Rellena opgg_url para participantes que ya existían antes de que ese
 * campo se calculara automáticamente al crearlos (ver /api/participants).
 * Reusa buildOpggUrl tal cual — misma lógica, sin duplicarla.
 *
 * Uso:
 *   NEXT_PUBLIC_SUPABASE_URL="https://xxx.supabase.co" \
 *   SUPABASE_SECRET_KEY="sb_secret_..." \
 *   npx tsx scripts/backfill-opgg-url.ts
 *
 * Ambos valores están en tu .env.local (son los mismos que usa la app).
 */
import { createClient } from "@supabase/supabase-js";
import { buildOpggUrl } from "../src/lib/opgg";
import type { Database } from "../src/types/database";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;

if (!url || !key) {
  console.error(
    "Faltan NEXT_PUBLIC_SUPABASE_URL y/o SUPABASE_SECRET_KEY en el entorno (mismos valores que en tu .env.local).",
  );
  process.exit(1);
}

const supabase = createClient<Database>(url, key, { auth: { persistSession: false } });

async function main() {
  const { data: participants, error } = await supabase
    .from("participants")
    .select("id, riot_game_name, riot_tag, region_platform")
    .is("opgg_url", null);

  if (error) {
    console.error("Error al leer participants:", error.message);
    process.exit(1);
  }

  if (!participants || participants.length === 0) {
    console.log("Nada que actualizar: todos los participantes ya tienen opgg_url.");
    return;
  }

  console.log(`Encontrados ${participants.length} participante(s) sin opgg_url.\n`);

  let updated = 0;
  let skipped = 0;

  for (const p of participants) {
    const opggUrl = buildOpggUrl({
      riotGameName: p.riot_game_name,
      riotTag: p.riot_tag,
      regionPlatform: p.region_platform,
    });

    if (!opggUrl) {
      console.warn(
        `⚠ ${p.riot_game_name}#${p.riot_tag}: region_platform "${p.region_platform}" desconocida, se omite.`,
      );
      skipped++;
      continue;
    }

    const { error: updateError } = await supabase
      .from("participants")
      .update({ opgg_url: opggUrl })
      .eq("id", p.id);

    if (updateError) {
      console.error(`✗ ${p.riot_game_name}#${p.riot_tag}: ${updateError.message}`);
      skipped++;
      continue;
    }

    console.log(`✓ ${p.riot_game_name}#${p.riot_tag} -> ${opggUrl}`);
    updated++;
  }

  console.log(`\nListo: ${updated} actualizado(s), ${skipped} omitido(s).`);
}

main();

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { buildOpggUrl } from "@/lib/opgg";
import { MAIN_ROLES, type MainRole } from "@/lib/lane";
import {
  resolvePuuid,
  RiotAccountNotFoundError,
  RiotApiError,
  SUPPORTED_PLATFORMS,
} from "@/lib/riot";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!(await isAdminAuthenticated(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const riotApiKey = process.env.RIOT_API_KEY;
  if (!riotApiKey) {
    return NextResponse.json(
      { error: "RIOT_API_KEY no está configurada" },
      { status: 500 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const { nombre_display, riot_game_name, riot_tag, region_platform, avatar_url, main_role } =
    (body ?? {}) as Record<string, unknown>;

  if (
    typeof nombre_display !== "string" ||
    !nombre_display.trim() ||
    typeof riot_game_name !== "string" ||
    !riot_game_name.trim() ||
    typeof riot_tag !== "string" ||
    !riot_tag.trim() ||
    typeof region_platform !== "string" ||
    !region_platform.trim()
  ) {
    return NextResponse.json(
      {
        error:
          "Faltan campos requeridos: nombre_display, riot_game_name, riot_tag, region_platform",
      },
      { status: 400 },
    );
  }

  const platform = region_platform.trim().toUpperCase();
  if (!SUPPORTED_PLATFORMS.includes(platform as (typeof SUPPORTED_PLATFORMS)[number])) {
    return NextResponse.json(
      { error: `region_platform inválida. Usa una de: ${SUPPORTED_PLATFORMS.join(", ")}` },
      { status: 400 },
    );
  }

  let avatarUrl: string | null = null;
  if (typeof avatar_url === "string" && avatar_url.trim()) {
    const trimmed = avatar_url.trim();
    if (!/^https?:\/\//i.test(trimmed)) {
      return NextResponse.json(
        { error: "avatar_url debe ser una URL http(s) válida" },
        { status: 400 },
      );
    }
    avatarUrl = trimmed;
  }

  let mainRole: MainRole | null = null;
  if (typeof main_role === "string" && main_role.trim()) {
    const trimmed = main_role.trim().toUpperCase();
    if (!MAIN_ROLES.includes(trimmed as MainRole)) {
      return NextResponse.json(
        { error: `main_role inválida. Usa una de: ${MAIN_ROLES.join(", ")}` },
        { status: 400 },
      );
    }
    mainRole = trimmed as MainRole;
  }

  let account;
  try {
    account = await resolvePuuid({
      gameName: riot_game_name.trim(),
      tagLine: riot_tag.trim(),
      regionPlatform: platform,
      apiKey: riotApiKey,
    });
  } catch (err) {
    if (err instanceof RiotAccountNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof RiotApiError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Error desconocido al consultar Riot",
      },
      { status: 500 },
    );
  }

  const opggUrl = buildOpggUrl({
    riotGameName: account.gameName,
    riotTag: account.tagLine,
    regionPlatform: platform,
  });

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("participants")
    .insert({
      nombre_display: nombre_display.trim(),
      riot_game_name: account.gameName,
      riot_tag: account.tagLine,
      puuid: account.puuid,
      region_platform: platform,
      avatar_url: avatarUrl,
      opgg_url: opggUrl,
      main_role: mainRole,
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        {
          error:
            "Ese participante ya existe (puuid o riot_game_name+riot_tag duplicado).",
        },
        { status: 409 },
      );
    }
    // Logueado para poder diagnosticar desde los Runtime Logs de Vercel —
    // antes este error solo viajaba en la respuesta HTTP.
    console.error("Insert de participante falló:", error.code, error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    console.error(
      "Insert de participante sin error pero sin fila devuelta (puuid:",
      account.puuid,
      ")",
    );
    return NextResponse.json(
      { error: "El insert no devolvió el participante creado. Revisá si realmente se guardó." },
      { status: 500 },
    );
  }

  return NextResponse.json({ participant: data }, { status: 201 });
}

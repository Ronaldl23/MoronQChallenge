import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminAuthenticated } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!(await isAdminAuthenticated(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const { nombre, photo_url } = (body ?? {}) as Record<string, unknown>;

  if (typeof nombre !== "string" || !nombre.trim()) {
    return NextResponse.json({ error: "Falta el nombre" }, { status: 400 });
  }
  if (typeof photo_url !== "string" || !photo_url.trim()) {
    return NextResponse.json(
      { error: "Falta el link de la foto" },
      { status: 400 },
    );
  }
  const trimmedPhotoUrl = photo_url.trim();
  if (!/^https?:\/\//i.test(trimmedPhotoUrl)) {
    return NextResponse.json(
      { error: "El link de la foto debe ser una URL http(s) válida" },
      { status: 400 },
    );
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("showcase_participants")
    .insert({ nombre: nombre.trim(), photo_url: trimmedPhotoUrl })
    .select()
    .single();

  if (error) {
    console.error(
      "Insert de showcase_participant falló:",
      error.code,
      error.message,
    );
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ participant: data }, { status: 201 });
}

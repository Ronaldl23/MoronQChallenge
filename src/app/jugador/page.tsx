import { getAuthenticatedParticipantId } from "@/lib/player-auth";
import { createClient } from "@/lib/supabase/server";
import { PlayerLoginForm } from "./PlayerLoginForm";

export const dynamic = "force-dynamic";

export default async function JugadorPage() {
  const participantId = await getAuthenticatedParticipantId();

  let nombreDisplay: string | null = null;
  if (participantId) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("participants")
      .select("nombre_display")
      .eq("id", participantId)
      .maybeSingle();
    nombreDisplay = data?.nombre_display ?? null;
  }

  return (
    <div className="min-h-screen bg-zinc-50 px-6 py-16 font-sans dark:bg-black">
      <main className="mx-auto flex w-full max-w-md flex-col gap-8">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
            Mi cuenta — MoronQChallenge
          </h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            {nombreDisplay
              ? "Sesión iniciada."
              : "Ingresá tu código de acceso personal para continuar."}
          </p>
        </header>

        {nombreDisplay ? (
          <div className="flex flex-col gap-2 rounded border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-lg font-semibold text-black dark:text-zinc-50">
              Hola, {nombreDisplay}
            </p>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Sistema de Mangos — próximamente.
            </p>
          </div>
        ) : (
          <PlayerLoginForm />
        )}
      </main>
    </div>
  );
}

import { getAuthenticatedParticipantId } from "@/lib/player-auth";
import { createClient } from "@/lib/supabase/server";
import { Header } from "@/components/Header";
import { FixedLogo } from "@/components/FixedLogo";
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
    <div className="flex min-h-screen flex-col">
      <FixedLogo />
      <Header />
      {/* Mismo patrón de pt-44/sm+ que el resto de páginas: le da lugar al logo fixed. */}
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-6 pt-6 pb-10 sm:pt-44">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight text-text-primary">
            Mi cuenta
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            {nombreDisplay
              ? "Sesión iniciada."
              : "Ingresá tu código de acceso personal para continuar."}
          </p>
        </div>

        {nombreDisplay ? (
          <section className="flex flex-col gap-2 rounded-2xl border border-gold/40 bg-surface p-6 shadow-[0_0_50px_-20px_var(--gold)]">
            <p className="font-display text-2xl font-bold text-text-primary">
              Hola, {nombreDisplay}
            </p>
            <p className="text-sm text-text-secondary">Sistema de Mangos — próximamente.</p>
          </section>
        ) : (
          <section className="rounded-2xl border border-border-hairline bg-surface p-6">
            <PlayerLoginForm />
          </section>
        )}
      </main>
    </div>
  );
}

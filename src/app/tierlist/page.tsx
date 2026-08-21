import { Header } from "@/components/Header";
import { FixedLogo } from "@/components/FixedLogo";
import { TierListBoard } from "@/components/TierListBoard";
import { getShowcaseParticipants } from "@/lib/showcase-participants";

/**
 * El uso de cookies() (vía el cliente de Supabase) ya vuelve esta página
 * dinámica implícitamente, pero se declara explícito — mismo criterio que
 * el resto de las rutas de este proyecto.
 */
export const dynamic = "force-dynamic";

export default async function TierListPage() {
  const participants = await getShowcaseParticipants();

  return (
    <div className="flex min-h-screen flex-col">
      <FixedLogo />
      <Header />
      {/*
        Mismo criterio de espaciado que /participantes: sin indent
        horizontal, sm:pt-44 alcanza para que todo el contenido arranque ya
        por debajo del logo fixed (y:8 a y:208).
      */}
      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-4 px-4 pt-6 pb-10 sm:pt-44">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight text-text-primary">
            Tier List
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            Arrastra a los participantes al tier que le corresponda. Es solo
            para jugar y sacar captura — nada se guarda, así que al recargar la
            página vuelve a empezar de cero.
          </p>
        </div>

        {participants.length === 0 ? (
          <EmptyState />
        ) : (
          <TierListBoard participants={participants} />
        )}
      </main>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="mt-4 flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border-hairline px-8 py-16 text-center">
      <p className="font-display text-lg font-semibold text-text-primary">
        Todavía no hay participantes cargados
      </p>
      <p className="max-w-sm text-sm text-text-secondary">
        Agrégalos desde <code className="font-mono text-gold">/admin</code>.
      </p>
    </div>
  );
}

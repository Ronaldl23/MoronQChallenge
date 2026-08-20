import { Header } from "@/components/Header";
import { FixedLogo } from "@/components/FixedLogo";
import { ShowcasePhoto } from "@/components/ShowcasePhoto";
import { TournamentPhaseCountdown } from "@/components/TournamentPhaseCountdown";
import { getShowcaseParticipants } from "@/lib/showcase-participants";

/**
 * El uso de cookies() (vía el cliente de Supabase) ya vuelve esta página
 * dinámica implícitamente, pero se declara explícito — mismo criterio que
 * el resto de las rutas de este proyecto.
 */
export const dynamic = "force-dynamic";

/**
 * Grilla que se auto-ajusta con la cantidad de participantes: en vez de
 * crecer indefinidamente hacia abajo con tarjetas grandes, a partir de
 * cierto umbral el tile mínimo se achica (auto-fill mete más columnas) y
 * baja el padding/tamaño de foto — más denso cuantos más haya. Los tres
 * escalones cubren los casos probados (5, 15, 30 participantes).
 */
function densityFor(count: number) {
  if (count <= 8) {
    return {
      minTile: 150,
      avatar: 88,
      gap: "gap-4",
      padding: "p-4",
      text: "text-sm",
    };
  }
  if (count <= 20) {
    return {
      minTile: 116,
      avatar: 64,
      gap: "gap-3",
      padding: "p-3",
      text: "text-xs",
    };
  }
  return {
    minTile: 92,
    avatar: 48,
    gap: "gap-2",
    padding: "p-2.5",
    text: "text-[11px]",
  };
}

export default async function ParticipantesPage() {
  const participants = await getShowcaseParticipants();
  const density = densityFor(participants.length);

  return (
    <div className="flex min-h-screen flex-col">
      <FixedLogo />
      <Header />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 pt-6 pb-10 sm:pt-44">
        {/*
          Sin indent horizontal (a diferencia de la home): el logo fixed
          (200px, top-2, left-100 — ver FixedLogo.tsx) ocupa y:8 a y:208 del
          viewport, así que sm:pt-44 (176px, sumado a los ~45px de header)
          alcanza para que TODO el contenido de esta página —el countdown
          incluido, que es lo más arriba— arranque ya por debajo de esa
          franja. Sin nada superpuesto con el logo, no hace falta el
          sm:pl-[336px] que sí necesita la home (donde el título/podio sí
          quedan dentro de esa franja) — así el bloque completo queda
          centrado de verdad en el ancho de main (mx-auto), no desplazado.
          Countdown, título y grilla comparten este mismo contenedor/ancho
          para no repetir el bug anterior de "dos columnas" (grilla a un
          ancho, título a otro).
        */}
        <div>
          <div className="flex justify-center pb-4">
            <TournamentPhaseCountdown />
          </div>

          <h1 className="font-display text-3xl font-bold tracking-tight text-text-primary">
            Participantes
          </h1>

          {participants.length === 0 && <EmptyState />}

          {participants.length > 0 && (
            <div
              className={`mt-6 grid ${density.gap}`}
              style={{
                gridTemplateColumns: `repeat(auto-fill, minmax(${density.minTile}px, 1fr))`,
              }}
            >
              {participants.map((participant) => (
                <div
                  key={participant.id}
                  className={`flex flex-col items-center gap-2 rounded-xl border border-border-hairline bg-surface text-center ${density.padding}`}
                >
                  <ShowcasePhoto
                    name={participant.nombre}
                    photoUrl={participant.photo_url}
                    size={density.avatar}
                  />
                  <span
                    className={`w-full truncate font-medium text-text-primary ${density.text}`}
                  >
                    {participant.nombre}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
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

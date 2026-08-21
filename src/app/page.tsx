import { getLeaderboard } from "@/lib/leaderboard";
import { getDataDragonVersion } from "@/lib/ddragon";

/**
 * El uso de cookies() (vía el cliente de Supabase) ya vuelve esta página
 * dinámica implícitamente, pero se declara explícito — igual que en
 * todas las rutas /api de este proyecto — para no depender de detección
 * implícita si el código de arriba cambia algún día.
 */
export const dynamic = "force-dynamic";
import { Header } from "@/components/Header";
import { FixedLogo } from "@/components/FixedLogo";
import { AutoRefresh } from "@/components/AutoRefresh";
import { LastUpdated } from "@/components/LastUpdated";
import { PodiumCard } from "@/components/PodiumCard";
import { LeaderboardTable } from "@/components/LeaderboardTable";

const FACEBOOK_GROUP_URL = "https://www.facebook.com/groups/1538676923078524";

export default async function Home() {
  const [{ entries, unrankedEntries, lastUpdated }, ddragonVersion] =
    await Promise.all([getLeaderboard(), getDataDragonVersion()]);
  // El podio SOLO mira `entries` (con snapshot/LP real) — nunca
  // unrankedEntries, aunque haya menos de 3 participantes con rango.
  const podium = entries.slice(0, 3);
  const hasAnyEntries = entries.length > 0 || unrankedEntries.length > 0;

  return (
    <div className="flex min-h-screen flex-col">
      <FixedLogo />
      <Header />
      <AutoRefresh />
      {/*
        El logo fixed (200px de alto, top-2, left-100 — ver Logo.tsx) flota
        de x:100 a x:300, y:8 a y:208. El título (angosto, siempre cabe
        aunque se indente) se corre con sm:pl-[336px] — mismo valor que ya
        usa Header.tsx para esto — para no caer bajo esa columna sin
        importar qué tan arriba quede. El podio SÍ necesita el ancho
        completo (se rompe si se lo indenta a 3 columnas en anchos sm/md,
        ver el intento anterior) así que en vez de indentarlo, sm:pt-24 le
        da a la fila del título + el gap de abajo suficiente alto para que
        el podio arranque después de y:208 en cualquier ancho — verificado
        sin overflow ni solapamiento en 640/768/1024/1280/1440/1920px.
      */}
      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-5 px-4 pt-6 pb-10 sm:pt-24">
        <div className="sm:pl-[336px]">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="font-display text-3xl font-bold tracking-tight text-text-primary">
                Ranking
              </h1>
              <p className="mt-1 flex items-center gap-2 text-sm text-text-secondary">
                <span>
                  Recuerda seguir la comunidad de Facebook{" "}
                  <a
                    href={FACEBOOK_GROUP_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold text-text-primary hover:underline"
                  >
                    Morón of Legends
                  </a>{" "}
                  y disfrutar de los memes.
                </span>
                <a
                  href={FACEBOOK_GROUP_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Únete al grupo de Facebook Morón of Legends"
                  className="shrink-0 opacity-90 transition-opacity hover:opacity-100"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- ícono estático local, no necesita optimización de next/image */}
                  <img src="/facebook%20icono.webp" alt="" width={20} height={20} className="rounded" />
                </a>
              </p>
            </div>
            <LastUpdated iso={lastUpdated} />
          </div>

          {!hasAnyEntries && <EmptyState />}
        </div>

        {hasAnyEntries && (
          <>
            {podium.length > 0 && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {podium.map((entry) => (
                  <PodiumCard key={entry.participant.id} entry={entry} ddragonVersion={ddragonVersion} />
                ))}
              </div>
            )}
            <LeaderboardTable
              entries={entries}
              unrankedEntries={unrankedEntries}
              ddragonVersion={ddragonVersion}
            />
          </>
        )}
      </main>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border-hairline px-8 py-16 text-center">
      <p className="font-display text-lg font-semibold text-text-primary">
        Todavía no hay datos
      </p>
      <p className="max-w-sm text-sm text-text-secondary">
        Agrega participantes desde{" "}
        <code className="font-mono text-gold">/admin</code> y espera a que
        corra la primera actualización de rankings.
      </p>
    </div>
  );
}

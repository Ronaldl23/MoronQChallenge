import { getLeaderboard } from "@/lib/leaderboard";
import { getDataDragonVersion } from "@/lib/ddragon";
import { Header } from "@/components/Header";
import { FixedLogo } from "@/components/FixedLogo";
import { AutoRefresh } from "@/components/AutoRefresh";
import { LastUpdated } from "@/components/LastUpdated";
import { PodiumCard } from "@/components/PodiumCard";
import { LeaderboardTable } from "@/components/LeaderboardTable";

const FACEBOOK_GROUP_URL = "https://www.facebook.com/groups/1538676923078524";

export default async function Home() {
  const [{ entries, lastUpdated }, ddragonVersion] = await Promise.all([
    getLeaderboard(),
    getDataDragonVersion(),
  ]);
  const podium = entries.slice(0, 3);

  return (
    <div className="flex min-h-screen flex-col">
      <FixedLogo />
      <Header />
      <AutoRefresh />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-6 pt-44 pb-10">
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

        {entries.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            {podium.length > 0 && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                {podium.map((entry) => (
                  <PodiumCard
                    key={entry.participant.id}
                    entry={entry}
                    ddragonVersion={ddragonVersion}
                  />
                ))}
              </div>
            )}
            <LeaderboardTable entries={entries} ddragonVersion={ddragonVersion} />
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

import { getLeaderboard } from "@/lib/leaderboard";
import { Header } from "@/components/Header";
import { FixedLogo } from "@/components/FixedLogo";
import { PodiumCard } from "@/components/PodiumCard";
import { LeaderboardTable } from "@/components/LeaderboardTable";

export default async function Home() {
  const entries = await getLeaderboard();
  const podium = entries.slice(0, 3);

  return (
    <div className="flex min-h-screen flex-col">
      <FixedLogo />
      <Header />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-6 pt-36 pb-10">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight text-text-primary">
            Ranking
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            Leaderboard SoloQ de la comunidad, actualizado automáticamente.
          </p>
        </div>

        {entries.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            {podium.length > 0 && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                {podium.map((entry) => (
                  <PodiumCard key={entry.participant.id} entry={entry} />
                ))}
              </div>
            )}
            <LeaderboardTable entries={entries} />
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

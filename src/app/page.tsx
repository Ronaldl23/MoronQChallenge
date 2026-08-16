import { createClient } from "@/lib/supabase/server";

type LeaderboardRow = {
  elo_score: number;
  tier: string;
  division: string | null;
  lp: number;
  wins: number;
  losses: number;
  participants: {
    nombre_display: string;
    riot_game_name: string;
    riot_tag: string;
  } | null;
};

async function getLeaderboard(): Promise<LeaderboardRow[]> {
  const supabase = await createClient();

  // Latest snapshot per participant, ranked by elo_score.
  // TODO: replace with a view/RPC once the Riot ingestion job is in place.
  const { data, error } = await supabase
    .from("snapshots")
    .select(
      "elo_score, tier, division, lp, wins, losses, participants(nombre_display, riot_game_name, riot_tag)",
    )
    .order("elo_score", { ascending: false })
    .limit(50);

  if (error) {
    console.error("Failed to load leaderboard:", error.message);
    return [];
  }

  return (data ?? []) as unknown as LeaderboardRow[];
}

export default async function Home() {
  const rows = await getLeaderboard();

  return (
    <div className="min-h-screen bg-zinc-50 px-6 py-16 font-sans dark:bg-black">
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-8">
        <header>
          <h1 className="text-3xl font-semibold tracking-tight text-black dark:text-zinc-50">
            MoronQChallenge Leaderboard
          </h1>
          <p className="mt-2 text-zinc-600 dark:text-zinc-400">
            Ranking SoloQ de la comunidad. Los datos se actualizan desde la API
            de Riot (pendiente de integrar).
          </p>
        </header>

        {rows.length === 0 ? (
          <p className="rounded-lg border border-dashed border-zinc-300 p-8 text-center text-zinc-500 dark:border-zinc-700">
            Aún no hay snapshots cargados. Configura Supabase (
            <code className="font-mono">.env.local</code>) y agrega
            participantes para ver el leaderboard.
          </p>
        ) : (
          <ol className="flex flex-col divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {rows.map((row, i) => (
              <li
                key={`${row.participants?.riot_game_name}-${i}`}
                className="flex items-center justify-between gap-4 px-4 py-3"
              >
                <div className="flex items-center gap-4">
                  <span className="w-6 text-right text-sm text-zinc-400">
                    {i + 1}
                  </span>
                  <span className="font-medium text-black dark:text-zinc-50">
                    {row.participants?.nombre_display ?? "—"}
                  </span>
                </div>
                <div className="flex items-center gap-4 text-sm text-zinc-600 dark:text-zinc-400">
                  <span>
                    {row.tier} {row.division ?? ""} {row.lp} LP
                  </span>
                  <span>
                    {row.wins}W {row.losses}L
                  </span>
                  <span className="font-mono">{row.elo_score}</span>
                </div>
              </li>
            ))}
          </ol>
        )}
      </main>
    </div>
  );
}

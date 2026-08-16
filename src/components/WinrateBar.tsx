export function WinrateBar({ wins, losses }: { wins: number; losses: number }) {
  const total = wins + losses;
  const winPct = total > 0 ? (wins / total) * 100 : 0;

  return (
    <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-surface-hover">
      <div className="h-full bg-win" style={{ width: `${winPct}%` }} />
      <div className="h-full bg-loss" style={{ width: `${100 - winPct}%` }} />
    </div>
  );
}

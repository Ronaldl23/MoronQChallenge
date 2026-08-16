/**
 * opgg_url es null para participantes creados antes de que este campo
 * existiera (la migración no hace backfill) — en ese caso no hay nada que
 * mostrar en vez de un link roto.
 */
export function OpggButton({
  opggUrl,
  inGame,
}: {
  opggUrl: string | null;
  inGame: boolean;
}) {
  if (!opggUrl) return null;

  return (
    <a
      href={opggUrl}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 font-display text-[10px] font-bold tracking-wide uppercase transition-colors ${
        inGame
          ? "bg-live text-bg shadow-[0_0_14px_-2px_var(--live)]"
          : "bg-white/5 text-text-muted hover:bg-white/10"
      }`}
    >
      {inGame && <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-bg/70" />}
      OP.GG
    </a>
  );
}

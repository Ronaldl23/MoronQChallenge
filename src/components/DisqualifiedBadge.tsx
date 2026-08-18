/**
 * Insignia "X" superpuesta en la esquina del avatar de un jugador
 * descalificado (Fase 5) — el elemento padre debe tener `relative` para que
 * el posicionamiento absoluto quede anclado a él (ver LeaderboardTable /
 * PodiumCard, donde envuelven a ProfileIcon en un div `relative shrink-0`).
 *
 * Se queda en su posición normal del ranking (no se mueve al final de la
 * lista) — decisión confirmada con el usuario: como `pardoned` existe en
 * /admin, no tiene sentido tratarlo en la UI como 100% irreversible, y
 * reordenar la lista es más disruptivo que superponer un badge.
 */
export function DisqualifiedBadge() {
  return (
    <span
      className="absolute -right-1 -bottom-1 flex h-4 w-4 items-center justify-center rounded-full bg-loss text-[10px] leading-none font-black text-white ring-2 ring-surface"
      title="Descalificado por no cumplir un castigo asignado"
      aria-label="Descalificado"
    >
      ✕
    </span>
  );
}

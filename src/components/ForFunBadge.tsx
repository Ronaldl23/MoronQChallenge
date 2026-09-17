/**
 * Insignia superpuesta en la esquina del avatar de un jugador en modo "For
 * Fun" (participant.for_fun, ver 0039_for_fun_mode.sql) — mismo patrón que
 * DisqualifiedBadge, pero un color/símbolo distinto para no confundirlos:
 * "For Fun" no es una sanción por incumplimiento puntual, es un estado
 * aparte (no compite por podio/premios, no participa del sistema de
 * Mangos). Se queda en su posición real del ranking — no se reordena nada,
 * solo se marca visualmente.
 */
export function ForFunBadge() {
  return (
    <span
      className="absolute -right-1 -bottom-1 flex h-4 w-4 items-center justify-center rounded-full bg-amber-500 text-[8px] leading-none font-black text-white ring-2 ring-surface"
      title="Modo For Fun — no compite por podio/premios ni participa del sistema de Mangos"
      aria-label="For Fun"
    >
      FF
    </span>
  );
}

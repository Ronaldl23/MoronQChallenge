"use client";

import { useCountdown } from "@/lib/useCountdown";
import { TOURNAMENT_START_DATE, TOURNAMENT_END_DATE } from "@/lib/config";

/**
 * Countdown grande y centrado para /participantes. A diferencia del
 * countdown chico del header (que solo cuenta hasta que arranca el
 * torneo), este cambia de fase solo: mientras no arrancó, cuenta para el
 * inicio (TOURNAMENT_START_DATE); apenas arranca, pasa a contar para el
 * fin (TOURNAMENT_END_DATE, 1 mes después) sin que haga falta recargar la
 * página. Reutiliza useCountdown (mismo diffing que el countdown del
 * header) en vez de duplicar la lógica de fechas.
 */
export function TournamentPhaseCountdown() {
  const toStart = useCountdown(TOURNAMENT_START_DATE);
  const toEnd = useCountdown(TOURNAMENT_END_DATE);

  if (!toStart || !toEnd) {
    return <div className="mx-auto h-20 w-72 rounded-xl bg-surface" />;
  }

  if (toEnd.ended) {
    return (
      <p className="text-center font-display text-lg font-semibold text-win">
        ¡El torneo ya terminó!
      </p>
    );
  }

  const started = toStart.ended;
  const remaining = started ? toEnd : toStart;

  return (
    <div className="flex flex-col items-center gap-2">
      <span className="font-display text-xs font-semibold tracking-widest text-text-secondary uppercase">
        {started ? "El torneo termina en" : "El torneo empieza en"}
      </span>
      <div className="flex items-baseline gap-3 font-display text-4xl font-bold text-gold sm:text-5xl">
        <BigTimeUnit value={remaining.days} label="d" />
        <span className="text-text-muted">:</span>
        <BigTimeUnit value={remaining.hours} label="h" />
        <span className="text-text-muted">:</span>
        <BigTimeUnit value={remaining.minutes} label="m" />
        <span className="text-text-muted">:</span>
        <BigTimeUnit value={remaining.seconds} label="s" />
      </div>
    </div>
  );
}

function BigTimeUnit({ value, label }: { value: number; label: string }) {
  return (
    <span>
      {String(value).padStart(2, "0")}
      <span className="ml-0.5 text-base font-medium text-text-muted sm:text-lg">
        {label}
      </span>
    </span>
  );
}

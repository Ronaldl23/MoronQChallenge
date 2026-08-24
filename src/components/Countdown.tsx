"use client";

import { useCountdown } from "@/lib/useCountdown";
import { TOURNAMENT_START_DATE, TOURNAMENT_END_DATE } from "@/lib/config";

/**
 * Countdown chico del header. Antes solo contaba hasta TOURNAMENT_START_DATE
 * y, una vez llegado ese instante, se quedaba mostrando "¡El torneo ya
 * empezó!" para siempre — nunca pasaba a contar el tiempo restante hasta el
 * FIN del torneo, a diferencia de TournamentPhaseCountdown (el countdown
 * grande de /participantes), que sí cambia de fase sola. Mismo patrón acá:
 * dos useCountdown (uno por instante), decidiendo la fase en cada tick en
 * vez de una sola vez al montar.
 */
export function Countdown() {
  const toStart = useCountdown(TOURNAMENT_START_DATE);
  const toEnd = useCountdown(TOURNAMENT_END_DATE);

  if (!toStart || !toEnd) {
    return <div className="h-5 w-56 rounded bg-surface" />;
  }

  if (toEnd.ended) {
    return (
      <span className="font-display text-sm font-semibold text-win">
        ¡El torneo ya terminó!
      </span>
    );
  }

  const started = toStart.ended;
  const remaining = started ? toEnd : toStart;

  return (
    <div className="flex items-center gap-2 font-display text-sm tracking-wide">
      <span className="hidden text-text-secondary sm:inline">
        {started ? "EL TORNEO TERMINA EN" : "EL TORNEO EMPIEZA EN"}
      </span>
      <div className="flex items-center gap-1 font-semibold">
        <TimeUnit value={remaining.days} label="d" />
        <TimeUnit value={remaining.hours} label="h" />
        <TimeUnit value={remaining.minutes} label="m" />
        <TimeUnit value={remaining.seconds} label="s" />
      </div>
    </div>
  );
}

function TimeUnit({ value, label }: { value: number; label: string }) {
  return (
    <span className="text-gold">
      {String(value).padStart(2, "0")}
      <span className="text-text-muted">{label}</span>
    </span>
  );
}

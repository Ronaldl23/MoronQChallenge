"use client";

import { useCountdown } from "@/lib/useCountdown";

export function Countdown({ targetDate }: { targetDate: string }) {
  const remaining = useCountdown(targetDate);

  if (!remaining) {
    return <div className="h-5 w-56 rounded bg-surface" />;
  }

  if (remaining.ended) {
    return (
      <span className="font-display text-sm font-semibold text-win">
        ¡El torneo ya empezó!
      </span>
    );
  }

  return (
    <div className="flex items-center gap-2 font-display text-sm tracking-wide">
      <span className="hidden text-text-secondary sm:inline">
        EL TORNEO EMPIEZA EN
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

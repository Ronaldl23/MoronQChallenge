"use client";

import { useEffect, useState } from "react";

interface Remaining {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  ended: boolean;
}

function getRemaining(target: number): Remaining {
  const diff = Math.max(0, target - Date.now());
  const totalSeconds = Math.floor(diff / 1000);
  return {
    days: Math.floor(totalSeconds / 86400),
    hours: Math.floor((totalSeconds % 86400) / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
    ended: diff === 0,
  };
}

export function Countdown({ endDate }: { endDate: string }) {
  // Empieza en null en server y cliente por igual, y solo calcula la hora
  // real dentro de useEffect — evita un mismatch de hidratación por reloj.
  const [remaining, setRemaining] = useState<Remaining | null>(null);

  useEffect(() => {
    const target = new Date(endDate).getTime();
    // El primer tick llega al segundo — evita un setState síncrono dentro
    // del efecto (y de paso no compite con el valor que ya viene del SSR).
    const id = setInterval(() => setRemaining(getRemaining(target)), 1000);
    return () => clearInterval(id);
  }, [endDate]);

  if (!remaining) {
    return <div className="h-5 w-56 rounded bg-surface" />;
  }

  if (remaining.ended) {
    return (
      <span className="font-display text-sm font-semibold text-pink">
        El torneo terminó
      </span>
    );
  }

  return (
    <div className="flex items-center gap-2 font-display text-sm tracking-wide">
      <span className="hidden text-text-secondary sm:inline">
        EL TORNEO TERMINA EN
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

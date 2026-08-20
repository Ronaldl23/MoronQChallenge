"use client";

import { useEffect, useState } from "react";

export interface CountdownRemaining {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  ended: boolean;
}

function getRemaining(target: number): CountdownRemaining {
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

/**
 * Tiempo restante hasta targetDate (ISO con sufijo "Z", ver lib/config.ts),
 * recalculado cada segundo. Centraliza el diffing que usan tanto el
 * countdown chico del header como el grande de /participantes — no
 * duplicar esta lógica en cada componente.
 */
export function useCountdown(targetDate: string): CountdownRemaining | null {
  // null en el primer render (server y cliente por igual) — el valor real
  // se calcula recién en el efecto, para evitar un mismatch de hidratación
  // por reloj.
  const [remaining, setRemaining] = useState<CountdownRemaining | null>(null);

  useEffect(() => {
    // new Date() de un ISO con sufijo "Z" siempre se interpreta como UTC —
    // Date.now() también es UTC internamente, así que la resta no depende
    // de la zona horaria del navegador.
    const target = new Date(targetDate).getTime();
    // El primer tick llega al segundo — evita un setState síncrono dentro
    // del efecto (y de paso no compite con el valor que ya viene del SSR).
    const id = setInterval(() => setRemaining(getRemaining(target)), 1000);
    return () => clearInterval(id);
  }, [targetDate]);

  return remaining;
}

import { randomInt } from "node:crypto";
import type { Champion } from "@/lib/champions";

/** 10% de probabilidad confirmada por el usuario de que la ruleta devuelva el mango. */
export const BOUNCE_PROBABILITY_PERCENT = 10;

/** Máximo de mangos que un mismo jugador puede RECIBIR en 24hs (distinto del máximo de 3 en inventario propio, Fase 2). */
export const DAILY_RECEIVE_LIMIT = 3;

export function rollBounce(): boolean {
  return randomInt(100) < BOUNCE_PROBABILITY_PERCENT;
}

export function hoursAgoIso(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

export function pickRandomChampion(champions: Champion[]): Champion {
  if (champions.length === 0) throw new Error("Lista de campeones vacía");
  return champions[randomInt(champions.length)];
}

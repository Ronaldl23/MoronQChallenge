"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { PendingPenaltiesResponse } from "@/app/api/jugador/penalties/pending/route";
import { PENALTY_GAME_LIMIT } from "@/lib/penalty";
import { PunishmentIcon } from "./PunishmentIcon";

const POLL_INTERVAL_MS = 20_000;
/** Va a 2/3 (no 3, que ya otorga un castigo nuevo — ver nonComplianceGrants en src/lib/penalty.ts) — pedido explícito del usuario: avisar ANTES de que sea tarde, no cuando ya pasó. */
const ALERT_THRESHOLD = 2;

/**
 * Botón global fijo, montado una sola vez en el layout raíz (igual que
 * MangoNotifications/ChatWidget) — visible en CUALQUIER página mientras el
 * jugador logueado esté a ALERT_THRESHOLD de PENALTY_GAME_LIMIT partidas sin
 * cumplir NINGUNO de sus castigos pendientes (contador compartido, ver
 * src/lib/penalty.ts). Suena subnormal.mp3 solo en el "flanco de subida" —
 * la primera vez que aparece, no en cada poll mientras siga visible — y
 * vuelve a sonar si desaparece (cumplió, o le dieron otro castigo y el
 * contador bajó a 0) y más adelante reaparece por otra racha sin cumplir.
 */
export function GlobalPenaltyAlert() {
  const [data, setData] = useState<PendingPenaltiesResponse | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUnlockedRef = useRef(false);
  // Flanco de subida: solo se compara contra el valor anterior, no contra un
  // simple "está visible" — así una recarga de página con el aviso YA activo
  // no sea tratada como una aparición nueva y suene de nuevo sin motivo.
  const wasVisibleRef = useRef(false);

  useEffect(() => {
    audioRef.current = new Audio("/subnormal.mp3");

    function unlockAudio() {
      if (audioUnlockedRef.current) return;
      const audio = audioRef.current;
      if (!audio) return;
      audio
        .play()
        .then(() => {
          audio.pause();
          audio.currentTime = 0;
          audioUnlockedRef.current = true;
        })
        .catch(() => {});
    }

    const events: Array<keyof DocumentEventMap> = ["click", "keydown", "touchstart"];
    events.forEach((event) => document.addEventListener(event, unlockAudio));
    return () => {
      events.forEach((event) => document.removeEventListener(event, unlockAudio));
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      const res = await fetch("/api/jugador/penalties/pending");
      if (!res.ok || cancelled) return;
      const body = (await res.json().catch(() => null)) as PendingPenaltiesResponse | null;
      if (!body || cancelled) return;

      const isVisible = body.gamesWithoutCompliance === ALERT_THRESHOLD;
      if (isVisible && !wasVisibleRef.current) {
        audioRef.current?.play().catch(() => {});
      }
      wasVisibleRef.current = isVisible;

      setData(body);
    }

    poll();
    const intervalId = setInterval(poll, POLL_INTERVAL_MS);

    function handleVisibility() {
      if (document.visibilityState === "visible") poll();
    }
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  const isVisible = data?.gamesWithoutCompliance === ALERT_THRESHOLD;
  if (!isVisible) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setIsModalOpen(true)}
        aria-label={`${PENALTY_GAME_LIMIT - ALERT_THRESHOLD} partida(s) para que se te otorgue un castigo nuevo por no cumplir a tiempo`}
        className="penalty-alert-pulse fixed right-4 bottom-[5.25rem] z-[60] flex h-14 w-14 items-center justify-center rounded-full text-white shadow-lg transition-transform hover:scale-105"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- asset local */}
        <img src="/Peligro.png" alt="" className="h-7 w-7 object-contain" />
      </button>

      <AnimatePresence>
        {isModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4"
            onClick={() => setIsModalOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.2 }}
              onClick={(e) => e.stopPropagation()}
              className="flex w-full max-w-md flex-col gap-3 rounded-2xl border border-loss/50 bg-surface p-6 shadow-2xl"
            >
              <div className="flex items-start justify-between gap-3">
                <p className="font-display text-base font-bold text-loss">
                  Estás por recibir un castigo nuevo
                </p>
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  aria-label="Cerrar"
                  className="shrink-0 text-text-muted hover:text-text-primary"
                >
                  ✕
                </button>
              </div>
              <p className="text-sm text-text-secondary">
                Llevas {data?.gamesWithoutCompliance ?? ALERT_THRESHOLD} de {data?.penaltyGameLimit ?? PENALTY_GAME_LIMIT}{" "}
                partidas sin cumplir ninguno de tus castigos pendientes — si no cumplís uno pronto, se te
                otorga otro más.
              </p>
              <ul className="flex flex-col gap-2">
                {(data?.punishments ?? []).map((punishment, i) => (
                  <li
                    key={`${punishment.name}-${i}`}
                    className="flex items-center gap-3 rounded-xl border border-loss/40 bg-bg-elevated px-3 py-2 text-sm font-medium text-text-primary"
                  >
                    <PunishmentIcon
                      iconUrl={punishment.iconUrl ?? "/MangoAngry.png"}
                      noFlash={punishment.noFlash}
                      size={32}
                      imgClassName="h-8 w-8 shrink-0 rounded-full object-cover"
                    />
                    <span>
                      {punishment.isNoncompliancePenalty ? (
                        <span className="text-text-secondary">No cumpliste un castigo a tiempo:</span>
                      ) : punishment.isMoldyTrash ? (
                        <span className="text-text-secondary">Tu mango tirado a la basura tenía hongos:</span>
                      ) : punishment.isBounceBack ? (
                        <span className="text-text-secondary">
                          Se regresó tu mango enviado a {punishment.senderName}:
                        </span>
                      ) : (
                        <span className="text-text-secondary">{punishment.senderName} te envió:</span>
                      )}{" "}
                      {punishment.name}
                    </span>
                  </li>
                ))}
              </ul>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import type { MangoNotification } from "@/app/api/jugador/notifications/route";

const POLL_INTERVAL_MS = 20_000;
const TOAST_AUTO_DISMISS_MS = 8_000;

/**
 * Poll + toast de "te llegó un Mango". Mismo patrón que AutoRefresh del
 * leaderboard (intervalo + refresco inmediato al volver a la pestaña), pero
 * acá el chequeo INICIAL al montar (antes de cualquier intervalo) es lo que
 * cubre el caso de "recibí un mango mientras no estaba logueado": si ya
 * había alguna notificación sin ver esperando, se muestra apenas carga la
 * página, no hace falta esperar al primer tick.
 */
/** penalty_progress.id no alcanza como key: el mismo id puede representar DOS notificaciones distintas (received + flagged_for_review) si el jugador nunca vio la primera antes de que el castigo pasara a revisión. */
function toastKey(n: MangoNotification): string {
  return `${n.kind}:${n.id}`;
}

export function MangoNotifications() {
  const router = useRouter();
  const [toasts, setToasts] = useState<MangoNotification[]>([]);
  // Keys ya encoladas en ESTA carga de página, para no duplicar un toast si
  // dos polls se pisan antes de que el ack termine de confirmarse.
  const queuedKeys = useRef<Set<string>>(new Set());
  // Un solo <audio> reusado (no "new Audio()" cada vez) — el "desbloqueo" de
  // autoplay del navegador queda atado a ESTE elemento en particular, no al
  // origen en general, así que hay que reproducir SIEMPRE el mismo objeto.
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUnlockedRef = useRef(false);

  // El polling inicial (ver comentario de arriba) puede disparar un toast
  // ANTES de que el usuario haya interactuado con la página — y los
  // navegadores bloquean `.play()` de audio con sonido sin un gesto de
  // usuario previo (NotAllowedError, silenciada por el .catch() de abajo,
  // sin ningún aviso visible). Truco estándar: en el primer click/tap/tecla
  // en cualquier parte de la página, reproducir y pausar inmediatamente ese
  // mismo <audio> — eso "cuenta" como reproducir dentro de un gesto real, y
  // el navegador recuerda ese elemento como habilitado para el resto de la
  // sesión, incluso cuando se lo vuelve a llamar fuera de un gesto (poll).
  useEffect(() => {
    audioRef.current = new Audio("/TomaMango.mp3");

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
        .catch(() => {
          // Sigue bloqueado — se reintenta con la próxima interacción.
        });
    }

    const events: Array<keyof DocumentEventMap> = ["click", "keydown", "touchstart"];
    events.forEach((event) => document.addEventListener(event, unlockAudio));

    return () => {
      events.forEach((event) => document.removeEventListener(event, unlockAudio));
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function checkForNotifications() {
      const res = await fetch("/api/jugador/notifications");
      if (!res.ok || cancelled) return;

      const body = await res.json().catch(() => null);
      const notifications = (body?.notifications ?? []) as MangoNotification[];
      const fresh = notifications.filter((n) => !queuedKeys.current.has(toastKey(n)));
      if (fresh.length === 0) return;

      fresh.forEach((n) => queuedKeys.current.add(toastKey(n)));
      setToasts((prev) => [...prev, ...fresh]);

      audioRef.current?.play().catch(() => {});

      const ackRes = await fetch("/api/jugador/notifications/ack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Puede haber ids repetidos acá (un mismo penalty_progress.id con
        // dos kinds distintos) — el endpoint ya marca ambos flags a la vez,
        // así que un id de más en la lista es inofensivo.
        body: JSON.stringify({ ids: fresh.map((n) => n.id) }),
      }).catch(() => null);

      // El banner de "castigos pendientes" se arma server-side — refrescar
      // para que incluya el que recién llegó, sin esperar a un reload manual.
      if (ackRes?.ok) router.refresh();
    }

    checkForNotifications();
    const intervalId = setInterval(checkForNotifications, POLL_INTERVAL_MS);

    function handleVisibility() {
      if (document.visibilityState === "visible") checkForNotifications();
    }
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function dismiss(key: string) {
    setToasts((prev) => prev.filter((t) => toastKey(t) !== key));
  }

  return (
    <div className="pointer-events-none fixed top-4 right-4 z-[60] flex flex-col gap-2">
      <AnimatePresence>
        {toasts.map((toast) => (
          <MangoToast key={toastKey(toast)} notification={toast} onDismiss={() => dismiss(toastKey(toast))} />
        ))}
      </AnimatePresence>
    </div>
  );
}

function MangoToast({
  notification,
  onDismiss,
}: {
  notification: MangoNotification;
  onDismiss: () => void;
}) {
  useEffect(() => {
    const id = setTimeout(onDismiss, TOAST_AUTO_DISMISS_MS);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isFlagged = notification.kind === "flagged_for_review";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 40 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 40 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className={`pointer-events-auto flex w-80 items-center gap-3 rounded-2xl border bg-surface p-4 ${
        isFlagged
          ? "border-gold/50 shadow-[0_0_40px_-12px_var(--gold)]"
          : "border-loss/50 shadow-[0_0_40px_-12px_var(--loss)]"
      }`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- asset local o CDN externo (Data Dragon / Community Dragon) */}
      <img
        src={notification.championIconUrl ?? "/MangoAngry.png"}
        alt=""
        className="h-12 w-12 shrink-0 rounded-lg object-cover"
      />
      <div className="min-w-0 flex-1">
        {isFlagged ? (
          <>
            <p className="font-display text-sm font-bold text-gold">No cumpliste a tiempo</p>
            <p className="truncate text-sm text-text-primary">
              <strong>{notification.championName}</strong> quedó pendiente de revisión.
            </p>
          </>
        ) : (
          <>
            <p className="font-display text-sm font-bold text-loss">¡Te llegó un Mango!</p>
            <p className="truncate text-sm text-text-primary">
              <strong>{notification.senderName}</strong> te envió: <strong>{notification.championName}</strong>
            </p>
          </>
        )}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Cerrar notificación"
        className="shrink-0 text-text-muted hover:text-text-primary"
      >
        ✕
      </button>
    </motion.div>
  );
}

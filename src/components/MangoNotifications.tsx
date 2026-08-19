"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import type { Champion } from "@/lib/champions";
import type { MangoNotification, NotificationsResponse } from "@/app/api/jugador/notifications/route";
import { MangoRevealModal } from "./MangoRevealModal";

const POLL_INTERVAL_MS = 20_000;
const TOAST_AUTO_DISMISS_MS = 8_000;
/**
 * Cuánto esperar DESPUÉS de mostrar el toast de "te llegó un Mango" antes
 * de disparar la ruleta de revelación — la secuencia (sonido → aviso →
 * recién ahí la ruleta) es un requisito explícito del usuario, nunca deben
 * aparecer juntos ni la ruleta primero.
 */
const REVEAL_DELAY_AFTER_TOAST_MS = 2_500;

/** penalty_progress.id no alcanza como key: el mismo id puede representar DOS notificaciones distintas (received + flagged_for_review) si el jugador nunca vio la primera antes de que el castigo pasara a revisión. */
function toastKey(n: MangoNotification): string {
  return `${n.kind}:${n.id}`;
}

/**
 * Poll de 20s (mismo intervalo de siempre) con tres responsabilidades:
 * 1. Toasts de "te llegó un Mango" / "no cumpliste a tiempo" / "X recibió tu
 *    mango" — igual que antes, con sonido.
 * 2. Efecto secundario en el propio GET: refresca participants.last_seen_at
 *    (presencia, ver src/lib/presence.ts) — no hay nada que hacer acá del
 *    lado del cliente para esto, el servidor ya lo hace en cada corrida.
 * 3. Dispara el modal de revelación de la ruleta (MangoRevealModal) cuando
 *    corresponde — SIEMPRE después del toast de "te llegó un Mango" (nunca
 *    antes, nunca en su lugar), tanto para una recepción normal como para
 *    un rebote (ambos casos usan la misma secuencia, confirmado por el
 *    usuario). `pendingReveal` en la respuesta es la verdad actual (no un
 *    evento "nuevo" como `notifications`), así que si el jugador cierra el
 *    modal sin girar, se lo vuelve a ofrecer en el próximo poll — salvo que
 *    ya lo haya descartado en ESTA carga de página (dismissedRevealsRef),
 *    en cuyo caso queda disponible solo desde el banner manual de
 *    /jugador ("Mango en espera").
 */
export function MangoNotifications({ champions }: { champions: Champion[] }) {
  const router = useRouter();
  const [toasts, setToasts] = useState<MangoNotification[]>([]);
  const [revealMangoId, setRevealMangoId] = useState<string | null>(null);
  // Keys ya encoladas en ESTA carga de página, para no duplicar un toast si
  // dos polls se pisan antes de que el ack termine de confirmarse.
  const queuedKeys = useRef<Set<string>>(new Set());
  // Mangos que el jugador cerró sin girar en ESTA carga de página — no se
  // vuelven a ofrecer solos hasta un reload/pestaña nueva (siguen
  // disponibles desde /jugador mientras tanto).
  const dismissedRevealsRef = useRef<Set<string>>(new Set());
  // Evita programar el mismo reveal dos veces si un poll llega mientras el
  // setTimeout del poll anterior todavía no disparó.
  const revealScheduledRef = useRef<string | null>(null);
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

      const body = (await res.json().catch(() => null)) as NotificationsResponse | null;
      const notifications = body?.notifications ?? [];
      const pendingReveal = body?.pendingReveal ?? null;

      const fresh = notifications.filter((n) => !queuedKeys.current.has(toastKey(n)));
      let justShowedToast = false;

      if (fresh.length > 0) {
        fresh.forEach((n) => queuedKeys.current.add(toastKey(n)));
        setToasts((prev) => [...prev, ...fresh]);
        justShowedToast = true;

        audioRef.current?.play().catch(() => {});

        const ackRes = await fetch("/api/jugador/notifications/ack", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items: fresh.map((n) => ({ id: n.id, kind: n.kind })) }),
        }).catch(() => null);

        // El banner de "castigos pendientes" se arma server-side — refrescar
        // para que incluya el que recién llegó, sin esperar a un reload manual.
        if (ackRes?.ok) router.refresh();
      }

      if (
        pendingReveal &&
        !dismissedRevealsRef.current.has(pendingReveal.mangoId) &&
        revealScheduledRef.current !== pendingReveal.mangoId
      ) {
        revealScheduledRef.current = pendingReveal.mangoId;
        const delay = justShowedToast ? REVEAL_DELAY_AFTER_TOAST_MS : 0;
        setTimeout(() => {
          if (cancelled) return;
          setRevealMangoId(pendingReveal.mangoId);
        }, delay);
      }
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

  function handleRevealClose() {
    if (revealMangoId) dismissedRevealsRef.current.add(revealMangoId);
    revealScheduledRef.current = null;
    setRevealMangoId(null);
  }

  function handleRevealed() {
    revealScheduledRef.current = null;
    setRevealMangoId(null);
    router.refresh();
  }

  return (
    <>
      <div className="pointer-events-none fixed top-4 right-4 z-[60] flex flex-col gap-2">
        <AnimatePresence>
          {toasts.map((toast) => (
            <MangoToast key={toastKey(toast)} notification={toast} onDismiss={() => dismiss(toastKey(toast))} />
          ))}
        </AnimatePresence>
      </div>
      {revealMangoId && (
        <MangoRevealModal
          mangoId={revealMangoId}
          champions={champions}
          onClose={handleRevealClose}
          onRevealed={handleRevealed}
        />
      )}
    </>
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

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 40 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 40 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className={`pointer-events-auto flex w-80 items-center gap-3 rounded-2xl border bg-surface p-4 ${
        notification.kind === "received"
          ? "border-loss/50 shadow-[0_0_40px_-12px_var(--loss)]"
          : "border-gold/50 shadow-[0_0_40px_-12px_var(--gold)]"
      }`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- asset local o CDN externo (Data Dragon / Community Dragon) */}
      <img
        src={notification.championIconUrl ?? "/MangoAngry.png"}
        alt=""
        className="h-12 w-12 shrink-0 rounded-lg object-cover"
      />
      <div className="min-w-0 flex-1">
        {notification.kind === "flagged_for_review" && (
          <>
            <p className="font-display text-sm font-bold text-gold">No cumpliste a tiempo</p>
            <p className="truncate text-sm text-text-primary">
              <strong>{notification.championName}</strong> quedó pendiente de revisión.
            </p>
          </>
        )}
        {notification.kind === "received" && (
          <>
            <p className="font-display text-sm font-bold text-loss">¡Te llegó un Mango!</p>
            <p className="truncate text-sm text-text-primary">
              <strong>{notification.otherPartyName}</strong> te envió un Mango.
            </p>
          </>
        )}
        {notification.kind === "launcher_reveal" && (
          <>
            <p className="font-display text-sm font-bold text-gold">¡Tu mango llegó a destino!</p>
            <p className="truncate text-sm text-text-primary">
              <strong>{notification.otherPartyName}</strong> recibió tu mango con el castigo:{" "}
              <strong>{notification.championName}</strong>.
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

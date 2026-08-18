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
export function MangoNotifications() {
  const router = useRouter();
  const [toasts, setToasts] = useState<MangoNotification[]>([]);
  // Ids ya encolados en ESTA carga de página, para no duplicar un toast si
  // dos polls se pisan antes de que el ack termine de confirmarse.
  const queuedIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;

    async function checkForNotifications() {
      const res = await fetch("/api/jugador/notifications");
      if (!res.ok || cancelled) return;

      const body = await res.json().catch(() => null);
      const notifications = (body?.notifications ?? []) as MangoNotification[];
      const fresh = notifications.filter((n) => !queuedIds.current.has(n.id));
      if (fresh.length === 0) return;

      fresh.forEach((n) => queuedIds.current.add(n.id));
      setToasts((prev) => [...prev, ...fresh]);

      new Audio("/TomaMango.mp3").play().catch(() => {});

      const ackRes = await fetch("/api/jugador/notifications/ack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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

  function dismiss(id: string) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  return (
    <div className="pointer-events-none fixed top-4 right-4 z-[60] flex flex-col gap-2">
      <AnimatePresence>
        {toasts.map((toast) => (
          <MangoToast key={toast.id} notification={toast} onDismiss={() => dismiss(toast.id)} />
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

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 40 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 40 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className="pointer-events-auto flex w-80 items-center gap-3 rounded-2xl border border-loss/50 bg-surface p-4 shadow-[0_0_40px_-12px_var(--loss)]"
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- asset local */}
      <img
        src={notification.championIconUrl ?? "/MangoAngry.png"}
        alt=""
        className="h-12 w-12 shrink-0 rounded-lg object-cover"
      />
      <div className="min-w-0 flex-1">
        <p className="font-display text-sm font-bold text-loss">¡Te llegó un Mango!</p>
        <p className="truncate text-sm text-text-primary">
          <strong>{notification.senderName}</strong> te envió: <strong>{notification.championName}</strong>
        </p>
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

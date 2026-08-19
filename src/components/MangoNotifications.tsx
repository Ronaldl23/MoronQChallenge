"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import type { Champion } from "@/lib/champions";
import type { MangoNotification, NotificationsResponse } from "@/app/api/jugador/notifications/route";
import { MangoRevealWidget } from "./MangoRevealWidget";

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
 * 1. Toasts de "no cumpliste a tiempo" / "X recibió tu mango" — se muestran
 *    de inmediato, en batch, con sonido, como siempre.
 * 2. Efecto secundario en el propio GET: refresca participants.last_seen_at
 *    (presencia, ver src/lib/presence.ts) — no hay nada que hacer acá del
 *    lado del cliente para esto, el servidor ya lo hace en cada corrida.
 * 3. Cola de revelación 100% automática: cada mango 'pending_reveal'
 *    dirigido a este jugador (`pendingReveals`, verdad actual e
 *    independiente de `notifications`) se procesa uno por uno, del más
 *    antiguo al más nuevo — sonido → toast "te llegó un Mango" → (delay) →
 *    MangoRevealWidget gira la ruleta solo, sin ningún click. Recién cuando
 *    ese termina (`onDone`) arranca el ciclo completo del siguiente, nunca
 *    se solapan dos. El widget no bloquea el resto del sitio (sin backdrop,
 *    vive flotando en la misma esquina que los toasts) — el jugador puede
 *    seguir navegando mientras se procesa la cola.
 */
export function MangoNotifications({ champions }: { champions: Champion[] }) {
  const router = useRouter();
  const [toasts, setToasts] = useState<MangoNotification[]>([]);
  const [activeRevealMangoId, setActiveRevealMangoId] = useState<string | null>(null);
  // Keys ya encoladas en ESTA carga de página, para no duplicar un toast si
  // dos polls se pisan antes de que el ack termine de confirmarse.
  const queuedKeys = useRef<Set<string>>(new Set());
  // Notificaciones "received" ya vistas por el poll pero todavía no
  // mostradas — esperan su turno en la cola de revelación en vez de
  // aparecer todas juntas.
  const receivedByMangoIdRef = useRef<Map<string, MangoNotification>>(new Map());
  // Cola de mangoIds pendientes de revelar, del más antiguo al más nuevo.
  const revealQueueRef = useRef<string[]>([]);
  // Todos los mangoIds ya encolados alguna vez en esta carga de página —
  // evita reencolar el mismo id en cada poll mientras sigue pendiente.
  const knownPendingIdsRef = useRef<Set<string>>(new Set());
  // Espejo síncrono de activeRevealMangoId — null = libre para arrancar el
  // siguiente de la cola, no-null = ya hay uno en curso (evita solapar dos
  // ciclos sonido→toast→ruleta si un poll llega mientras el delay del
  // anterior todavía no disparó).
  const activeRevealRef = useRef<string | null>(null);
  // Un solo <audio> reusado (no "new Audio()" cada vez) — el "desbloqueo" de
  // autoplay del navegador queda atado a ESTE elemento en particular, no al
  // origen en general, así que hay que reproducir SIEMPRE el mismo objeto.
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUnlockedRef = useRef(false);
  // Evita setState después de que el componente se desmontó (setTimeout de
  // advanceQueue puede seguir vivo un instante más).
  const mountedRef = useRef(true);

  useEffect(() => {
    // En React Strict Mode (dev) este efecto monta, desmonta y vuelve a
    // montar de una — sin esta línea, `mountedRef` queda en `false` para
    // siempre después de esa simulación y el setTimeout de advanceQueue()
    // nunca más dispara setActiveRevealMangoId (bug real, no solo de dev).
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

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

  // Si ya hay una revelación en curso, no hace nada — se vuelve a llamar
  // desde handleRevealDone() cuando esa termine. Así la cola nunca solapa
  // dos ciclos sonido→toast→ruleta a la vez.
  function advanceQueue() {
    if (activeRevealRef.current !== null) return;
    const nextId = revealQueueRef.current.shift();
    if (!nextId) return;

    const receivedNotif = receivedByMangoIdRef.current.get(nextId);
    activeRevealRef.current = nextId;

    if (receivedNotif) {
      receivedByMangoIdRef.current.delete(nextId);
      setToasts((prev) => [...prev, receivedNotif]);
      audioRef.current?.play().catch(() => {});

      fetch("/api/jugador/notifications/ack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: [{ id: receivedNotif.id, kind: receivedNotif.kind }] }),
      }).catch(() => null);

      setTimeout(() => {
        if (!mountedRef.current) return;
        setActiveRevealMangoId(nextId);
      }, REVEAL_DELAY_AFTER_TOAST_MS);
    } else {
      // Ya se había mostrado el toast en una carga anterior (ej. se
      // recargó la página a mitad de la secuencia) — no repetir sonido ni
      // aviso, ir directo a la ruleta.
      setActiveRevealMangoId(nextId);
    }
  }

  function handleRevealDone() {
    activeRevealRef.current = null;
    setActiveRevealMangoId(null);
    router.refresh();
    advanceQueue();
  }

  useEffect(() => {
    let cancelled = false;

    async function checkForNotifications() {
      const res = await fetch("/api/jugador/notifications");
      if (!res.ok || cancelled) return;

      const body = (await res.json().catch(() => null)) as NotificationsResponse | null;
      const notifications = body?.notifications ?? [];
      const pendingReveals = body?.pendingReveals ?? [];
      const pendingRevealMangoIds = new Set(pendingReveals.map((p) => p.mangoId));

      // "received" solo se encola para la ruleta si su mango sigue
      // 'pending_reveal' AHORA (verdad actual del servidor, en
      // pendingReveals) — es el caso normal. Si no está ahí (dato viejo: el
      // mango ya se reveló por otro camino sin llegar a ackear este toast,
      // por ejemplo antes de este rediseño) no hay ninguna ruleta que
      // vaya a arrancar para él — encolarlo lo dejaría esperando un turno
      // que nunca llega. En ese caso se trata como un toast inmediato más
      // (el servidor ya lo resuelve con el campeón real, no hay spoiler).
      const freshImmediate = notifications.filter(
        (n) =>
          (n.kind !== "received" || !pendingRevealMangoIds.has(n.mangoId)) &&
          !queuedKeys.current.has(toastKey(n)),
      );
      if (freshImmediate.length > 0) {
        freshImmediate.forEach((n) => queuedKeys.current.add(toastKey(n)));
        setToasts((prev) => [...prev, ...freshImmediate]);
        audioRef.current?.play().catch(() => {});

        const ackRes = await fetch("/api/jugador/notifications/ack", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items: freshImmediate.map((n) => ({ id: n.id, kind: n.kind })) }),
        }).catch(() => null);

        // El banner de "castigos pendientes" se arma server-side — refrescar
        // para que incluya el que recién llegó, sin esperar a un reload manual.
        if (ackRes?.ok) router.refresh();
      }

      // "received" con mango todavía 'pending_reveal': no se muestran de
      // inmediato — esperan su turno en la cola de revelación
      // (advanceQueue), para que el ciclo completo sonido→toast→ruleta se
      // repita mango por mango en vez de mostrar todos los toasts de golpe.
      notifications
        .filter(
          (n) => n.kind === "received" && pendingRevealMangoIds.has(n.mangoId) && !queuedKeys.current.has(toastKey(n)),
        )
        .forEach((n) => {
          queuedKeys.current.add(toastKey(n));
          receivedByMangoIdRef.current.set(n.mangoId, n);
        });

      pendingReveals.forEach(({ mangoId }) => {
        if (!knownPendingIdsRef.current.has(mangoId)) {
          knownPendingIdsRef.current.add(mangoId);
          revealQueueRef.current.push(mangoId);
        }
      });

      advanceQueue();
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
      {activeRevealMangoId && (
        <MangoRevealWidget mangoId={activeRevealMangoId} champions={champions} onDone={handleRevealDone} />
      )}
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
              <strong>{notification.otherPartyName}</strong> te envió un Mango
              {/* Solo tiene campeón acá si ya se había revelado por otro
                  lado sin llegar a mostrar este toast (dato viejo) — el
                  caso normal (mango recién llegado) sigue sin spoiler,
                  la ruleta lo revela después. */}
              {notification.championName ? (
                <>
                  : <strong>{notification.championName}</strong>
                </>
              ) : (
                "."
              )}
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

"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { ProfileIcon } from "./ProfileIcon";
import { isChatOpenAt } from "@/lib/chat-lock";
import { hasTournamentStarted } from "@/lib/tournament-schedule";
import { TOURNAMENT_START_DATE, TOURNAMENT_END_DATE } from "@/lib/config";

/** setTimeout desborda y dispara de inmediato pasado esto (~24.8 días, límite de un entero de 32 bits) — si el instante todavía está más lejos, no se programa (un reload normal antes de esa fecha ya trae el estado correcto). */
const MAX_TIMEOUT_MS = 2_147_483_000;
import type { ChatMessage } from "@/types/database";

const MAX_MESSAGE_LENGTH = 500;

function formatClockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("es", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface Me {
  participantId: string;
  nombreDisplay: string;
  avatarUrl: string | null;
  profileIconId: number | null;
}

/**
 * Fila de un mensaje de sistema ('mango_event' / 'rank_event') — centrada,
 * sin el tratamiento de burbuja mía/ajena de un mensaje de jugador (no le
 * corresponde a nadie en particular, es un anuncio para todo el salón), con
 * un ícono de evento en vez del avatar de un participante.
 */
function SystemChatMessageRow({ msg }: { msg: ChatMessage }) {
  return (
    <div className="flex items-center justify-center gap-2 py-1">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center">
        {msg.type === "mango_event" || msg.type === "mango_moldy_event" ? (
          // eslint-disable-next-line @next/next/no-img-element -- ícono de evento fijo, no una foto de perfil dinámica
          <img
            src={msg.type === "mango_moldy_event" ? "/MangoPodridoFurioso.png" : "/MangoAngry.png"}
            alt=""
            className="h-6 w-6 object-contain"
          />
        ) : (
          <svg
            viewBox="0 0 20 20"
            className={`h-4 w-4 ${msg.rank_direction === "up" ? "text-win" : "text-loss"}`}
            fill="currentColor"
            aria-hidden
          >
            {msg.rank_direction === "up" ? (
              <path d="M10 3.5a1 1 0 0 1 .78.375l5.5 6.875A1 1 0 0 1 15.5 12.5H12v4.5a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1v-4.5H4.5a1 1 0 0 1-.78-1.625l5.5-6.875A1 1 0 0 1 10 3.5Z" />
            ) : (
              <path d="M10 16.5a1 1 0 0 1-.78-.375l-5.5-6.875A1 1 0 0 1 4.5 7.5H8V3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v4.5h3.5a1 1 0 0 1 .78 1.625l-5.5 6.875a1 1 0 0 1-.78.375Z" />
            )}
          </svg>
        )}
      </span>
      <p className="text-center text-xs text-text-secondary italic">
        {msg.message}
      </p>
    </div>
  );
}

/**
 * Widget flotante de chat global. Un solo salón compartido, con mensajes de
 * jugador ('user') y de sistema ('mango_event'/'rank_event', Fase B — ver
 * SystemChatMessageRow) intercalados en el mismo historial. Se suscribe a
 * Realtime apenas monta (no recién al abrir el panel) para poder sonar y
 * marcar no-leídos incluso con el chat cerrado o la pestaña sin foco.
 * Solo se monta en el layout cuando hay sesión de /jugador activa — el
 * admin no participa, y sin sesión ni siquiera existe el botón.
 */
export function ChatWidget({
  me,
  ddragonVersion,
}: {
  me: Me;
  ddragonVersion: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);

  // Ventana de escritura del torneo — el historial siempre se puede leer,
  // pero el formulario se deshabilita fuera de [inicio, fin). El chequeo
  // real (que nadie pueda escribir con un POST directo) vive server-side
  // en /api/chat/send; esto es solo la comodidad de la UI. null en el
  // primer render (server y cliente por igual, mismo criterio que
  // useCountdown) para evitar un mismatch de hidratación por reloj — se
  // recalcula en un efecto.
  //
  // En vez de sondear cada tanto (lo que antes hacía esto con un
  // setInterval de 60s, dejando el chat hasta 1 minuto "atrasado" respecto
  // al instante real en que arranca/termina el torneo), se programa un
  // setTimeout EXACTO para cada uno de esos dos instantes — chatOpen
  // cambia en el mismo momento en que isChatOpenAt lo considera true/false,
  // sin esperar al próximo tick de un poll ni necesitar un reload.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    // setTimeout(0) en vez de llamar setNow directo acá: un setState
    // síncrono dentro del cuerpo del efecto dispara un re-render en
    // cascada (regla react-hooks/set-state-in-effect) — deferirlo evita
    // eso sin que la persona note ninguna demora real.
    const timers = [setTimeout(tick, 0)];
    for (const iso of [TOURNAMENT_START_DATE, TOURNAMENT_END_DATE]) {
      const msUntil = new Date(iso).getTime() - Date.now();
      if (msUntil > 0 && msUntil <= MAX_TIMEOUT_MS) timers.push(setTimeout(tick, msUntil));
    }
    return () => timers.forEach(clearTimeout);
  }, []);
  const chatOpen =
    now !== null && isChatOpenAt(now, TOURNAMENT_START_DATE, TOURNAMENT_END_DATE);
  const closedReason =
    now === null || chatOpen
      ? null
      : !hasTournamentStarted(now)
        ? "El chat se abre el día del torneo."
        : "El chat cerró — el torneo ya terminó.";

  // Espejos síncronos de isOpen/foco para leer el valor ACTUAL dentro del
  // callback de Realtime, que se registra una sola vez al montar y de otra
  // forma quedaría con el isOpen de ese primer render (closure vieja).
  const isOpenRef = useRef(isOpen);
  const hasFocusRef = useRef(true);
  // Mensajes escritos por jugadores vs. eventos de sistema (mango
  // revelado, ascenso/descenso de liga) suenan distinto — ver el
  // comentario en la suscripción de Realtime más abajo.
  const messageAudioRef = useRef<HTMLAudioElement | null>(null);
  const eventAudioRef = useRef<HTMLAudioElement | null>(null);
  const audioUnlockedRef = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    isOpenRef.current = isOpen;
    if (isOpen && hasFocusRef.current) setUnreadCount(0);
  }, [isOpen]);

  // Historial inicial: últimos 50 mensajes, antes de que empiecen a llegar
  // los nuevos en vivo por Realtime.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/chat/messages")
      .then((res) => res.json())
      .then((body) => {
        if (!cancelled && Array.isArray(body?.messages)) {
          setMessages(body.messages as ChatMessage[]);
        }
      })
      .catch(() => {
        // Sin historial inicial el chat igual sigue funcionando para los
        // mensajes nuevos que lleguen por Realtime — no es bloqueante.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Mismo patrón de desbloqueo de audio que MangoNotifications (ver ese
  // componente para el detalle): el primer click/tecla/tap en cualquier
  // parte de la página reproduce y pausa este <audio> de inmediato, así el
  // navegador lo recuerda habilitado para cuando de verdad haga falta
  // sonar (llegada de un mensaje nuevo), que puede pasar sin gesto previo.
  useEffect(() => {
    messageAudioRef.current = new Audio("/NotificacionMensaje.mp3");
    eventAudioRef.current = new Audio("/NotificacionEvento.mp3");

    function unlockOne(audio: HTMLAudioElement) {
      return audio
        .play()
        .then(() => {
          audio.pause();
          audio.currentTime = 0;
          return true;
        })
        .catch(() => false);
    }

    function unlockAudio() {
      if (audioUnlockedRef.current) return;
      const audios = [messageAudioRef.current, eventAudioRef.current];
      if (audios.some((audio) => !audio)) return;
      Promise.all(audios.map((audio) => unlockOne(audio!))).then((results) => {
        // Solo se marca desbloqueado si los dos sonidos realmente
        // arrancaron — si no, se reintenta con la próxima interacción
        // (igual que el comportamiento original con un solo audio).
        if (results.every(Boolean)) audioUnlockedRef.current = true;
      });
    }

    const events: Array<keyof DocumentEventMap> = [
      "click",
      "keydown",
      "touchstart",
    ];
    events.forEach((event) => document.addEventListener(event, unlockAudio));
    return () => {
      events.forEach((event) =>
        document.removeEventListener(event, unlockAudio),
      );
    };
  }, []);

  // Foco de la pestaña: hasFocusRef decide si un mensaje nuevo debe sonar
  // (ver el handler de Realtime más abajo). Al recuperar el foco con el
  // panel ya abierto, se descuenta el badge — igual que abrir el panel.
  useEffect(() => {
    function handleFocus() {
      hasFocusRef.current = true;
      if (isOpenRef.current) setUnreadCount(0);
    }
    function handleBlur() {
      hasFocusRef.current = false;
    }
    function handleVisibilityChange() {
      if (document.visibilityState === "visible") handleFocus();
      else handleBlur();
    }

    hasFocusRef.current = document.hasFocus();
    window.addEventListener("focus", handleFocus);
    window.addEventListener("blur", handleBlur);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("blur", handleBlur);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  // Suscripción a Realtime: arranca apenas monta el widget (no recién al
  // abrir el panel), para que el sonido/badge de no-leídos funcionen
  // incluso con el chat cerrado.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("chat_messages_changes")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_messages" },
        (payload) => {
          const incoming = payload.new as ChatMessage;
          setMessages((prev) =>
            prev.some((m) => m.id === incoming.id) ? prev : [...prev, incoming],
          );

          // Para 'mango_event' el participant_id es siempre el RECEPTOR del
          // mango — como ya escuchó TomaMango.mp3 en su notificación
          // personal (MangoNotifications), esta comparación de paso lo
          // excluye del sonido/badge del chat: el anuncio es informativo
          // para todos los demás, no para quien ya se enteró por su cuenta.
          const isFromSomeoneElse =
            incoming.participant_id !== me.participantId;
          const shouldNotify =
            isFromSomeoneElse && (!isOpenRef.current || !hasFocusRef.current);
          if (shouldNotify) {
            setUnreadCount((prev) => prev + 1);
            // Eventos de sistema NUNCA usan TomaMango.mp3 (ese sonido es
            // exclusivo de la notificación personal) — acá siempre es
            // NotificacionMensaje.mp3 (mensajes de jugador) o
            // NotificacionEvento.mp3 (mango_event/rank_event).
            const audio =
              incoming.type === "user"
                ? messageAudioRef.current
                : eventAudioRef.current;
            audio?.play().catch(() => {});
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [me.participantId]);

  // Auto-scroll al último mensaje cuando el panel está abierto.
  useEffect(() => {
    if (isOpen) messagesEndRef.current?.scrollIntoView({ block: "end" });
  }, [messages, isOpen]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed || sending || !chatOpen) return;

    setSending(true);
    setSendError(null);
    try {
      const res = await fetch("/api/chat/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setSendError(body?.error ?? "No se pudo enviar el mensaje");
        return;
      }
      setDraft("");
    } catch {
      setSendError("No se pudo enviar el mensaje");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed right-4 bottom-4 z-[60] flex flex-col items-end gap-3">
      {isOpen && (
        <div
          className={
            // Mobile (< sm): panel casi de pantalla completa (fixed, se sale
            // del flujo del wrapper) — a 1.5x el tamaño anterior ya no entra
            // cómodo como card flotante en la mayoría de celulares. En sm+
            // vuelve a ser un card flotante normal dentro del wrapper, con
            // min() para que en ventanas de escritorio bajas (poca altura)
            // el panel se achique en vez de salirse por arriba de la
            // pantalla — 140px reservados para el botón, los gaps y el
            // margen inferior/superior.
            "fixed inset-3 z-50 flex flex-col overflow-hidden rounded-2xl border border-border-hairline bg-surface shadow-2xl " +
            "sm:static sm:inset-auto sm:z-auto sm:h-[min(720px,calc(100vh-140px))] sm:w-[calc(100vw-2rem)] sm:max-w-[540px]"
          }
        >
          <div className="flex items-center justify-between border-b border-border-hairline bg-bg-elevated px-4 py-3">
            <p className="font-display text-sm font-bold tracking-wide text-text-primary uppercase">
              Chat del torneo
            </p>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              aria-label="Cerrar chat"
              className="flex h-6 w-6 items-center justify-center rounded-full text-text-secondary transition-colors hover:bg-white/10 hover:text-text-primary"
            >
              <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor">
                <path d="M4.293 4.293a1 1 0 0 1 1.414 0L10 8.586l4.293-4.293a1 1 0 1 1 1.414 1.414L11.414 10l4.293 4.293a1 1 0 0 1-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 0 1-1.414-1.414L8.586 10 4.293 5.707a1 1 0 0 1 0-1.414Z" />
              </svg>
            </button>
          </div>

          <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
            {messages.length === 0 && (
              <p className="mt-6 text-center text-xs text-text-secondary">
                Todavía no hay mensajes. ¡Sé el primero en escribir!
              </p>
            )}
            {messages.map((msg) => {
              if (msg.type !== "user") {
                return <SystemChatMessageRow key={msg.id} msg={msg} />;
              }
              const isMine = msg.participant_id === me.participantId;
              return (
                <div
                  key={msg.id}
                  className={`flex gap-2 ${isMine ? "flex-row-reverse" : ""}`}
                >
                  <ProfileIcon
                    name={msg.sender_name}
                    avatarUrl={msg.sender_avatar_url}
                    profileIconId={msg.sender_profile_icon_id}
                    ddragonVersion={ddragonVersion}
                    size={28}
                  />
                  <div
                    className={`flex max-w-[76%] flex-col ${isMine ? "items-end" : "items-start"}`}
                  >
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-xs font-semibold text-text-primary">
                        {isMine ? "Vos" : msg.sender_name}
                      </span>
                      <span className="text-[10px] text-text-muted">
                        {formatClockTime(msg.created_at)}
                      </span>
                    </div>
                    <p
                      className={`rounded-xl px-3 py-1.5 text-sm break-words whitespace-pre-wrap ${
                        isMine
                          ? "bg-gold/15 text-text-primary"
                          : "bg-white/5 text-text-primary"
                      }`}
                    >
                      {msg.message}
                    </p>
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>

          <form
            onSubmit={handleSubmit}
            className="flex flex-col gap-1 border-t border-border-hairline p-3"
          >
            {closedReason && (
              <p className="px-1 pb-1 text-xs font-medium text-gold">{closedReason}</p>
            )}
            <div className="flex items-center gap-2">
              <input
                value={draft}
                onChange={(event) =>
                  setDraft(event.target.value.slice(0, MAX_MESSAGE_LENGTH))
                }
                maxLength={MAX_MESSAGE_LENGTH}
                placeholder={chatOpen ? "Escribe un mensaje..." : "El chat está cerrado"}
                disabled={sending || !chatOpen}
                className="flex-1 rounded-full border border-border-hairline bg-bg px-3.5 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-gold/50 focus:outline-none disabled:opacity-60"
              />
              <button
                type="submit"
                disabled={sending || !chatOpen || !draft.trim()}
                aria-label="Enviar mensaje"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gold text-bg transition-opacity disabled:opacity-40"
              >
                <svg
                  viewBox="0 0 20 20"
                  className="h-4 w-4"
                  fill="currentColor"
                >
                  <path d="M2.5 17.5 17.5 10 2.5 2.5 2.5 8.5 12.5 10 2.5 11.5Z" />
                </svg>
              </button>
            </div>
            {sendError && <p className="px-1 text-xs text-loss">{sendError}</p>}
          </form>
        </div>
      )}

      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-label={isOpen ? "Cerrar chat" : "Abrir chat"}
        className={
          // En mobile el panel abierto es casi pantalla completa (ver
          // arriba) — la burbuja flotante quedaría encimada sobre el panel,
          // así que se oculta ahí y se confía en la X del header para
          // cerrar. En sm+ el panel es un card chico y la burbuja sigue
          // siendo el botón de cerrar/abrir de siempre.
          "relative h-14 w-14 items-center justify-center rounded-full bg-gold text-bg shadow-lg transition-transform hover:scale-105 " +
          (isOpen ? "hidden sm:flex" : "flex")
        }
      >
        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor">
          <path d="M4 4h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H8l-4.6 3.45A.5.5 0 0 1 2.6 20V6a2 2 0 0 1 1.4-1.9Z" />
        </svg>
        {!isOpen && unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-loss px-1 text-[11px] font-bold text-white ring-2 ring-bg">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>
    </div>
  );
}

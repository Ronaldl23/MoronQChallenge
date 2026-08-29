"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LaunchModal, type LaunchTarget } from "./LaunchModal";

export interface InventoryMango {
  id: string;
  /** inventory_since + MANGO_EXPIRY_HOURS (ver src/lib/mango-launch.ts) — cuándo se pudre este mango si no se lanza antes. MangoSlot arma la cuenta regresiva y decide "podrido" comparando esto contra la hora actual del cliente. */
  expiresAt: string;
}

export interface QuestProgressView {
  current: number;
  target: number;
}

export interface MangoLeaderboardEntry {
  name: string;
  count: number;
}

export interface MangoStatsView {
  /** Mangos ORIGINALES (no el que nace de un rebote) que lanzaste, contando toda la vida del torneo — llegaran a destino o hayan rebotado. */
  launched: number;
  /** Castigos que te tocó cumplir en total — normales o por rebote de un lanzamiento tuyo, cuentan igual. */
  received: number;
  /** De los que lanzaste vos, cuántos rebotaron. */
  bounced: number;
  topLaunchers: MangoLeaderboardEntry[];
  topReceivers: MangoLeaderboardEntry[];
}

const MAX_SLOTS = 3;

export function InventoryPanel({
  mangos,
  winStreak,
  kdaStreak,
  deathlessWin,
  beatParticipant,
  otherParticipants,
  launchBlocked,
  mangoStats,
}: {
  mangos: InventoryMango[];
  winStreak: QuestProgressView;
  kdaStreak: QuestProgressView;
  deathlessWin: QuestProgressView;
  beatParticipant: QuestProgressView;
  otherParticipants: LaunchTarget[];
  /** true si ya tiene MÁS de MAX_ACTIVE_PENALTIES castigos activos propios (ver canLaunchMango en src/lib/mango-launch.ts) — puede pasar con un rebote propio estando ya en el tope, la única excepción aceptada. El chequeo real (que esto solo refleja) vive en /api/jugador/mangos/launch. */
  launchBlocked: boolean;
  mangoStats: MangoStatsView;
}) {
  const router = useRouter();
  const [selectedMangoId, setSelectedMangoId] = useState<string | null>(null);

  function handleClose() {
    setSelectedMangoId(null);
  }

  function handleComplete() {
    setSelectedMangoId(null);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-2xl border border-border-hairline bg-surface p-6">
        <h2 className="font-display text-lg font-semibold text-gold">Inventario de Mangos</h2>
        <p className="mt-1 text-sm text-text-secondary">
          Pasá el mouse por un mango y hacé click para lanzarlo.
        </p>
        <div className="mt-4 flex gap-4">
          {Array.from({ length: MAX_SLOTS }, (_, i) => mangos[i] ?? null).map((mango, i) => (
            <MangoSlot
              key={mango?.id ?? `empty-${i}`}
              filled={!!mango}
              expiresAt={mango?.expiresAt}
              onClick={mango && !launchBlocked ? () => setSelectedMangoId(mango.id) : undefined}
            />
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-border-hairline bg-surface p-6">
        <h2 className="font-display text-lg font-semibold text-gold">Estadísticas</h2>
        <div className="mt-4 grid grid-cols-3 gap-3">
          <StatTile label="Lanzados" value={mangoStats.launched} />
          <StatTile label="Recibidos" value={mangoStats.received} />
          <StatTile label="Rebotados" value={mangoStats.bounced} />
        </div>
        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          <MangoTopList title="Top lanzadores" entries={mangoStats.topLaunchers} />
          <MangoTopList title="Top receptores" entries={mangoStats.topReceivers} />
        </div>
      </section>

      <section className="rounded-2xl border border-border-hairline bg-surface p-6">
        <h2 className="font-display text-lg font-semibold text-gold">Misiones</h2>
        <div className="mt-4 flex flex-col gap-4">
          <QuestBar label="Racha de victorias" current={winStreak.current} target={winStreak.target} />
          <QuestBar
            label="5 partidas con KDA 5+"
            current={kdaStreak.current}
            target={kdaStreak.target}
          />
          <QuestBar
            label="Victoria sin morir"
            current={deathlessWin.current}
            target={deathlessWin.target}
          />
          <QuestBar
            label="Ganar contra otro participante del torneo"
            current={beatParticipant.current}
            target={beatParticipant.target}
          />
        </div>
      </section>

      {selectedMangoId && (
        <LaunchModal
          mangoId={selectedMangoId}
          otherParticipants={otherParticipants}
          onClose={handleClose}
          onComplete={handleComplete}
        />
      )}
    </div>
  );
}

/** Cuánto falta para MANGO_EXPIRY_HOURS, refrescado cada minuto mientras el slot esté montado (ver useEffect en MangoSlot) — no hace falta más precisión que minutos para una ventana de 24hs. */
function useMillisRemaining(expiresAt: string | undefined): number | null {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!expiresAt) return;
    const interval = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(interval);
  }, [expiresAt]);

  if (!expiresAt) return null;
  return new Date(expiresAt).getTime() - now;
}

/** "23h 45m" con más de una hora restante, "45m" con menos de una — igual que cualquier cuenta regresiva de vencimiento. */
function formatTimeRemaining(millis: number): string {
  const totalMinutes = Math.max(0, Math.floor(millis / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function MangoSlot({
  filled,
  expiresAt,
  onClick,
}: {
  filled: boolean;
  /** undefined para un slot vacío — ver InventoryMango.expiresAt para uno lleno. */
  expiresAt?: string;
  onClick?: () => void;
}) {
  const [hover, setHover] = useState(false);
  const clickable = filled && !!onClick;
  const millisRemaining = useMillisRemaining(expiresAt);
  // Podrido (24h+ sin lanzarse, ver MANGO_EXPIRY_HOURS): MangoPodrido/
  // MangoPodridoFurioso en vez de MangoHappy/MangoAngry — mismo hover,
  // solo cambia qué imagen usa.
  const isExpired = millisRemaining !== null && millisRemaining <= 0;
  const idleImage = isExpired ? "/MangoPodrido.png" : "/MangoHappy.png";
  const hoverImage = isExpired ? "/MangoPodridoFurioso.png" : "/MangoAngry.png";

  return (
    <div className="flex flex-col items-center gap-1">
      <button
        type="button"
        disabled={!clickable}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onClick={onClick}
        aria-label={filled ? "Lanzar mango" : "Slot vacío"}
        title={filled && isExpired ? "Este mango está podrido: más chance de que rebote" : undefined}
        className={`group relative flex h-24 w-24 items-center justify-center rounded-xl border-2 transition-colors ${
          filled
            ? "cursor-pointer border-gold/50 bg-bg-elevated hover:border-gold"
            : "border-dashed border-border-hairline bg-bg-elevated/40"
        }`}
      >
        {filled ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- asset local */}
            <img
              src={hover ? hoverImage : idleImage}
              alt="Mango"
              className="h-16 w-16 object-contain"
            />
            {hover && (
              <span className="absolute -top-8 rounded-full border border-border-hairline bg-bg-elevated px-2 py-1 text-xs font-semibold whitespace-nowrap text-text-primary shadow-lg">
                Lanzar
              </span>
            )}
          </>
        ) : (
          <span className="h-3 w-3 rounded-full bg-border-hairline" aria-hidden />
        )}
      </button>
      {filled && millisRemaining !== null && (
        <span className={`text-xs font-semibold ${isExpired ? "text-loss" : "text-text-secondary"}`}>
          {isExpired ? "Podrido" : formatTimeRemaining(millisRemaining)}
        </span>
      )}
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-xl border border-border-hairline bg-bg-elevated py-3">
      <span className="font-display text-2xl font-bold text-text-primary">{value}</span>
      <span className="text-xs text-text-secondary">{label}</span>
    </div>
  );
}

function MangoTopList({ title, entries }: { title: string; entries: MangoLeaderboardEntry[] }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-text-secondary">{title}</h3>
      {entries.length === 0 ? (
        <p className="mt-2 text-xs text-text-muted">Todavía no hay datos.</p>
      ) : (
        <ol className="mt-2 flex flex-col gap-1.5">
          {entries.map((entry, i) => (
            <li key={entry.name} className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 text-text-primary">
                <span className="text-xs font-semibold text-text-muted">{i + 1}.</span>
                {entry.name}
              </span>
              <span className="font-semibold text-gold">{entry.count}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function QuestBar({ label, current, target }: { label: string; current: number; target: number }) {
  const pct = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
  return (
    <div>
      <div className="flex items-center justify-between text-sm text-text-secondary">
        <span>{label}</span>
        <span className="font-semibold text-text-primary">
          {current} de {target}
        </span>
      </div>
      <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-bg-elevated">
        <div
          className="h-full rounded-full bg-gold transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

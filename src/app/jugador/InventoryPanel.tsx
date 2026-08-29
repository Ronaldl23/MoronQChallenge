"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LaunchModal, type LaunchTarget } from "./LaunchModal";

export interface InventoryMango {
  id: string;
  /** 24h+ en el inventario sin lanzarse (ver isMangoExpired/MANGO_EXPIRY_HOURS) — cambia el ícono y, al lanzarlo, sube su chance de rebote (eso lo decide el servidor). */
  isExpired: boolean;
}

export interface QuestProgressView {
  current: number;
  target: number;
}

const MAX_SLOTS = 3;

export function InventoryPanel({
  mangos,
  winStreak,
  kdaStreak,
  deathlessWin,
  beatParticipant,
  otherParticipants,
}: {
  mangos: InventoryMango[];
  winStreak: QuestProgressView;
  kdaStreak: QuestProgressView;
  deathlessWin: QuestProgressView;
  beatParticipant: QuestProgressView;
  otherParticipants: LaunchTarget[];
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
              isExpired={mango?.isExpired ?? false}
              onClick={mango ? () => setSelectedMangoId(mango.id) : undefined}
            />
          ))}
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

function MangoSlot({
  filled,
  isExpired,
  onClick,
}: {
  filled: boolean;
  isExpired: boolean;
  onClick?: () => void;
}) {
  const [hover, setHover] = useState(false);
  const clickable = filled && !!onClick;
  // Podrido (24h+ sin lanzarse, ver isMangoExpired): MangoPodrido/
  // MangoPodridoFurioso en vez de MangoHappy/MangoAngry — mismo hover,
  // solo cambia qué imagen usa.
  const idleImage = isExpired ? "/MangoPodrido.png" : "/MangoHappy.png";
  const hoverImage = isExpired ? "/MangoPodridoFurioso.png" : "/MangoAngry.png";

  return (
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

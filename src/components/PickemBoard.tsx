"use client";

import { useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { PickemDraggableItem } from "./PickemDraggableItem";
import type { ShowcaseParticipant } from "@/types/database";

type SaveStatus = { type: "idle" } | { type: "saving" } | { type: "saved" } | { type: "error"; message: string };

/**
 * Lista única ordenada 1..N (no tiers) — a diferencia de TierListBoard acá
 * alcanza con un solo DndContext/SortableContext vertical: no hay
 * contenedores múltiples, así que closestCenter (el criterio estándar de
 * dnd-kit para listas simples) sirve sin el pointerWithin/closestCorners
 * combinado que necesita /tierlist para sus filas angostas.
 */
export function PickemBoard({
  roster,
  initialOrder,
}: {
  roster: ShowcaseParticipant[];
  initialOrder: string[];
}) {
  const participantsById = useMemo(
    () => new Map(roster.map((p) => [p.id, p])),
    [roster],
  );

  const [order, setOrder] = useState<string[]>(initialOrder);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [status, setStatus] = useState<SaveStatus>({ type: "idle" });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveId(null);
    if (!over || active.id === over.id) return;

    setOrder((prev) => {
      const activeIndex = prev.indexOf(String(active.id));
      const overIndex = prev.indexOf(String(over.id));
      if (activeIndex === -1 || overIndex === -1) return prev;
      return arrayMove(prev, activeIndex, overIndex);
    });
    setStatus({ type: "idle" });
  }

  async function handleSave() {
    setStatus({ type: "saving" });
    const res = await fetch("/api/pickem/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setStatus({ type: "error", message: body?.error ?? "No se pudo guardar" });
      return;
    }
    setStatus({ type: "saved" });
  }

  const activeParticipant = activeId ? participantsById.get(activeId) : undefined;

  return (
    <div className="flex flex-col gap-4">
      <DndContext
        id="pickem"
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={order} strategy={verticalListSortingStrategy}>
          <ol className="flex flex-col gap-1.5">
            {order.map((participantId, index) => {
              const participant = participantsById.get(participantId);
              if (!participant) return null;
              return (
                <li key={participantId}>
                  <PickemDraggableItem rank={index + 1} participant={participant} />
                </li>
              );
            })}
          </ol>
        </SortableContext>

        <DragOverlay>
          {activeParticipant ? (
            <PickemDraggableItem
              rank={order.indexOf(activeParticipant.id) + 1}
              participant={activeParticipant}
              dragging
            />
          ) : null}
        </DragOverlay>
      </DndContext>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={status.type === "saving"}
          className="rounded-full bg-gold px-5 py-2 font-display text-sm font-bold tracking-wide text-bg uppercase transition-colors hover:bg-gold-soft disabled:opacity-50"
        >
          {status.type === "saving" ? "Guardando..." : "Guardar"}
        </button>
        {status.type === "saved" && (
          <span className="text-sm font-medium text-win">Pick&apos;em guardado.</span>
        )}
        {status.type === "error" && (
          <span className="text-sm font-medium text-loss">{status.message}</span>
        )}
      </div>
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { TierListCard } from "./TierListCard";
import { TierListContainer } from "./TierListContainer";
import { TierListRow } from "./TierListRow";
import { TIER_COLOR, TIER_LABEL } from "@/lib/tiers";
import type { ShowcaseParticipant } from "@/types/database";

const UNASSIGNED = "UNASSIGNED";

/**
 * Un solo tier "Retador / Master" en vez de tres filas separadas (Challenger/
 * Grandmaster/Master, como en el RankTier real del sitio) — es un tier list
 * para jugar y sacar captura, no un mapeo literal de rango; separarlos solo
 * iba a dejar dos de las tres filas de arriba casi siempre vacías. El resto
 * de los tiers SÍ reusan la escala real (mismos labels/colores que
 * TierBadge/TierEmblem en el resto del sitio).
 */
const TIERS = [
  { id: "APEX", label: "Retador / Master", color: TIER_COLOR.CHALLENGER },
  { id: "DIAMOND", label: TIER_LABEL.DIAMOND, color: TIER_COLOR.DIAMOND },
  { id: "EMERALD", label: TIER_LABEL.EMERALD, color: TIER_COLOR.EMERALD },
  { id: "PLATINUM", label: TIER_LABEL.PLATINUM, color: TIER_COLOR.PLATINUM },
  { id: "GOLD", label: TIER_LABEL.GOLD, color: TIER_COLOR.GOLD },
  { id: "SILVER", label: TIER_LABEL.SILVER, color: TIER_COLOR.SILVER },
  { id: "BRONZE", label: TIER_LABEL.BRONZE, color: TIER_COLOR.BRONZE },
  { id: "IRON", label: TIER_LABEL.IRON, color: TIER_COLOR.IRON },
] as const;

type ContainerId = (typeof TIERS)[number]["id"] | typeof UNASSIGNED;
type BoardState = Record<ContainerId, string[]>;

function initialState(participants: ShowcaseParticipant[]): BoardState {
  const state = { [UNASSIGNED]: participants.map((p) => p.id) } as BoardState;
  for (const tier of TIERS) state[tier.id] = [];
  return state;
}

/**
 * Tablero de tier list "efímero": todo vive en useState, nada se manda a
 * Supabase ni a localStorage — recargar la página, navegar a otra ruta o
 * cerrar la pestaña resetea todo a "sin asignar" (a propósito, ver el
 * pedido original: es para jugar y sacar captura, no para guardar un
 * resultado).
 */
export function TierListBoard({
  participants,
}: {
  participants: ShowcaseParticipant[];
}) {
  const participantsById = useMemo(
    () => new Map(participants.map((p) => [p.id, p])),
    [participants],
  );

  const [items, setItems] = useState<BoardState>(() =>
    initialState(participants),
  );
  const [activeId, setActiveId] = useState<string | null>(null);

  // PointerSensor con distancia mínima: sin esto, cualquier click normal
  // (ej. sin querer mover 1px el mouse) ya cuenta como drag. TouchSensor con
  // delay: en touch hace falta distinguir "mantener apretado para arrastrar"
  // de "estoy scrolleando la página" — sin el delay, cualquier scroll
  // vertical sobre una ficha la agarraría por error.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  function findContainer(id: string): ContainerId | undefined {
    if (id === UNASSIGNED || TIERS.some((t) => t.id === id))
      return id as ContainerId;
    return (Object.keys(items) as ContainerId[]).find((key) =>
      items[key].includes(id),
    );
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  // Mueve la ficha al contenedor de destino EN VIVO mientras se arrastra
  // (no recién al soltar) — así el usuario ve el hueco abrirse del otro
  // lado a medida que pasa el mouse/dedo, patrón estándar de dnd-kit para
  // "multiple containers". El orden FINAL dentro del contenedor de destino
  // se resuelve en handleDragEnd.
  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over) return;

    const activeId = String(active.id);
    const overId = String(over.id);
    const activeContainer = findContainer(activeId);
    const overContainer = findContainer(overId);
    if (!activeContainer || !overContainer || activeContainer === overContainer)
      return;

    setItems((prev) => {
      const activeItems = prev[activeContainer];
      const overItems = prev[overContainer];
      const overIndex = overItems.indexOf(overId);

      const isOverContainerItself = overId === overContainer;
      const newIndex = isOverContainerItself
        ? overItems.length
        : Math.max(overIndex, 0);

      return {
        ...prev,
        [activeContainer]: activeItems.filter((id) => id !== activeId),
        [overContainer]: [
          ...overItems.slice(0, newIndex),
          activeId,
          ...overItems.slice(newIndex),
        ],
      };
    });
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveId(null);
    if (!over) return;

    const activeId = String(active.id);
    const overId = String(over.id);
    const activeContainer = findContainer(activeId);
    const overContainer = findContainer(overId);
    if (!activeContainer || !overContainer || activeContainer !== overContainer)
      return;

    const activeIndex = items[activeContainer].indexOf(activeId);
    const overIndex = items[overContainer].indexOf(overId);
    if (activeIndex !== -1 && overIndex !== -1 && activeIndex !== overIndex) {
      setItems((prev) => ({
        ...prev,
        [overContainer]: arrayMove(prev[overContainer], activeIndex, overIndex),
      }));
    }
  }

  const activeParticipant = activeId
    ? participantsById.get(activeId)
    : undefined;

  return (
    <DndContext
      // id fijo: sin esto dnd-kit genera ids incrementales (DndDescribedBy-N)
      // que no coinciden entre el render de servidor y la primera pasada del
      // cliente, y React tira un warning de hydration mismatch en cada carga.
      id="tierlist"
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <div className="order-last flex flex-1 flex-col gap-2 lg:order-first">
          {TIERS.map((tier) => (
            <TierListRow
              key={tier.id}
              id={tier.id}
              label={tier.label}
              color={tier.color}
              items={items[tier.id]}
              participantsById={participantsById}
            />
          ))}
        </div>

        <div className="flex flex-col gap-2 rounded-xl border border-border-hairline bg-surface p-3 lg:sticky lg:top-20 lg:w-72 lg:shrink-0">
          <p className="font-display text-xs font-bold tracking-wider text-text-secondary uppercase">
            Sin asignar ({items[UNASSIGNED].length})
          </p>
          <TierListContainer
            id={UNASSIGNED}
            items={items[UNASSIGNED]}
            participantsById={participantsById}
            emptyHint="Arrastra a alguien de vuelta acá"
          />
        </div>
      </div>

      <DragOverlay>
        {activeParticipant ? (
          <TierListCard participant={activeParticipant} dragging />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

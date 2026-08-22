"use client";

import { useState } from "react";
import { PickemOrderedList } from "./PickemOrderedList";
import type { ShowcaseParticipant } from "@/types/database";
import type { PickemPositionStatus } from "@/lib/pickem-logic";

/**
 * Fila colapsable — arranca CERRADA a propósito (pedido explícito: con
 * varios pick'ems ya guardados, mostrar todos expandidos a la vez de una
 * marea de fichas chiquitas apiladas). El botón muestra "Mirar Pick'em de
 * X" tal cual — cada persona se abre/cierra por separado, sin afectar a
 * las demás.
 */
export function PickemCommunityCard({
  ownerLabel,
  order,
  participantsById,
  resultStatuses,
}: {
  ownerLabel: string;
  order: string[];
  participantsById: Map<string, ShowcaseParticipant>;
  resultStatuses: PickemPositionStatus[] | null;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-xl border border-border-hairline bg-bg-elevated">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="font-display text-sm font-bold tracking-wide text-text-primary">
          {expanded ? "Ocultar" : "Mirar"} Pick&apos;em de {ownerLabel}
        </span>
        <svg
          viewBox="0 0 20 20"
          className={`h-4 w-4 shrink-0 text-text-muted transition-transform ${expanded ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M5 7.5l5 5 5-5" />
        </svg>
      </button>
      {expanded && (
        <div className="px-4 pb-4">
          <PickemOrderedList
            order={order}
            participantsById={participantsById}
            resultStatuses={resultStatuses}
          />
        </div>
      )}
    </div>
  );
}

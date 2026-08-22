"use client";

import { useState } from "react";
import { PickemOrderedList } from "./PickemOrderedList";
import { ProfileIcon } from "./ProfileIcon";
import type { ShowcaseParticipant } from "@/types/database";
import type { CommunityPickemEntry } from "@/lib/pickem";
import type { PickemPositionStatus } from "@/lib/pickem-logic";

/**
 * Fila colapsable — arranca CERRADA a propósito (pedido explícito: con
 * varios pick'ems ya guardados, mostrar todos expandidos a la vez es una
 * marea de fichas chiquitas apiladas). Cada persona se abre/cierra por
 * separado (el click en toda la fila alterna, la flecha indica el estado).
 *
 * Jugadores: foto de perfil (mismo ProfileIcon que el resto del sitio,
 * avatar manual > ícono de invocador > iniciales) + "Pick'em [Nombre]".
 * Invitados: sin foto (no tienen una) — solo su nombre, pedido explícito
 * ("que sea el nombre del invitado y ya").
 */
export function PickemCommunityCard({
  entry,
  ddragonVersion,
  order,
  participantsById,
  resultStatuses,
}: {
  entry: CommunityPickemEntry;
  ddragonVersion: string;
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
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left"
      >
        {entry.ownerType === "participant" ? (
          <>
            <ProfileIcon
              name={entry.ownerLabel}
              avatarUrl={entry.avatarUrl}
              profileIconId={entry.profileIconId}
              ddragonVersion={ddragonVersion}
              size={28}
            />
            <span className="min-w-0 flex-1 truncate font-display text-sm font-bold tracking-wide text-text-primary">
              Pick&apos;em {entry.ownerLabel}
            </span>
          </>
        ) : (
          <span className="min-w-0 flex-1 truncate font-display text-sm font-bold tracking-wide text-text-primary">
            {entry.ownerLabel}
          </span>
        )}
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
        <div className="px-3 pb-3">
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

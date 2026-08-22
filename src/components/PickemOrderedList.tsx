import { ShowcasePhoto } from "./ShowcasePhoto";
import type { ShowcaseParticipant } from "@/types/database";
import type { PickemPositionStatus } from "@/lib/pickem";

const STATUS_CLASSNAME: Record<PickemPositionStatus, string> = {
  correct: "border-win/50 bg-win/10",
  incorrect: "border-loss/50 bg-loss/10",
  unknown: "border-border-hairline bg-surface",
};

/**
 * Lista numerada de solo lectura — se usa para el pick de un invitado/jugador
 * ya bloqueado (no se puede volver a arrastrar) y para cada tarjeta de
 * "Pick'em de la comunidad". `resultStatuses` viene null antes de la
 * revelación (sin ningún color, tal cual se guardó) y con un status por
 * posición una vez que /admin reveló los resultados.
 *
 * `columns=2` parte la lista en dos mitades lado a lado (1..mitad a la
 * izquierda, mitad+1..N a la derecha) — mismo criterio que PickemBoard,
 * para que el pick completo entre sin scroll. Se usa en "Tu Pick'em" ya
 * bloqueado (misma columna ancha que el tablero editable); las tarjetas
 * de "Pick'em de la comunidad" son más angostas y se quedan en 1 columna.
 */
export function PickemOrderedList({
  order,
  participantsById,
  resultStatuses = null,
  columns = 1,
}: {
  order: string[];
  participantsById: Map<string, ShowcaseParticipant>;
  resultStatuses?: PickemPositionStatus[] | null;
  columns?: 1 | 2;
}) {
  function renderRow(participantId: string, index: number) {
    const participant = participantsById.get(participantId);
    if (!participant) return null;
    const status = resultStatuses?.[index] ?? null;
    return (
      <li
        key={participantId}
        className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 ${
          status ? STATUS_CLASSNAME[status] : "border-border-hairline bg-surface"
        }`}
      >
        <span className="w-7 shrink-0 text-right font-display text-base font-bold text-text-muted">
          {index + 1}
        </span>
        <ShowcasePhoto name={participant.nombre} photoUrl={participant.photo_url} size={36} />
        <span className="line-clamp-1 min-w-0 flex-1 text-base font-medium text-text-primary">
          {participant.nombre}
        </span>
      </li>
    );
  }

  if (columns === 1) {
    return (
      <ol className="flex flex-col gap-2">
        {order.map((participantId, index) => renderRow(participantId, index))}
      </ol>
    );
  }

  const half = Math.ceil(order.length / 2);
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <ol className="flex flex-col gap-2">
        {order.slice(0, half).map((participantId, index) => renderRow(participantId, index))}
      </ol>
      <ol className="flex flex-col gap-2">
        {order
          .slice(half)
          .map((participantId, index) => renderRow(participantId, half + index))}
      </ol>
    </div>
  );
}

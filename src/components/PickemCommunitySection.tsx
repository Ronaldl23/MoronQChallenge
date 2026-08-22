import { PickemCommunityCard } from "./PickemCommunityCard";
import { computePickemResultStatus } from "@/lib/pickem";
import type { CommunityPickemEntry } from "@/lib/pickem";
import type { ShowcaseParticipant } from "@/types/database";

/**
 * "Pick'em de la comunidad" — pública, sin sesión. Solo lista a quien YA
 * guardó un pick (sin placeholders vacíos para el resto, pedido explícito).
 * Lista compacta de filas colapsables (una por persona) en vez de una
 * grilla de tarjetas siempre abiertas — con varios pick'ems guardados esa
 * grilla se sentía abrumadora ("me pierdo, me mareo"), así que acá cada
 * fila arranca cerrada y se abre individualmente.
 */
export function PickemCommunitySection({
  entries,
  participantsById,
  finalRankByName,
  resultsRevealed,
}: {
  entries: CommunityPickemEntry[];
  participantsById: Map<string, ShowcaseParticipant>;
  finalRankByName: Map<string, number>;
  resultsRevealed: boolean;
}) {
  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="font-display text-xl font-bold text-text-primary">
          Pick&apos;em de la comunidad
        </h2>
        <p className="mt-1 text-sm text-text-secondary">
          {entries.length === 0
            ? "Todavía nadie guardó su Pick'em."
            : "Predicciones ya guardadas por jugadores e invitados."}
        </p>
      </div>

      {entries.length > 0 && (
        <div className="flex max-w-xl flex-col gap-2">
          {entries.map((entry) => (
            <PickemCommunityCard
              key={entry.ownerLabel}
              ownerLabel={entry.ownerLabel}
              order={entry.order}
              participantsById={participantsById}
              resultStatuses={
                resultsRevealed
                  ? computePickemResultStatus(entry.order, participantsById, finalRankByName)
                  : null
              }
            />
          ))}
        </div>
      )}
    </section>
  );
}

import { PickemOrderedList } from "./PickemOrderedList";
import { computePickemResultStatus } from "@/lib/pickem";
import type { CommunityPickemEntry } from "@/lib/pickem";
import type { ShowcaseParticipant } from "@/types/database";

/**
 * "Pick'em de la comunidad" — pública, sin sesión. Solo lista a quien YA
 * guardó un pick (sin placeholders vacíos para el resto, pedido explícito).
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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {entries.map((entry) => (
            <div
              key={entry.ownerLabel}
              className="flex flex-col gap-3 rounded-xl border border-border-hairline bg-bg-elevated p-4"
            >
              <p className="font-display text-sm font-bold tracking-wide text-text-primary uppercase">
                Pick&apos;em de {entry.ownerLabel}
              </p>
              <PickemOrderedList
                order={entry.order}
                participantsById={participantsById}
                resultStatuses={
                  resultsRevealed
                    ? computePickemResultStatus(entry.order, participantsById, finalRankByName)
                    : null
                }
              />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

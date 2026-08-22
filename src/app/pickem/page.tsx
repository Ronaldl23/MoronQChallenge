import Link from "next/link";
import {
  computePickemResultStatus,
  getCommunityPickem,
  getFinalRankByName,
  getPickemRoster,
  getPickemSettings,
  getPickemViewerIdentity,
  getSavedPickOrder,
  isPickemLocked,
} from "@/lib/pickem";
import { getDataDragonVersion } from "@/lib/ddragon";
import { Header } from "@/components/Header";
import { FixedLogo } from "@/components/FixedLogo";
import { PickemBoard } from "@/components/PickemBoard";
import { PickemOrderedList } from "@/components/PickemOrderedList";
import { PickemCommunitySection } from "@/components/PickemCommunitySection";
import { PickemGuestLogoutButton } from "@/components/PickemGuestLogoutButton";

export const dynamic = "force-dynamic";

export default async function PickemPage() {
  const [identity, roster, settings, ddragonVersion] = await Promise.all([
    getPickemViewerIdentity(),
    getPickemRoster(),
    getPickemSettings(),
    getDataDragonVersion(),
  ]);

  const locked = isPickemLocked();
  const participantsById = new Map(roster.map((p) => [p.id, p]));

  const [savedOrder, communityEntries, finalRankByName] = await Promise.all([
    identity ? getSavedPickOrder(identity) : Promise.resolve(null),
    getCommunityPickem(),
    settings.resultsRevealed ? getFinalRankByName() : Promise.resolve(new Map<string, number>()),
  ]);

  return (
    <div className="flex min-h-screen flex-col">
      <FixedLogo />
      <Header />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 pt-6 pb-10 sm:pt-44">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight text-text-primary">
            Pick&apos;em
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            Premio al Pick&apos;em Perfecto: $25
          </p>
        </div>

        {locked && (
          <p className="rounded-lg border border-gold/40 bg-gold/10 px-4 py-2 text-sm font-medium text-gold">
            El Pick&apos;em está bloqueado — el torneo ya arrancó, no se puede editar.
          </p>
        )}
        {settings.resultsRevealed && (
          <p className="rounded-lg border border-win/40 bg-win/10 px-4 py-2 text-sm font-medium text-win">
            Resultados revelados — cada posición se marca en verde (acertada) o rojo (no acertada).
          </p>
        )}

        <section className="flex flex-col gap-4">
          {!identity && (
            <div className="flex flex-col gap-3 rounded-2xl border border-border-hairline bg-surface p-6">
              <p className="text-sm text-text-secondary">
                Necesitás una sesión para hacer tu Pick&apos;em.
              </p>
              <div className="flex flex-wrap gap-3">
                <Link
                  href="/jugador"
                  className="rounded-full bg-gold px-4 py-2 font-display text-sm font-bold tracking-wide text-bg uppercase transition-colors hover:bg-gold-soft"
                >
                  Soy jugador
                </Link>
                <Link
                  href="/pickem/login"
                  className="rounded-full border border-border-hairline px-4 py-2 font-display text-sm font-bold tracking-wide text-text-primary uppercase transition-colors hover:border-gold/40"
                >
                  Soy invitado
                </Link>
              </div>
            </div>
          )}

          {identity && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <p className="font-display text-lg font-bold text-text-primary">
                  Tu Pick&apos;em, {identity.displayName}
                </p>
                {identity.ownerType === "guest" && <PickemGuestLogoutButton />}
              </div>

              {!locked && (
                <PickemBoard
                  roster={roster}
                  initialOrder={savedOrder ?? roster.map((p) => p.id)}
                />
              )}

              {locked && savedOrder && (
                <PickemOrderedList
                  order={savedOrder}
                  participantsById={participantsById}
                  columns={2}
                  resultStatuses={
                    settings.resultsRevealed
                      ? computePickemResultStatus(savedOrder, participantsById, finalRankByName)
                      : null
                  }
                />
              )}

              {locked && !savedOrder && (
                <p className="text-sm text-text-secondary">
                  No guardaste tu Pick&apos;em antes de que arrancara el torneo.
                </p>
              )}
            </div>
          )}
        </section>

        <PickemCommunitySection
          entries={communityEntries}
          participantsById={participantsById}
          finalRankByName={finalRankByName}
          resultsRevealed={settings.resultsRevealed}
          ddragonVersion={ddragonVersion}
        />
      </main>
    </div>
  );
}

import { getAuthenticatedParticipantId } from "@/lib/player-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getChampionList, type Champion } from "@/lib/champions";
import { DAILY_RECEIVE_LIMIT, hoursAgoIso } from "@/lib/mango-launch";
import { QUEST_TARGETS } from "@/lib/quests";
import { Header } from "@/components/Header";
import { FixedLogo } from "@/components/FixedLogo";
import { PlayerLoginForm } from "./PlayerLoginForm";
import { InventoryPanel } from "./InventoryPanel";
import { MangoNotifications } from "./MangoNotifications";
import type { LaunchTarget } from "./LaunchModal";

export const dynamic = "force-dynamic";

/**
 * mangos/quest_progress/penalty_progress tienen RLS activado sin policies
 * públicas todavía (Fase 1) — /jugador no usa Supabase Auth, así que no hay
 * forma de atarlas a auth.uid(). El service role + el scoping explícito acá
 * abajo (siempre .eq a participantId, ya validado por la cookie firmada) ES
 * el límite de autorización, mismo patrón que /api/jugador/login.
 */
export default async function JugadorPage() {
  const participantId = await getAuthenticatedParticipantId();

  if (!participantId) {
    return (
      <PageShell subtitle="Ingresá tu código de acceso personal para continuar.">
        <section className="rounded-2xl border border-border-hairline bg-surface p-6">
          <PlayerLoginForm />
        </section>
      </PageShell>
    );
  }

  const supabase = createAdminClient();

  const [participantResult, mangosResult, questsResult, othersResult, pendingPenaltiesResult] =
    await Promise.all([
      supabase.from("participants").select("nombre_display").eq("id", participantId).maybeSingle(),
      supabase
        .from("mangos")
        .select("id")
        .eq("owner_participant_id", participantId)
        .eq("status", "in_inventory")
        .order("created_at", { ascending: true }),
      supabase
        .from("quest_progress")
        .select("quest_type, current_progress, target")
        .eq("participant_id", participantId),
      supabase.from("participants").select("id, nombre_display").neq("id", participantId),
      // "Pendiente" = no descalificado — la Fase 4 (detectar si cumplió el
      // castigo) todavía no existe, así que por ahora TODO lo no descalificado
      // cuenta como pendiente. No tiene relación con `seen` (esto es para el
      // banner, no para las notificaciones).
      supabase
        .from("penalty_progress")
        .select("id, mango_id")
        .eq("participant_id", participantId)
        .eq("disqualified", false)
        .order("created_at", { ascending: false }),
    ]);

  const nombreDisplay = participantResult.data?.nombre_display ?? null;

  if (!nombreDisplay) {
    // Cookie firmada pero el participante ya no existe — sesión huérfana.
    return (
      <PageShell subtitle="Ingresá tu código de acceso personal para continuar.">
        <section className="rounded-2xl border border-border-hairline bg-surface p-6">
          <PlayerLoginForm />
        </section>
      </PageShell>
    );
  }

  const mangos = mangosResult.data ?? [];

  const questByType = new Map(
    (questsResult.data ?? []).map((q) => [q.quest_type, q] as const),
  );
  const winStreak = {
    current: questByType.get("win_streak")?.current_progress ?? 0,
    target: questByType.get("win_streak")?.target ?? QUEST_TARGETS.win_streak,
  };
  const kdaStreak = {
    current: questByType.get("kda_streak")?.current_progress ?? 0,
    target: questByType.get("kda_streak")?.target ?? QUEST_TARGETS.kda_streak,
  };

  const others = othersResult.data ?? [];
  const { data: recentPenalties } = await supabase
    .from("penalty_progress")
    .select("participant_id")
    .gte("created_at", hoursAgoIso(24));

  const receivedCountByParticipant = new Map<string, number>();
  for (const row of recentPenalties ?? []) {
    receivedCountByParticipant.set(
      row.participant_id,
      (receivedCountByParticipant.get(row.participant_id) ?? 0) + 1,
    );
  }

  const otherParticipants: LaunchTarget[] = others.map((p) => ({
    id: p.id,
    nombre_display: p.nombre_display,
    receivedLast24h: receivedCountByParticipant.get(p.id) ?? 0,
    dailyLimit: DAILY_RECEIVE_LIMIT,
  }));

  let champions: Champion[] = [];
  try {
    champions = await getChampionList();
  } catch {
    // Se maneja en LaunchModal: sin campeones no se puede tirar la ruleta.
  }
  const championById = new Map(champions.map((c) => [c.id, c]));

  const pendingPenalties = pendingPenaltiesResult.data ?? [];
  let pendingChampionNames: string[] = [];
  if (pendingPenalties.length > 0) {
    const { data: pendingMangos } = await supabase
      .from("mangos")
      .select("id, champion_assigned")
      .in(
        "id",
        pendingPenalties.map((p) => p.mango_id),
      );
    const championIdByMangoId = new Map((pendingMangos ?? []).map((m) => [m.id, m.champion_assigned]));
    pendingChampionNames = pendingPenalties.map((p) => {
      const championId = championIdByMangoId.get(p.mango_id) ?? null;
      return championId ? (championById.get(championId)?.name ?? championId) : "un campeón";
    });
  }

  return (
    <PageShell subtitle="Sesión iniciada.">
      <MangoNotifications />

      {pendingChampionNames.length > 0 && (
        <section className="flex flex-col gap-2 rounded-2xl border border-loss/50 bg-surface p-6">
          <p className="font-display text-base font-bold text-loss">
            Tenés {pendingChampionNames.length}{" "}
            {pendingChampionNames.length === 1 ? "castigo pendiente" : "castigos pendientes"} por
            cumplir
          </p>
          <ul className="flex flex-wrap gap-2">
            {pendingChampionNames.map((name, i) => (
              <li
                key={`${name}-${i}`}
                className="rounded-full border border-loss/40 bg-bg-elevated px-3 py-1 text-sm font-medium text-text-primary"
              >
                {name}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-2 rounded-2xl border border-gold/40 bg-surface p-6 shadow-[0_0_50px_-20px_var(--gold)]">
        <p className="font-display text-2xl font-bold text-text-primary">Hola, {nombreDisplay}</p>
      </section>

      <InventoryPanel
        mangos={mangos}
        winStreak={winStreak}
        kdaStreak={kdaStreak}
        otherParticipants={otherParticipants}
        champions={champions}
      />
    </PageShell>
  );
}

function PageShell({
  subtitle,
  children,
}: {
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <FixedLogo />
      <Header />
      {/* Mismo patrón de pt-44/sm+ que el resto de páginas: le da lugar al logo fixed. */}
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-6 pt-6 pb-10 sm:pt-44">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight text-text-primary">
            Mi cuenta
          </h1>
          <p className="mt-1 text-sm text-text-secondary">{subtitle}</p>
        </div>
        {children}
      </main>
    </div>
  );
}

import { getAuthenticatedParticipantId } from "@/lib/player-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getChampionList, type Champion } from "@/lib/champions";
import { DAILY_RECEIVE_LIMIT, hoursAgoIso, resolveAssignedPunishment } from "@/lib/mango-launch";
import { QUEST_TARGETS } from "@/lib/quests";
import { PENALTY_GAME_LIMIT } from "@/lib/penalty";
import { Header } from "@/components/Header";
import { FixedLogo } from "@/components/FixedLogo";
import { PlayerLoginForm } from "./PlayerLoginForm";
import { InventoryPanel } from "./InventoryPanel";
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
      // Solo status='pending': todavía dentro de las 3 partidas para
      // cumplirlo (Fase 4). 'flagged_for_review'/'disqualified'/'pardoned'
      // ya salieron de la ventana de cumplimiento (avisados por toast en su
      // momento, no por este banner) y 'completed' ya no es un pendiente.
      // No tiene relación con `seen` (esto es para el banner, no para las
      // notificaciones).
      supabase
        .from("penalty_progress")
        .select("id, mango_id, games_without_compliance")
        .eq("participant_id", participantId)
        .eq("status", "pending")
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
  const deathlessWin = {
    current: questByType.get("deathless_win")?.current_progress ?? 0,
    target: questByType.get("deathless_win")?.target ?? QUEST_TARGETS.deathless_win,
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
  let pendingPunishments: {
    name: string;
    iconUrl: string | null;
    senderName: string;
    gamesWithoutCompliance: number;
  }[] = [];
  if (pendingPenalties.length > 0) {
    const { data: pendingMangos } = await supabase
      .from("mangos")
      .select("id, champion_assigned, sent_by_participant_id")
      .in(
        "id",
        pendingPenalties.map((p) => p.mango_id),
      );
    const mangoById = new Map((pendingMangos ?? []).map((m) => [m.id, m]));

    const senderIds = [
      ...new Set((pendingMangos ?? []).map((m) => m.sent_by_participant_id).filter((id) => id !== null)),
    ];
    const { data: senders } = senderIds.length
      ? await supabase.from("participants").select("id, nombre_display").in("id", senderIds)
      : { data: [] };
    const senderNameById = new Map((senders ?? []).map((s) => [s.id, s.nombre_display]));

    pendingPunishments = pendingPenalties.map((p) => {
      const mango = mangoById.get(p.mango_id);
      const resolved = resolveAssignedPunishment(mango?.champion_assigned ?? null, championById);
      const senderName =
        (mango?.sent_by_participant_id && senderNameById.get(mango.sent_by_participant_id)) ||
        "Alguien";
      return { ...resolved, senderName, gamesWithoutCompliance: p.games_without_compliance };
    });
  }

  return (
    <PageShell subtitle="Sesión iniciada.">
      {pendingPunishments.length > 0 && (
        <section className="flex flex-col gap-2 rounded-2xl border border-loss/50 bg-surface p-6">
          <p className="font-display text-base font-bold text-loss">
            Tenés {pendingPunishments.length}{" "}
            {pendingPunishments.length === 1 ? "castigo pendiente" : "castigos pendientes"} por
            cumplir
          </p>
          <ul className="flex flex-col gap-2">
            {pendingPunishments.map((punishment, i) => (
              <li
                key={`${punishment.name}-${i}`}
                className="flex items-center gap-3 rounded-xl border border-loss/40 bg-bg-elevated px-3 py-2 text-sm font-medium text-text-primary"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- CDN externo (Data Dragon / Community Dragon) */}
                <img
                  src={punishment.iconUrl ?? "/MangoAngry.png"}
                  alt=""
                  className="h-8 w-8 shrink-0 rounded-full object-cover"
                />
                <span className="flex flex-col">
                  <span>
                    <span className="text-text-secondary">{punishment.senderName} te envió:</span>{" "}
                    {punishment.name}
                  </span>
                  <span className="text-xs text-text-muted">
                    Llevas {punishment.gamesWithoutCompliance} de {PENALTY_GAME_LIMIT} partidas sin
                    cumplir este castigo
                  </span>
                </span>
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
        deathlessWin={deathlessWin}
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

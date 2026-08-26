import { getAuthenticatedParticipantId } from "@/lib/player-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getChampionList, type Champion } from "@/lib/champions";
import { getSummonerSpellList, type SummonerSpell } from "@/lib/summoner-spells";
import { DAILY_RECEIVE_LIMIT, hoursAgoIso, resolveAssignedPunishment } from "@/lib/mango-launch";
import { QUEST_TARGETS } from "@/lib/quests";
import { PENALTY_GAME_LIMIT } from "@/lib/penalty";
import { isOnline } from "@/lib/presence";
import { Header } from "@/components/Header";
import { PunishmentIcon } from "@/components/PunishmentIcon";
import { FixedLogo } from "@/components/FixedLogo";
import { PlayerLoginForm } from "./PlayerLoginForm";
import { InventoryPanel } from "./InventoryPanel";
import type { LaunchTarget } from "./LaunchModal";

export const dynamic = "force-dynamic";

/**
 * mangos/penalty_progress tienen policy pública de SOLO LECTURA desde la
 * Fase 5 (0009_public_read_mango_penalty.sql, para el leaderboard público);
 * quest_progress sigue sin ninguna. Ninguna de las tres tiene policy de
 * ESCRITURA pública — /jugador no usa Supabase Auth, así que no hay forma de
 * atarlas a auth.uid(). El service role + el scoping explícito acá abajo
 * (siempre .eq a participantId, ya validado por la cookie firmada) ES el
 * límite de autorización para lecturas/escrituras propias del jugador,
 * mismo patrón que /api/jugador/login.
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
      supabase
        .from("participants")
        .select("nombre_display, penalty_games_without_compliance")
        .eq("id", participantId)
        .maybeSingle(),
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
      supabase
        .from("participants")
        .select("id, nombre_display, last_seen_at")
        .neq("id", participantId),
      // Solo status='pending': todavía dentro de las 3 partidas para
      // cumplirlo (Fase 4). 'disqualified' ya salió de la ventana de
      // cumplimiento (avisado por toast en su momento, no por este banner)
      // y 'completed' ya no es un pendiente. Si un admin perdona al
      // jugador (ver /api/admin/penalties/resolve), el castigo vuelve a
      // 'pending' y reaparece acá solo, con ventana fresca — es la
      // devolución que pidió el usuario, no un caso especial. No tiene
      // relación con `seen` (esto es para el banner, no para las
      // notificaciones).
      supabase
        .from("penalty_progress")
        .select("id, mango_id")
        .eq("participant_id", participantId)
        .eq("status", "pending")
        .order("created_at", { ascending: false }),
    ]);

  const nombreDisplay = participantResult.data?.nombre_display ?? null;
  // Contador COMPARTIDO entre TODOS los castigos pendientes (rediseño de
  // Fase 4) — vive en participants, no en cada penalty_progress individual.
  const gamesWithoutCompliance = participantResult.data?.penalty_games_without_compliance ?? 0;

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
  const beatParticipant = {
    current: questByType.get("beat_participant")?.current_progress ?? 0,
    target: questByType.get("beat_participant")?.target ?? QUEST_TARGETS.beat_participant,
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
    online: isOnline(p.last_seen_at),
  }));

  let champions: Champion[] = [];
  let spells: SummonerSpell[] = [];
  try {
    [champions, spells] = await Promise.all([getChampionList(), getSummonerSpellList()]);
  } catch {
    // Se maneja en MangoRevealModal: sin campeones/hechizos no se puede tirar la ruleta.
  }
  const championById = new Map(champions.map((c) => [c.id, c]));
  const spellById = new Map(spells.map((s) => [s.id, s]));

  const pendingPenalties = pendingPenaltiesResult.data ?? [];

  let pendingPunishments: {
    name: string;
    iconUrl: string | null;
    noFlash?: boolean;
    senderName: string;
  }[] = [];
  if (pendingPenalties.length > 0) {
    const { data: pendingMangos } = await supabase
      .from("mangos")
      .select("id, status, champion_assigned, sent_by_participant_id")
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

    // Filtra los que todavía están 'pending_reveal': mostrar el castigo acá
    // sería un spoiler y saltearía por completo la ruleta de revelación —
    // este banner es solo para castigos YA revelados (status='sent') que
    // siguen pendientes de cumplir.
    pendingPunishments = pendingPenalties
      .filter((p) => mangoById.get(p.mango_id)?.status !== "pending_reveal")
      .map((p) => {
        const mango = mangoById.get(p.mango_id);
        const resolved = resolveAssignedPunishment(mango?.champion_assigned ?? null, championById, spellById);
        const senderName =
          (mango?.sent_by_participant_id && senderNameById.get(mango.sent_by_participant_id)) ||
          "Alguien";
        return { ...resolved, senderName };
      });
  }

  return (
    <PageShell subtitle="Sesión iniciada.">
      {pendingPunishments.length > 0 && (
        <section className="flex flex-col gap-3 rounded-2xl border border-loss/50 bg-surface p-6">
          <div>
            <p className="font-display text-base font-bold text-loss">
              Tenés {pendingPunishments.length}{" "}
              {pendingPunishments.length === 1 ? "castigo pendiente" : "castigos pendientes"} por
              cumplir
            </p>
            {/*
              Contador COMPARTIDO entre TODOS los castigos pendientes (no
              uno por castigo, rediseño de Fase 4) — cumplir CUALQUIERA de
              ellos reinicia esta ventana para los que queden.
            */}
            <p className="text-sm text-text-secondary">
              Llevas {gamesWithoutCompliance} de {PENALTY_GAME_LIMIT} partidas sin cumplir ninguno de
              tus castigos pendientes.
            </p>
          </div>
          <ul className="flex flex-col gap-2">
            {pendingPunishments.map((punishment, i) => (
              <li
                key={`${punishment.name}-${i}`}
                className="flex items-center gap-3 rounded-xl border border-loss/40 bg-bg-elevated px-3 py-2 text-sm font-medium text-text-primary"
              >
                <PunishmentIcon
                  iconUrl={punishment.iconUrl ?? "/MangoAngry.png"}
                  noFlash={punishment.noFlash}
                  size={32}
                  imgClassName="h-8 w-8 shrink-0 rounded-full object-cover"
                />
                <span>
                  <span className="text-text-secondary">{punishment.senderName} te envió:</span>{" "}
                  {punishment.name}
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
        beatParticipant={beatParticipant}
        otherParticipants={otherParticipants}
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

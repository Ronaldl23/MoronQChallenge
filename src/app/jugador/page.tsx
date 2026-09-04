import { getAuthenticatedParticipantId } from "@/lib/player-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getChampionList, type Champion } from "@/lib/champions";
import { getSummonerSpellList, type SummonerSpell } from "@/lib/summoner-spells";
import {
  MAX_ACTIVE_PENALTIES,
  mangoExpiresAt,
  discardUnlocksAt,
  resolveAssignedPunishment,
} from "@/lib/mango-launch";
import { questTargetsForTier, tierForRank } from "@/lib/quests";
import { PENALTY_GAME_LIMIT } from "@/lib/penalty";
import { isOnline } from "@/lib/presence";
import { fetchRankOrder } from "@/lib/ranking";
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

  const [
    participantResult,
    mangosResult,
    questsResult,
    othersResult,
    pendingPenaltiesResult,
    disqualifiedPenaltyCountResult,
  ] = await Promise.all([
    supabase
      .from("participants")
      .select(
        "nombre_display, penalty_games_without_compliance, manually_disqualified, disqualification_reason",
      )
      .eq("id", participantId)
      .maybeSingle(),
    supabase
      .from("mangos")
      .select("id, inventory_since")
      .eq("owner_participant_id", participantId)
      .eq("status", "in_inventory")
      .order("created_at", { ascending: true }),
    supabase
      .from("quest_progress")
      .select("quest_type, current_progress, target")
      .eq("participant_id", participantId),
    supabase
      .from("participants")
      .select("id, nombre_display, last_seen_at, mango_protection_until")
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
    // Descalificado por no cumplir un castigo a tiempo (automático, ver
    // src/lib/penalty.ts) — junto con manually_disqualified de arriba,
    // decide si se le bloquea el inventario más abajo (mismo criterio que
    // isDisqualified en src/lib/leaderboard.ts).
    supabase
      .from("penalty_progress")
      .select("id", { count: "exact", head: true })
      .eq("participant_id", participantId)
      .eq("status", "disqualified"),
  ]);

  const nombreDisplay = participantResult.data?.nombre_display ?? null;
  // Contador COMPARTIDO entre TODOS los castigos pendientes (rediseño de
  // Fase 4) — vive en participants, no en cada penalty_progress individual.
  const gamesWithoutCompliance = participantResult.data?.penalty_games_without_compliance ?? 0;
  // Mismo criterio que isDisqualified en src/lib/leaderboard.ts — mientras
  // sea true, más abajo se reemplaza el inventario por un aviso (bloquear
  // el lanzamiento en sí ES /api/jugador/mangos/launch, ver
  // isParticipantDisqualified — esto es solo la UI, no el límite real).
  const isDisqualified =
    (participantResult.data?.manually_disqualified ?? false) ||
    (disqualifiedPenaltyCountResult.count ?? 0) > 0;
  const disqualificationReason = participantResult.data?.disqualification_reason ?? null;

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

  // expiresAt (inventory_since + MANGO_EXPIRY_HOURS): InventoryPanel arma
  // la cuenta regresiva del lado del cliente y decide solo cuándo mostrarlo
  // "podrido" (ícono MangoPodrido/MangoPodridoFurioso) — acá solo se manda
  // el timestamp, no un booleano ya calculado, para que la cuenta baje en
  // vivo sin tener que recargar la página.
  const mangos = (mangosResult.data ?? []).map((m) => ({
    id: m.id,
    expiresAt: mangoExpiresAt(m.inventory_since),
    discardUnlocksAt: discardUnlocksAt(m.inventory_since),
  }));

  const questByType = new Map(
    (questsResult.data ?? []).map((q) => [q.quest_type, q] as const),
  );
  // Fallback SOLO para el caso raro de una fila de quest_progress que
  // todavía no existe (el cron de /api/update-rankings, que crea las 5
  // filas y les mantiene el target al día con la categoría actual —ver
  // MissionTier en quests.ts—, todavía no corrió ni una vez para este
  // participante) — la categoría más floja (top21_plus) como default
  // razonable mientras tanto.
  const defaultTargets = questTargetsForTier("top21_plus");
  const winStreak = {
    current: questByType.get("win_streak")?.current_progress ?? 0,
    target: questByType.get("win_streak")?.target ?? defaultTargets.win_streak,
  };
  const kdaStreak = {
    current: questByType.get("kda_streak")?.current_progress ?? 0,
    target: questByType.get("kda_streak")?.target ?? defaultTargets.kda_streak,
  };
  const deathlessWin = {
    current: questByType.get("deathless_win")?.current_progress ?? 0,
    target: questByType.get("deathless_win")?.target ?? defaultTargets.deathless_win,
  };
  const highKills = {
    current: questByType.get("high_kills")?.current_progress ?? 0,
    target: questByType.get("high_kills")?.target ?? defaultTargets.high_kills,
  };
  const beatParticipant = {
    current: questByType.get("beat_participant")?.current_progress ?? 0,
    target: questByType.get("beat_participant")?.target ?? defaultTargets.beat_participant,
  };

  const others = othersResult.data ?? [];
  // Cupo de castigos ACTIVOS simultáneos por jugador (penalty_progress en
  // 'pending') — reemplaza al viejo "recibidos en las últimas 24hs". Ya no
  // importa cuándo los recibió, importa cuántos tiene sin resolver ahora
  // mismo (ver MAX_ACTIVE_PENALTIES).
  const { data: activePenalties } = await supabase
    .from("penalty_progress")
    .select("participant_id")
    .eq("status", "pending");

  // Quién ya tiene rango asignado — un participante todavía en placements
  // (sin ninguna partida ranked jugada esta temporada) no puede recibir
  // mangos todavía, regla confirmada por el usuario tras el reinicio del
  // torneo: sin rango no hay forma de ubicarlo en el ranking ni de
  // aplicarle el bono anti-bullying (ver computeBullyingBonusPercent en
  // mango-launch.ts). Reusa fetchRankOrder (mismo criterio que ya usa
  // /api/jugador/mangos/launch para el bono anti-bullying, y ya pagina bien
  // más allá del límite de 1000 filas de Supabase, ver el comentario ahí).
  const rankOrder = await fetchRankOrder(supabase);
  // Categoría de misiones ACTUAL de este jugador (ver MissionTier en
  // quests.ts) — se le pasa al InventoryPanel solo para armar las
  // etiquetas de cada misión (umbral de KDA, kills, muertes de su
  // categoría); los números current/target en sí ya vienen resueltos
  // arriba desde quest_progress, que el cron mantiene al día con esta
  // misma categoría en cada corrida.
  const tier = tierForRank(rankOrder.get(participantId) ?? null);

  const activePenaltyCountByParticipant = new Map<string, number>();
  for (const row of activePenalties ?? []) {
    activePenaltyCountByParticipant.set(
      row.participant_id,
      (activePenaltyCountByParticipant.get(row.participant_id) ?? 0) + 1,
    );
  }

  // Estadísticas de mangos (apartado nuevo dentro del inventario) — cuentan
  // TODA la vida del torneo, no una ventana de tiempo: cuántos mangos
  // lanzó/recibió cada participante y cuántos de los que lanzó rebotaron,
  // más el top 5 de lanzadores y de receptores. is_bounce_back=false en
  // "mangos" filtra los mangos ORIGINALES lanzados a propósito por alguien
  // (excluye el mango nuevo que nace del rebote en sí, que "envía" el
  // objetivo devolviendo la jugada — no fue una decisión suya, ver
  // /api/jugador/mangos/launch). penalty_progress no distingue normal vs.
  // rebote: "recibido" cuenta las dos cosas por igual, es lo que a uno le
  // tocó cumplir, venga de donde venga.
  const [{ data: allMangosSent }, { data: allPenalties }, { data: allParticipants }] =
    await Promise.all([
      supabase
        .from("mangos")
        .select("sent_by_participant_id, status")
        .not("sent_by_participant_id", "is", null)
        .eq("is_bounce_back", false),
      supabase.from("penalty_progress").select("participant_id"),
      supabase.from("participants").select("id, nombre_display"),
    ]);

  const nameById = new Map((allParticipants ?? []).map((p) => [p.id, p.nombre_display]));

  const launchedByParticipant = new Map<string, number>();
  const bouncedByParticipant = new Map<string, number>();
  for (const row of allMangosSent ?? []) {
    const senderId = row.sent_by_participant_id!;
    launchedByParticipant.set(senderId, (launchedByParticipant.get(senderId) ?? 0) + 1);
    if (row.status === "returned") {
      bouncedByParticipant.set(senderId, (bouncedByParticipant.get(senderId) ?? 0) + 1);
    }
  }

  const receivedByParticipant = new Map<string, number>();
  for (const row of allPenalties ?? []) {
    receivedByParticipant.set(
      row.participant_id,
      (receivedByParticipant.get(row.participant_id) ?? 0) + 1,
    );
  }

  const TOP_N = 5;
  function topN(counts: Map<string, number>): { name: string; count: number }[] {
    return [...counts.entries()]
      .map(([id, count]) => ({ name: nameById.get(id) ?? "?", count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, TOP_N);
  }

  const mangoStats = {
    launched: launchedByParticipant.get(participantId) ?? 0,
    received: receivedByParticipant.get(participantId) ?? 0,
    bounced: bouncedByParticipant.get(participantId) ?? 0,
    topLaunchers: topN(launchedByParticipant),
    topReceivers: topN(receivedByParticipant),
  };

  const otherParticipants: LaunchTarget[] = others.map((p) => ({
    id: p.id,
    nombre_display: p.nombre_display,
    hasRank: rankOrder.has(p.id),
    activePenaltyCount: activePenaltyCountByParticipant.get(p.id) ?? 0,
    maxActivePenalties: MAX_ACTIVE_PENALTIES,
    protectedUntil: p.mango_protection_until,
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
  // Vacío legal cerrado (ver el chequeo real en /api/jugador/mangos/launch,
  // esto es solo la UI): un jugador puede seguir lanzando estando en el
  // tope de MAX_ACTIVE_PENALTIES (para que un rebote propio pueda sumarle
  // un 4to, la única excepción aceptada), pero no una vez que YA tiene más
  // — ahí se le deshabilita el inventario hasta que baje de nuevo a 3 o
  // menos.
  const launchBlocked = pendingPenalties.length > MAX_ACTIVE_PENALTIES;

  let pendingPunishments: {
    name: string;
    iconUrl: string | null;
    noFlash?: boolean;
    senderName: string;
    /** true si este castigo es el rebote (10%) de un lanzamiento propio — senderName acá es el objetivo original, no alguien que te lo mandó. */
    isBounceBack: boolean;
    /** true si este castigo salió de tirar a la basura un mango podrido que te tocó hongo (ver /api/jugador/mangos/discard) — autoinfligido, senderName no aplica (sent_by_participant_id queda en uno mismo, solo para las estadísticas). */
    isMoldyTrash: boolean;
  }[] = [];
  if (pendingPenalties.length > 0) {
    const { data: pendingMangos } = await supabase
      .from("mangos")
      .select("id, status, champion_assigned, sent_by_participant_id, is_bounce_back, is_moldy_trash")
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
        return {
          ...resolved,
          senderName,
          isBounceBack: mango?.is_bounce_back ?? false,
          isMoldyTrash: mango?.is_moldy_trash ?? false,
        };
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
                  {punishment.isMoldyTrash ? (
                    <span className="text-text-secondary">Tu mango tirado a la basura tenía hongos:</span>
                  ) : punishment.isBounceBack ? (
                    <span className="text-text-secondary">
                      Se regresó tu mango enviado a {punishment.senderName}:
                    </span>
                  ) : (
                    <span className="text-text-secondary">{punishment.senderName} te envió:</span>
                  )}{" "}
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

      {isDisqualified ? (
        <section className="flex flex-col gap-2 rounded-2xl border border-loss/50 bg-surface p-6">
          <p className="font-display text-base font-bold text-loss">Estás descalificado</p>
          <p className="text-sm text-text-secondary">
            No podés lanzar mangos ni acceder a tu inventario hasta que un admin te perdone.
            {disqualificationReason && (
              <>
                {" "}
                Motivo: <span className="text-text-primary">{disqualificationReason}</span>.
              </>
            )}
          </p>
        </section>
      ) : (
        <InventoryPanel
          mangos={mangos}
          tier={tier}
          winStreak={winStreak}
          kdaStreak={kdaStreak}
          deathlessWin={deathlessWin}
          highKills={highKills}
          beatParticipant={beatParticipant}
          otherParticipants={otherParticipants}
          launchBlocked={launchBlocked}
          mangoStats={mangoStats}
        />
      )}
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

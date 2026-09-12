import { unstable_cache } from "next/cache";
import { getAuthenticatedParticipantId } from "@/lib/player-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getChampionList, type Champion } from "@/lib/champions";
import { getSummonerSpellList, type SummonerSpell } from "@/lib/summoner-spells";
import { MAX_ACTIVE_PENALTIES, mangoExpiresAt, discardUnlocksAt } from "@/lib/mango-launch";
import { questTargetsForTier, tierForRank } from "@/lib/quests";
import { PENALTY_GAME_LIMIT, SHIELD_STREAK_TARGET } from "@/lib/penalty";
import { fetchPendingPunishments } from "@/lib/pending-penalties";
import { isOnline } from "@/lib/presence";
import { fetchRankOrder } from "@/lib/ranking";
import { Header } from "@/components/Header";
import { PunishmentIcon } from "@/components/PunishmentIcon";
import { FixedLogo } from "@/components/FixedLogo";
import { AutoRefresh } from "@/components/AutoRefresh";
import { PlayerLoginForm } from "./PlayerLoginForm";
import { InventoryPanel } from "./InventoryPanel";
import type { LaunchTarget } from "./LaunchModal";

export const dynamic = "force-dynamic";

/**
 * fetchRankOrder hace 3 idas y vueltas SECUENCIALES a Supabase por dentro
 * (roster completo → snapshots paginados de los últimos 7 días → filas
 * descalificadas) — es, de lejos, la consulta más pesada de esta página, y
 * con todo lo demás ya corriendo en un solo Promise.all (ver más abajo),
 * termina siendo la que marca cuánto tarda la página entera en cargar. Acá
 * solo se usa para MOSTRAR (rango propio, tier de misiones, "hasRank" de
 * cada rival en el modal de lanzar) — no para decidir si SE PUEDE lanzar un
 * mango, eso lo sigue calculando /api/jugador/mangos/launch llamando a
 * fetchRankOrder directo, sin cache, con el elo real del instante del
 * click. Por eso se cachea acá nomás (no en src/lib/ranking.ts, que
 * también usa el cron de /api/update-rankings y las rutas de
 * lanzar/descartar mango — esos SÍ necesitan el dato fresco de cada vez).
 * Misma ventana que getLeaderboard (src/lib/leaderboard.ts): ambos dependen
 * de los mismos snapshots, que solo cambian cuando corre el cron.
 */
const RANK_ORDER_CACHE_SECONDS = 30;
const getCachedRankOrderEntries = unstable_cache(
  async () => {
    const supabase = createAdminClient();
    const rankOrder = await fetchRankOrder(supabase);
    return [...rankOrder.entries()];
  },
  ["jugador-rank-order"],
  { revalidate: RANK_ORDER_CACHE_SECONDS },
);

/**
 * Las estadísticas de mangos de ESTA sección ("Lanzados/Recibidos/Rebotados"
 * + top 5) cuentan TODA la vida del torneo (ver el comentario más abajo,
 * donde se arman) — a diferencia de las demás consultas de esta página, que
 * filtran por participantId, estas tres barren mangos/penalty_progress
 * ENTERAS sin ningún filtro. Con el roster fijo eso hoy es rápido, pero va a
 * ir pesando más a medida que se acumulen más mangos/castigos durante el
 * torneo — mismo criterio que rankOrder arriba: es solo para MOSTRAR, así
 * que se cachea unos segundos en vez de barrer las tablas en cada carga de
 * esta página.
 */
const MANGO_STATS_CACHE_SECONDS = 30;
const getCachedMangoStatsRows = unstable_cache(
  async () => {
    const supabase = createAdminClient();
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
    return {
      allMangosSent: allMangosSent ?? [],
      allPenalties: allPenalties ?? [],
      allParticipants: allParticipants ?? [],
    };
  },
  ["jugador-mango-stats"],
  { revalidate: MANGO_STATS_CACHE_SECONDS },
);

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

  // TODO lo que este render necesita de Supabase (más el listado de
  // campeones/hechizos, cacheado vía fetch) es independiente entre sí —
  // ninguna consulta de acá abajo depende del RESULTADO de otra de este
  // mismo lote, solo de `participantId` (ya conocido) — así que se piden
  // todas en un único Promise.all en vez de en varias tandas secuenciales,
  // para no sumar ida y vuelta a Supabase de más por cada tanda. rankOrder
  // (antes se esperaba solo, "antes que nada más") tampoco necesitaba
  // bloquear al resto: se espera primero porque `inPlacements` hace falta
  // para el mapeo de `mangos` más abajo, pero eso es un cálculo en JS sobre
  // datos YA recibidos, no algo que las demás consultas necesiten para
  // poder pedirse. Antes también vivían en dos tandas más aparte (pedidas
  // recién después de que esta primera terminara): el cupo de castigos
  // pendientes roster-wide (pendingByTargetResult) y las estadísticas de
  // mangos de toda la vida del torneo (mangoStatsRows) — ninguna de las dos
  // depende de nada de acá tampoco, así que se unieron al mismo lote.
  const [
    rankOrderEntries,
    participantResult,
    mangosResult,
    questsResult,
    othersResult,
    pendingPenaltiesResult,
    disqualifiedPenaltyCountResult,
    pendingByTargetResult,
    mangoStatsRows,
    championsSpellsResult,
  ] = await Promise.all([
    // Quién ya tiene rango asignado — un participante todavía en placements
    // (sin ninguna partida ranked jugada esta temporada) no puede recibir NI
    // lanzar mangos todavía (regla confirmada por el usuario), y sus mangos
    // en inventario tampoco se pudren mientras tanto (ver el uso de
    // inPlacements más abajo, al armar `mangos`). Reusa fetchRankOrder
    // (mismo criterio que ya usa /api/jugador/mangos/launch para el bono
    // anti-bullying, y ya pagina bien más allá del límite de 1000 filas de
    // Supabase, ver el comentario ahí) — cacheado unos segundos acá nomás,
    // ver el comentario de getCachedRankOrderEntries arriba.
    getCachedRankOrderEntries(),
    supabase
      .from("participants")
      .select(
        "nombre_display, penalty_games_without_compliance, manually_disqualified, disqualification_reason, shield_count, shield_streak_count",
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
      .select("id, nombre_display, last_seen_at, mango_protection_until, penalty_received_count")
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
    // Cupo de castigos PENDIENTES simultáneos por jugador — red de seguridad
    // aparte de penalty_received_count (ver el mismo chequeo doble en
    // /api/jugador/mangos/launch): ganar la protección de 8h resetea el
    // acumulado de recibidos a 0, pero eso no debería dejar que le manden 3
    // MÁS encima de otros que ya tenía sin resolver de antes. Se muestra acá
    // para que LaunchModal refleje el mismo bloqueo real del servidor.
    supabase.from("penalty_progress").select("participant_id").eq("status", "pending"),
    // Estadísticas de mangos (apartado nuevo dentro del inventario) — cuentan
    // TODA la vida del torneo, no una ventana de tiempo: cuántos mangos
    // lanzó/recibió cada participante y cuántos de los que lanzó rebotaron,
    // más el top 5 de lanzadores y de receptores. is_bounce_back=false en
    // "mangos" filtra los mangos ORIGINALES lanzados a propósito por alguien
    // (excluye el mango nuevo que nace del rebote en sí, que "envía" el
    // objetivo devolviendo la jugada — no fue una decisión suya, ver
    // /api/jugador/mangos/launch). penalty_progress no distingue normal vs.
    // rebote: "recibido" cuenta las dos cosas por igual, es lo que a uno le
    // tocó cumplir, venga de donde venga. Cacheado unos segundos, ver el
    // comentario de getCachedMangoStatsRows arriba.
    getCachedMangoStatsRows(),
    // getChampionList()/getSummonerSpellList() están cacheados 1h en el Data
    // Cache de Next (ver src/lib/champions.ts) — el .catch acá preserva el
    // mismo fallback de antes (pool vacío, sin bloquear el resto de la
    // página) si Data Dragon no responde.
    Promise.all([getChampionList(), getSummonerSpellList()]).catch(() => null),
  ]);

  const rankOrder = new Map(rankOrderEntries);
  const inPlacements = !rankOrder.has(participantId);

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
  // Escudos SIN USAR guardados ahora — Misión Escudo, ver
  // 0033_shield_mission.sql. Acumulable a propósito (pedido explícito del
  // usuario): no hay tope.
  const shieldCount = participantResult.data?.shield_count ?? 0;
  // Racha ACTUAL hacia el próximo Escudo — mismo shape que las demás
  // misiones (QuestProgressView), aunque no vive en quest_progress: se
  // calcula/persiste aparte en checkPenaltyCompliance (ver
  // src/lib/penalty.ts), solo cuenta partidas de castigo GANADAS seguidas.
  const shieldStreak = {
    current: participantResult.data?.shield_streak_count ?? 0,
    target: SHIELD_STREAK_TARGET,
  };

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
  //
  // Un participante en placements no puede lanzar mangos todavía (ver
  // inPlacements arriba), así que sería injusto que se le pudran mientras
  // tanto — se les manda un vencimiento en un futuro lejano (nunca se
  // muestran podridos ni discard-eligible) hasta que salga de placements;
  // ahí el cron en /api/update-rankings resetea inventory_since=now() al
  // detectar su primer snapshot, y ese "de verdad" vencimiento arranca
  // recién en ese momento.
  const NEVER_EXPIRES = new Date("9999-12-31T00:00:00Z").toISOString();
  const mangos = (mangosResult.data ?? []).map((m) => ({
    id: m.id,
    expiresAt: inPlacements ? NEVER_EXPIRES : mangoExpiresAt(m.inventory_since),
    discardUnlocksAt: inPlacements ? NEVER_EXPIRES : discardUnlocksAt(m.inventory_since),
  }));

  const questByType = new Map(
    (questsResult.data ?? []).map((q) => [q.quest_type, q] as const),
  );
  // Fallback SOLO para el caso raro de una fila de quest_progress que
  // todavía no existe (el cron de /api/update-rankings, que crea las 6
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
  const lossStreak = {
    current: questByType.get("loss_streak")?.current_progress ?? 0,
    target: questByType.get("loss_streak")?.target ?? defaultTargets.loss_streak,
  };

  const others = othersResult.data ?? [];

  const pendingByTarget = pendingByTargetResult.data;
  const pendingCountByParticipant = new Map<string, number>();
  for (const row of pendingByTarget ?? []) {
    pendingCountByParticipant.set(row.participant_id, (pendingCountByParticipant.get(row.participant_id) ?? 0) + 1);
  }

  // Categoría de misiones ACTUAL de este jugador (ver MissionTier en
  // quests.ts) — se le pasa al InventoryPanel solo para armar las
  // etiquetas de cada misión (umbral de KDA, kills, muertes de su
  // categoría); los números current/target en sí ya vienen resueltos
  // arriba desde quest_progress, que el cron mantiene al día con esta
  // misma categoría en cada corrida.
  const tier = tierForRank(rankOrder.get(participantId) ?? null);

  const { allMangosSent, allPenalties, allParticipants } = mangoStatsRows;

  const nameById = new Map(allParticipants.map((p) => [p.id, p.nombre_display]));

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
    receivedPenaltyCount: p.penalty_received_count,
    pendingPenaltyCount: pendingCountByParticipant.get(p.id) ?? 0,
    maxActivePenalties: MAX_ACTIVE_PENALTIES,
    protectedUntil: p.mango_protection_until,
    online: isOnline(p.last_seen_at),
  }));

  // Se maneja en MangoRevealModal: sin campeones/hechizos no se puede tirar la ruleta.
  let champions: Champion[] = [];
  let spells: SummonerSpell[] = [];
  if (championsSpellsResult) {
    [champions, spells] = championsSpellsResult;
  }
  const pendingPenalties = pendingPenaltiesResult.data ?? [];
  // Ver el chequeo real en /api/jugador/mangos/launch, esto es solo la UI:
  // apenas llega a MAX_ACTIVE_PENALTIES castigos pendientes se le
  // deshabilita el inventario hasta que baje cumpliendo alguno (a
  // propósito, para que tener el tope se sienta como un freno real —
  // antes se permitía lanzar justo EN el tope para que un rebote propio
  // pudiera sumar un 4to, esa excepción ya no existe).
  const launchBlocked = pendingPenalties.length >= MAX_ACTIVE_PENALTIES || inPlacements;

  // Filtra los que todavía están 'pending_reveal': mostrar el castigo acá
  // sería un spoiler y saltearía por completo la ruleta de revelación —
  // este banner es solo para castigos YA revelados (status='sent') que
  // siguen pendientes de cumplir. Mismo helper que usa GlobalPenaltyAlert
  // (ver src/lib/pending-penalties.ts) para no duplicar esta consulta+mapeo.
  const pendingPunishments = await fetchPendingPunishments(supabase, pendingPenalties, champions, spells);

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
                  {punishment.isNoncompliancePenalty ? (
                    <span className="text-text-secondary">No cumpliste un castigo a tiempo:</span>
                  ) : punishment.isMoldyTrash ? (
                    <span className="text-text-secondary">Tu mango tirado a la basura tenía hongos:</span>
                  ) : punishment.isShieldReflection ? (
                    <span className="text-text-secondary">
                      El Escudo de {punishment.senderName} te devolvió tu propio mango:
                    </span>
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
          shieldCount={shieldCount}
          shieldStreak={shieldStreak}
          tier={tier}
          winStreak={winStreak}
          kdaStreak={kdaStreak}
          deathlessWin={deathlessWin}
          highKills={highKills}
          beatParticipant={beatParticipant}
          lossStreak={lossStreak}
          otherParticipants={otherParticipants}
          launchBlocked={launchBlocked}
          inPlacements={inPlacements}
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
      {/* Sin esto, esta página se quedaba con los datos del momento en que
          se cargó hasta que alguien la recargaba a mano — el contador de
          "partidas sin cumplir", el inventario, las misiones, todo server-
          rendered, no vuelve a pedirse solo con el tiempo. El home ya tenía
          este mismo componente (60s + al volver a la pestaña); acá hacía
          falta igual, reportado por varios jugadores que veían el contador
          "trabado" con la pestaña abierta un rato. */}
      <AutoRefresh />
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

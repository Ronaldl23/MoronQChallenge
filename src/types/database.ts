import type { MainRole } from "@/lib/lane";
export type { MainRole };

export type RankTier =
  | "IRON"
  | "BRONZE"
  | "SILVER"
  | "GOLD"
  | "PLATINUM"
  | "EMERALD"
  | "DIAMOND"
  | "MASTER"
  | "GRANDMASTER"
  | "CHALLENGER";

export type RankDivision = "I" | "II" | "III" | "IV";

export type Participant = {
  id: string;
  nombre_display: string;
  riot_game_name: string;
  riot_tag: string;
  puuid: string;
  region_platform: string;
  /**
   * Ícono de invocador actual (Data Dragon). Null hasta que corre el
   * primer /api/update-rankings para este participante — se actualiza en
   * cada corrida por si el jugador lo cambia.
   */
  profile_icon_id: number | null;
  /** Avatar manual opcional, pegado desde /admin. Si está presente, tiene prioridad sobre profile_icon_id. */
  avatar_url: string | null;
  /** Link a OP.GG, calculado una sola vez al crear el participante. */
  opgg_url: string | null;
  /** Si está en partida activa ahora mismo (spectator-v5), refrescado en cada /api/update-rankings. */
  in_game: boolean;
  /** Línea main fija, definida a mano en /admin al crear el participante. Distinta de la línea jugada partida a partida (esa sale de teamPosition en match-v5). */
  main_role: MainRole | null;
  /**
   * Código personal para loguearse en /jugador (sistema de Mangos). Null
   * para participantes creados antes de la Fase 1 hasta que se les asigne
   * uno (ver el backfill opcional en 0005_mango_system_phase1.sql).
   */
  login_code: string | null;
  /**
   * Contador COMPARTIDO de partidas ranked sin cumplir NINGUNO de los
   * castigos pendientes de este jugador (Fase 4, rediseñado: antes vivía
   * por-castigo en penalty_progress.games_without_compliance, ahora es un
   * solo contador para todo el grupo — ver src/lib/penalty.ts). Se resetea
   * a 0 apenas se cumple cualquier castigo pendiente, o cuando el jugador
   * se queda sin castigos pendientes (nada corriendo, ver regla 5).
   */
  penalty_games_without_compliance: number;
  /** Última vez que el poll de MangoNotifications corrió para este jugador — null hasta el primer poll de esa sesión. "Online" = dentro de los últimos ONLINE_WINDOW_MS (ver src/lib/presence.ts). */
  last_seen_at: string | null;
  /**
   * Contador de "probables Aegis of Valor" — victorias donde /api/update-rankings
   * estimó que a este jugador le tocó el bonus de doble LP por autofill (ver
   * src/lib/aegis.ts). A diferencia de penalty_games_without_compliance, ES
   * pública: se muestra en el leaderboard y el podio (ver 0016_aegis_counter.sql).
   */
  aegis_count: number;
  /**
   * Descalificación manual desde /admin (trampa, conducta, etc.) — ver
   * 0019_manual_disqualification.sql. Pública: alimenta el mismo
   * isDisqualified derivado del leaderboard. Desde 0029_noncompliance_ban_counter.sql
   * el propio cron TAMBIÉN puede prenderla sola, en silencio, al llegar a
   * NONCOMPLIANCE_BAN_THRESHOLD castigos por incumplimiento acumulados (ver
   * noncompliance_penalty_count más abajo y src/lib/penalty.ts) — mismo
   * flag, incluso desde afuera no se distingue de un ban manual.
   */
  manually_disqualified: boolean;
  /** Motivo que cargó el admin al descalificar manualmente, o el texto genérico que pone el cron al banear por incumplimiento acumulado — null si nunca se usó ninguna de las dos vías. Admin-only, no se expone en el leaderboard público (sí se le muestra al propio jugador descalificado en /jugador). */
  disqualification_reason: string | null;
  /**
   * Contador PRIVADO de castigos por incumplimiento acumulados EN EL DÍA
   * (ver noncompliance_penalty_last_date, y
   * nonComplianceGrants/NONCOMPLIANCE_BAN_THRESHOLD en src/lib/penalty.ts)
   * — se reinicia solo al cambiar de día, y a propósito NINGÚN endpoint de
   * cara al jugador lo lee ni lo expone: es la mitad "secreta" del baneo
   * automático de arriba. Solo lo toca /api/update-rankings.
   */
  noncompliance_penalty_count: number;
  /** Día (UTC, "YYYY-MM-DD") al que corresponde noncompliance_penalty_count — null hasta el primer castigo por incumplimiento. Si no es el día de hoy, el contador de arriba ya no cuenta (día distinto = arranca de 0). */
  noncompliance_penalty_last_date: string | null;
  /**
   * Hasta cuándo este jugador está protegido contra mangos nuevos — null
   * si no tiene protección activa. Se activa desde /api/update-rankings al
   * cumplir un castigo TENIENDO penalty_received_count en
   * MAX_ACTIVE_PENALTIES o más (ver PROTECTION_HOURS en
   * src/lib/mango-launch.ts), nunca por otra razón. Admin-only en la
   * práctica (solo lo lee /api/jugador/mangos/launch con el service role),
   * no se expone en el leaderboard público.
   */
  mango_protection_until: string | null;
  /**
   * Cuántos castigos recibió este jugador por lanzamiento EXTERNO de otro
   * participante (SOLO eso — a propósito NO cuenta rebote propio, hongo, ni
   * castigo por incumplimiento: esos tres son autoinfligidos/excepciones ya
   * aceptadas para superar MAX_ACTIVE_PENALTIES, contarlos acá bloquearía
   * lanzamientos ajenos por mala suerte propia en vez de por hostigamiento
   * real) desde la última vez que ganó protección — a diferencia de
   * "cuántos tiene pendientes ahora mismo", este NUNCA baja al cumplir uno,
   * solo se resetea a 0 al otorgarle protección (ver
   * 0030_penalty_received_count.sql). Cierra el hueco de mantener a
   * alguien siempre por debajo de MAX_ACTIVE_PENALTIES pendientes a la vez
   * para que nunca gane protección. Público dentro de /jugador (LaunchModal
   * lo muestra por cada objetivo posible, mismo criterio que antes con el
   * conteo de pendientes), no en el leaderboard.
   */
  penalty_received_count: number;
  /**
   * Cuándo el cron de /api/update-rankings empezó a procesar a este
   * participante por última vez (no cuándo terminó, ni si tuvo éxito) —
   * null si nunca se lo procesó. Cada corrida ordena por esta columna
   * ascendente (ver 0031_last_update_attempted_at.sql) para rotar de forma
   * justa quién se procesa primero cuando el roster no entra entero en una
   * sola corrida (maxDuration=60 de Vercel) — sin esto, algunos
   * participantes podían quedar rezagados corrida tras corrida mientras
   * otros se actualizaban cada pocos minutos. Operacional, no se expone en
   * ninguna UI.
   */
  last_update_attempted_at: string | null;
  /**
   * Última partida de match-v5 (Riot) ya evaluada contra los castigos
   * pendientes actuales de este jugador — igual que
   * quest_progress.last_processed_match_id, pero para el cumplimiento de
   * castigos. null significa "todavía no se evaluó nada para el grupo
   * actual" (arranca tomando toda la ventana reciente como nueva). Se
   * resetea a null cuando el grupo de castigos pendientes queda vacío —
   * ver checkPenaltyCompliance en /api/update-rankings/route.ts y
   * 0024_penalty_cursor_by_match_id.sql. Basado en match id (no en hora)
   * a propósito: evita la ambigüedad del borde inclusivo del `startTime`
   * de Riot, que podía recontar la misma partida real más de una vez
   * contra el contador compartido (penalty_games_without_compliance) en
   * corridas sucesivas.
   */
  penalty_last_processed_match_id: string | null;
  /**
   * Diagnóstico de la última corrida de checkPenaltyCompliance para este
   * jugador — texto plano, se pisa cada corrida (no es historial). Existe
   * para poder ver con una consulta SQL directa qué pasó (ok, sin castigos
   * pendientes, falla de Riot con su status, etc.) sin depender de revisar
   * logs de Vercel — ver 0025_penalty_check_debug.sql.
   */
  penalty_check_debug: string | null;
};

/**
 * 'pending_reveal': el servidor ya decidió el resultado (en el momento del
 * lanzamiento) pero todavía no se lo mostró a quien corresponde revelarlo
 * — pasa a 'sent' recién cuando esa persona completa el giro de la ruleta.
 */
export type MangoStatus =
  | "in_inventory"
  | "pending_reveal"
  | "sent"
  | "returned"
  | "discarded";

export type Mango = {
  id: string;
  owner_participant_id: string;
  status: MangoStatus;
  sent_by_participant_id: string | null;
  champion_assigned: string | null;
  created_at: string;
  /** true solo en la fila creada por un rebote (10%) — informativo, no cambia la lógica de juego. */
  is_bounce_back: boolean;
  /** true solo si se tiró a la basura (ver 'discarded' en MangoStatus) y le tocó hongo — el castigo autoinfligido queda 'pending_reveal' igual que cualquier otro, esto solo distingue el mensaje de chat/toast (ver 0022_moldy_mango_discard.sql). */
  is_moldy_trash: boolean;
  /** true solo en la fila creada por no cumplir un castigo a tiempo (ver nonComplianceGrants en src/lib/penalty.ts) — autoinfligida, sin balde de rebote, distingue el mensaje de chat/toast/ícono global de las demás (ver 0028_noncompliance_penalty.sql). */
  is_noncompliance_penalty: boolean;
  /**
   * Cuándo entró ESTE mango al inventario (se resetea a NOW en cada mango
   * nuevo otorgado por misión, nunca se toca en un lanzamiento/rebote —
   * ver 0020_mango_expiry_and_protection.sql). Pasadas MANGO_EXPIRY_HOURS
   * sin lanzarlo queda "podrido": sube su chance de rebote y cambia de
   * ícono en el inventario (ver isMangoExpired en src/lib/mango-launch.ts).
   */
  inventory_since: string;
  /** Si quien lanzó este mango ya vio el aviso de "X recibió tu mango con el castigo: Y" — mismo patrón que penalty_progress.seen. */
  launcher_notified: boolean;
};

export type QuestType =
  | "win_streak"
  | "kda_streak"
  | "deathless_win"
  | "high_kills"
  | "beat_participant"
  | "loss_streak";

export type QuestProgress = {
  id: string;
  participant_id: string;
  quest_type: QuestType;
  current_progress: number;
  target: number;
  last_processed_match_id: string | null;
  updated_at: string;
};

/**
 * 'flagged_for_review', 'disqualified' y 'pardoned' ya no los escribe nada
 * nuevo — quedan en el tipo (y en el CHECK de la tabla) solo por
 * compatibilidad con filas escritas antes de este cambio (ver
 * src/lib/penalty.ts): ya no hay descalificación automática por no cumplir
 * un castigo a tiempo — en su lugar se otorga uno más (ver
 * nonComplianceGrants) y el/los que ya estaban pendientes quedan
 * 'pending'. Un admin sigue pudiendo perdonar filas 'disqualified' viejas
 * desde /admin (las devuelve a 'pending').
 */
export type PenaltyStatus =
  | "pending"
  | "completed"
  | "flagged_for_review"
  | "disqualified"
  | "pardoned";

export type PenaltyProgress = {
  id: string;
  participant_id: string;
  mango_id: string;
  games_without_compliance: number;
  /** @deprecated Nunca se escribe en código nuevo — `status` es la fuente de verdad desde la Fase 4. Queda en la tabla por compatibilidad. */
  disqualified: boolean;
  created_at: string;
  /** Si el jugador ya vio el toast de "te llegó un Mango" para este castigo — no tiene relación con si lo cumplió. */
  seen: boolean;
  status: PenaltyStatus;
  /** true una vez que status pasó a 'completed' (se mantiene true, es terminal). */
  completed: boolean;
  /** Igual que `seen` pero para el aviso de "no cumpliste a tiempo, está en revisión" — evento separado, con su propio flag de "ya se lo mostré". */
  flagged_seen: boolean;
};

export type Snapshot = {
  id: string;
  participant_id: string;
  tier: RankTier;
  division: RankDivision | null;
  lp: number;
  wins: number;
  losses: number;
  elo_score: number;
  created_at: string;
};

/**
 * Roster público "Participantes" (nav) — nombre + foto, independiente de
 * `Participant` (que requiere Riot ID/puuid resuelto). Ver 0012_showcase_participants.sql.
 */
export type ShowcaseParticipant = {
  id: string;
  nombre: string;
  photo_url: string;
  created_at: string;
};

/**
 * 'user': mensaje escrito por un jugador (el default). 'mango_event' /
 * 'rank_event': fila generada por el servidor (mango revelado, ascenso o
 * descenso de tier/división) — ChatWidget la pinta con un ícono de evento
 * en vez de un avatar, sin el tratamiento de burbuja mía/ajena. Ver
 * 0015_chat_system_events.sql. 'mango_moldy_event' (0022_moldy_mango_discard.sql):
 * mismo tratamiento visual que 'mango_event' pero con el ícono
 * MangoPodridoFurioso — un mango tirado a la basura que resultó con hongos.
 * 'mango_noncompliance_event' (0028_noncompliance_penalty.sql): mismo
 * tratamiento pero con el ícono Peligro — no cumplió un castigo a tiempo y
 * recibió otro.
 */
export type ChatMessageType =
  | "user"
  | "mango_event"
  | "rank_event"
  | "mango_moldy_event"
  | "mango_noncompliance_event";

/** Solo aplica a type = 'rank_event' — qué flecha (verde/roja) mostrar. */
export type RankEventDirection = "up" | "down";

/**
 * Chat global en tiempo real (Fase A), un solo salón para todos los
 * jugadores registrados. sender_name/sender_avatar_url/sender_profile_icon_id
 * van denormalizados (snapshot del remitente al momento de enviar) para que
 * el evento de Realtime (solo la fila insertada, sin join) alcance para
 * pintar el mensaje completo. Ver 0013_chat_messages.sql.
 */
export type ChatMessage = {
  id: string;
  participant_id: string;
  sender_name: string;
  sender_avatar_url: string | null;
  sender_profile_icon_id: number | null;
  message: string;
  created_at: string;
  type: ChatMessageType;
  rank_direction: RankEventDirection | null;
};

/**
 * Invitado externo con acceso EXCLUSIVO a /pickem — sin relación con
 * `participants` (no es necesariamente un jugador) ni con el sistema de
 * Mangos. display_name lo tipea el admin a mano; access_code se genera
 * igual que participants.login_code. Ver 0017_pickem.sql.
 */
export type PickemGuest = {
  id: string;
  display_name: string;
  access_code: string;
  created_at: string;
};

/**
 * Un pick guardado — exactamente uno de participant_id/guest_id está
 * seteado (nunca ambos, nunca ninguno). predicted_order es el array
 * ORDENADO de showcase_participants.id, posición 1 primero.
 */
export type PickemPick = {
  id: string;
  participant_id: string | null;
  guest_id: string | null;
  predicted_order: string[];
  created_at: string;
  updated_at: string;
};

/** Fila única — switch manual de "resultados revelados" (nunca automático por fecha). */
export type PickemSettings = {
  id: true;
  results_revealed: boolean;
  revealed_at: string | null;
};

export type Database = {
  public: {
    Tables: {
      participants: {
        Row: Participant;
        Insert: Omit<
          Participant,
          | "id"
          | "profile_icon_id"
          | "avatar_url"
          | "in_game"
          | "main_role"
          | "login_code"
          | "penalty_games_without_compliance"
          | "last_seen_at"
          | "aegis_count"
          | "manually_disqualified"
          | "disqualification_reason"
          | "mango_protection_until"
          | "penalty_last_processed_match_id"
          | "penalty_check_debug"
          | "noncompliance_penalty_count"
          | "noncompliance_penalty_last_date"
          | "penalty_received_count"
          | "last_update_attempted_at"
        > & {
          id?: string;
          profile_icon_id?: number | null;
          avatar_url?: string | null;
          in_game?: boolean;
          main_role?: MainRole | null;
          login_code?: string | null;
          penalty_games_without_compliance?: number;
          last_seen_at?: string | null;
          aegis_count?: number;
          manually_disqualified?: boolean;
          disqualification_reason?: string | null;
          mango_protection_until?: string | null;
          penalty_last_processed_match_id?: string | null;
          penalty_check_debug?: string | null;
          noncompliance_penalty_count?: number;
          noncompliance_penalty_last_date?: string | null;
          penalty_received_count?: number;
          last_update_attempted_at?: string | null;
        };
        Update: Partial<Omit<Participant, "id">>;
        Relationships: [];
      };
      snapshots: {
        Row: Snapshot;
        Insert: Omit<Snapshot, "id" | "created_at" | "elo_score"> & {
          id?: string;
          created_at?: string;
          elo_score: number;
        };
        Update: Partial<Omit<Snapshot, "id">>;
        Relationships: [
          {
            foreignKeyName: "snapshots_participant_id_fkey";
            columns: ["participant_id"];
            isOneToOne: false;
            referencedRelation: "participants";
            referencedColumns: ["id"];
          },
        ];
      };
      mangos: {
        Row: Mango;
        Insert: Omit<
          Mango,
          | "id"
          | "created_at"
          | "status"
          | "sent_by_participant_id"
          | "champion_assigned"
          | "is_bounce_back"
          | "is_moldy_trash"
          | "is_noncompliance_penalty"
          | "launcher_notified"
          | "inventory_since"
        > & {
          id?: string;
          created_at?: string;
          status?: MangoStatus;
          sent_by_participant_id?: string | null;
          champion_assigned?: string | null;
          is_bounce_back?: boolean;
          is_moldy_trash?: boolean;
          is_noncompliance_penalty?: boolean;
          launcher_notified?: boolean;
          inventory_since?: string;
        };
        Update: Partial<Omit<Mango, "id">>;
        Relationships: [
          {
            foreignKeyName: "mangos_owner_participant_id_fkey";
            columns: ["owner_participant_id"];
            isOneToOne: false;
            referencedRelation: "participants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "mangos_sent_by_participant_id_fkey";
            columns: ["sent_by_participant_id"];
            isOneToOne: false;
            referencedRelation: "participants";
            referencedColumns: ["id"];
          },
        ];
      };
      quest_progress: {
        Row: QuestProgress;
        Insert: Omit<
          QuestProgress,
          "id" | "updated_at" | "current_progress" | "last_processed_match_id"
        > & {
          id?: string;
          updated_at?: string;
          current_progress?: number;
          last_processed_match_id?: string | null;
        };
        Update: Partial<Omit<QuestProgress, "id">>;
        Relationships: [
          {
            foreignKeyName: "quest_progress_participant_id_fkey";
            columns: ["participant_id"];
            isOneToOne: false;
            referencedRelation: "participants";
            referencedColumns: ["id"];
          },
        ];
      };
      penalty_progress: {
        Row: PenaltyProgress;
        Insert: Omit<
          PenaltyProgress,
          | "id"
          | "created_at"
          | "games_without_compliance"
          | "disqualified"
          | "seen"
          | "status"
          | "completed"
          | "flagged_seen"
        > & {
          id?: string;
          created_at?: string;
          games_without_compliance?: number;
          disqualified?: boolean;
          seen?: boolean;
          status?: PenaltyStatus;
          completed?: boolean;
          flagged_seen?: boolean;
        };
        Update: Partial<Omit<PenaltyProgress, "id">>;
        Relationships: [
          {
            foreignKeyName: "penalty_progress_participant_id_fkey";
            columns: ["participant_id"];
            isOneToOne: false;
            referencedRelation: "participants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "penalty_progress_mango_id_fkey";
            columns: ["mango_id"];
            isOneToOne: false;
            referencedRelation: "mangos";
            referencedColumns: ["id"];
          },
        ];
      };
      showcase_participants: {
        Row: ShowcaseParticipant;
        Insert: Omit<ShowcaseParticipant, "id" | "created_at"> & {
          id?: string;
          created_at?: string;
        };
        Update: Partial<Omit<ShowcaseParticipant, "id">>;
        Relationships: [];
      };
      chat_messages: {
        Row: ChatMessage;
        Insert: Omit<
          ChatMessage,
          "id" | "created_at" | "type" | "rank_direction"
        > & {
          id?: string;
          created_at?: string;
          type?: ChatMessageType;
          rank_direction?: RankEventDirection | null;
        };
        Update: Partial<Omit<ChatMessage, "id">>;
        Relationships: [
          {
            foreignKeyName: "chat_messages_participant_id_fkey";
            columns: ["participant_id"];
            isOneToOne: false;
            referencedRelation: "participants";
            referencedColumns: ["id"];
          },
        ];
      };
      pickem_guests: {
        Row: PickemGuest;
        Insert: Omit<PickemGuest, "id" | "created_at"> & {
          id?: string;
          created_at?: string;
        };
        Update: Partial<Omit<PickemGuest, "id">>;
        Relationships: [];
      };
      pickem_picks: {
        Row: PickemPick;
        Insert: Omit<
          PickemPick,
          "id" | "created_at" | "updated_at" | "participant_id" | "guest_id"
        > & {
          id?: string;
          created_at?: string;
          updated_at?: string;
          participant_id?: string | null;
          guest_id?: string | null;
        };
        Update: Partial<Omit<PickemPick, "id">>;
        Relationships: [
          {
            foreignKeyName: "pickem_picks_participant_id_fkey";
            columns: ["participant_id"];
            isOneToOne: true;
            referencedRelation: "participants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "pickem_picks_guest_id_fkey";
            columns: ["guest_id"];
            isOneToOne: true;
            referencedRelation: "pickem_guests";
            referencedColumns: ["id"];
          },
        ];
      };
      pickem_settings: {
        Row: PickemSettings;
        Insert: Partial<PickemSettings>;
        Update: Partial<PickemSettings>;
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
  };
};

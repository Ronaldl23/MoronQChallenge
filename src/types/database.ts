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
  | "returned";

export type Mango = {
  id: string;
  owner_participant_id: string;
  status: MangoStatus;
  sent_by_participant_id: string | null;
  champion_assigned: string | null;
  created_at: string;
  /** true solo en la fila creada por un rebote (10%) — informativo, no cambia la lógica de juego. */
  is_bounce_back: boolean;
  /** Si quien lanzó este mango ya vio el aviso de "X recibió tu mango con el castigo: Y" — mismo patrón que penalty_progress.seen. */
  launcher_notified: boolean;
};

export type QuestType = "win_streak" | "kda_streak" | "deathless_win";

export type QuestProgress = {
  id: string;
  participant_id: string;
  quest_type: QuestType;
  current_progress: number;
  target: number;
  last_processed_match_id: string | null;
  updated_at: string;
};

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
        > & {
          id?: string;
          profile_icon_id?: number | null;
          avatar_url?: string | null;
          in_game?: boolean;
          main_role?: MainRole | null;
          login_code?: string | null;
          penalty_games_without_compliance?: number;
          last_seen_at?: string | null;
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
          | "launcher_notified"
        > & {
          id?: string;
          created_at?: string;
          status?: MangoStatus;
          sent_by_participant_id?: string | null;
          champion_assigned?: string | null;
          is_bounce_back?: boolean;
          launcher_notified?: boolean;
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
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
  };
};

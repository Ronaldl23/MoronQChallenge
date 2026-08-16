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

export type Database = {
  public: {
    Tables: {
      participants: {
        Row: Participant;
        Insert: Omit<
          Participant,
          "id" | "profile_icon_id" | "avatar_url" | "in_game" | "main_role"
        > & {
          id?: string;
          profile_icon_id?: number | null;
          avatar_url?: string | null;
          in_game?: boolean;
          main_role?: MainRole | null;
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
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
  };
};

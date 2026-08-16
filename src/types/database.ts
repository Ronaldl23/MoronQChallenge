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

export interface Participant {
  id: string;
  nombre_display: string;
  riot_game_name: string;
  riot_tag: string;
  puuid: string;
  region_platform: string;
}

export interface Snapshot {
  id: string;
  participant_id: string;
  tier: RankTier;
  division: RankDivision | null;
  lp: number;
  wins: number;
  losses: number;
  elo_score: number;
  created_at: string;
}

export interface Database {
  public: {
    Tables: {
      participants: {
        Row: Participant;
        Insert: Omit<Participant, "id"> & { id?: string };
        Update: Partial<Omit<Participant, "id">>;
      };
      snapshots: {
        Row: Snapshot;
        Insert: Omit<Snapshot, "id" | "created_at" | "elo_score"> & {
          id?: string;
          created_at?: string;
          elo_score: number;
        };
        Update: Partial<Omit<Snapshot, "id">>;
      };
    };
  };
}

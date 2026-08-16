/**
 * Account-V1 is routed by continent cluster, not by platform — this maps
 * each platform id (as stored in participants.region_platform) to the
 * cluster its by-riot-id lookup must hit.
 */
const PLATFORM_TO_CONTINENT = {
  NA1: "americas",
  BR1: "americas",
  LA1: "americas",
  LA2: "americas",
  OC1: "americas",
  KR: "asia",
  JP1: "asia",
  EUN1: "europe",
  EUW1: "europe",
  TR1: "europe",
  RU: "europe",
  PH2: "sea",
  SG2: "sea",
  TH2: "sea",
  TW2: "sea",
  VN2: "sea",
} as const;

export const SUPPORTED_PLATFORMS = Object.keys(
  PLATFORM_TO_CONTINENT,
) as (keyof typeof PLATFORM_TO_CONTINENT)[];

/** Cluster regional (americas/asia/europe/sea) para endpoints routeados por continente, como Match-V5. */
export function platformToContinent(regionPlatform: string): string | null {
  return (
    PLATFORM_TO_CONTINENT[regionPlatform.toUpperCase() as keyof typeof PLATFORM_TO_CONTINENT] ??
    null
  );
}

export class RiotAccountNotFoundError extends Error {}

export class RiotApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export interface RiotAccount {
  puuid: string;
  gameName: string;
  tagLine: string;
}

export async function resolvePuuid({
  gameName,
  tagLine,
  regionPlatform,
  apiKey,
}: {
  gameName: string;
  tagLine: string;
  regionPlatform: string;
  apiKey: string;
}): Promise<RiotAccount> {
  const continent = platformToContinent(regionPlatform);

  if (!continent) {
    throw new RiotApiError(`region_platform desconocida: ${regionPlatform}`, 400);
  }

  const res = await fetch(
    `https://${continent}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`,
    { headers: { "X-Riot-Token": apiKey }, cache: "no-store" },
  );

  if (res.status === 404) {
    throw new RiotAccountNotFoundError(
      `No se encontró el Riot ID "${gameName}#${tagLine}"`,
    );
  }

  if (!res.ok) {
    throw new RiotApiError(
      `Riot API respondió ${res.status} al buscar "${gameName}#${tagLine}"`,
      res.status,
    );
  }

  return (await res.json()) as RiotAccount;
}

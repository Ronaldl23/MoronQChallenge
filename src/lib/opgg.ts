/**
 * op.gg usa sus propios códigos de región, distintos de los platform ids
 * de Riot (region_platform en participants). LA1/LA2 mapean a los nombres
 * que op.gg realmente usa: "lan" y "las".
 */
const PLATFORM_TO_OPGG_REGION: Record<string, string> = {
  NA1: "na",
  BR1: "br",
  LA1: "lan",
  LA2: "las",
  OC1: "oce",
  KR: "kr",
  JP1: "jp",
  EUN1: "eune",
  EUW1: "euw",
  TR1: "tr",
  RU: "ru",
  PH2: "ph",
  SG2: "sg",
  TH2: "th",
  TW2: "tw",
  VN2: "vn",
};

export function buildOpggUrl({
  riotGameName,
  riotTag,
  regionPlatform,
}: {
  riotGameName: string;
  riotTag: string;
  regionPlatform: string;
}): string | null {
  const region = PLATFORM_TO_OPGG_REGION[regionPlatform.toUpperCase()];
  if (!region) return null;

  return `https://op.gg/es/lol/summoners/${region}/${encodeURIComponent(riotGameName)}-${encodeURIComponent(riotTag)}`;
}

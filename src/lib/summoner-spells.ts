import { getDataDragonVersion } from "@/lib/ddragon";

export interface SummonerSpell {
  /** Id de Data Dragon (ej. "SummonerFlash") — lo que se guarda en mangos.champion_assigned para un castigo de hechizo. */
  id: string;
  /** Id numérico de Riot como string (ej. "4" = Flash) — así viene summoner1Id/summoner2Id en match-v5, para el chequeo de cumplimiento (ver src/lib/penalty.ts). */
  key: string;
  name: string;
  iconUrl: string;
}

interface RiotSummonerSpellData {
  data: Record<string, { id: string; key: string; name: string }>;
}

/**
 * Nombres en español pedidos por el usuario para el castigo "hechizo de
 * invocador obligatorio" — se pisan sobre el `name` que devuelve Data
 * Dragon (que puede no coincidir palabra por palabra) para que la ruleta y
 * el resto de la UI muestren EXACTAMENTE estos términos. Cualquier hechizo
 * fuera de este mapeo (no forma parte del pool de castigo) se queda con el
 * nombre tal cual lo da Data Dragon.
 */
const SPELL_NAME_ES: Record<string, string> = {
  SummonerHaste: "Fantasma",
  SummonerHeal: "Curar",
  SummonerBarrier: "Barrera",
  SummonerBoost: "Purificar",
  SummonerExhaust: "Debilitar",
  SummonerTeleport: "Teletransporte",
  SummonerDot: "Incendiar",
  SummonerSmite: "Hoz",
  SummonerFlash: "Flash",
};

/**
 * Listado completo de hechizos de invocador (para la ruleta de castigo),
 * mismo patrón que getChampionList: cacheado 1h vía el Data Cache de Next,
 * sin fallback local — si Data Dragon no responde, el caller debe mostrar
 * un error en vez de girar con una lista vacía o inventada.
 */
export async function getSummonerSpellList(): Promise<SummonerSpell[]> {
  const version = await getDataDragonVersion();

  const res = await fetch(
    `https://ddragon.leagueoflegends.com/cdn/${version}/data/es_MX/summoner.json`,
    { next: { revalidate: 3600 } },
  );

  if (!res.ok) {
    throw new Error(
      `Data Dragon respondió ${res.status} al pedir el listado de hechizos de invocador`,
    );
  }

  const body = (await res.json()) as RiotSummonerSpellData;

  return Object.values(body.data).map((spell) => ({
    id: spell.id,
    key: spell.key,
    name: SPELL_NAME_ES[spell.id] ?? spell.name,
    iconUrl: `https://ddragon.leagueoflegends.com/cdn/${version}/img/spell/${spell.id}.png`,
  }));
}

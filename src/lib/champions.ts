import { getDataDragonVersion } from "@/lib/ddragon";

export interface Champion {
  id: string;
  name: string;
  iconUrl: string;
}

interface RiotChampionData {
  data: Record<string, { id: string; name: string }>;
}

/**
 * Listado completo de campeones (para la ruleta de castigo), en español
 * latam igual que el resto de la UI. Mismo patrón que getDataDragonVersion:
 * cacheado 1h vía el Data Cache de Next, sin fallback local — si Data
 * Dragon no responde, la ruleta no tiene con qué armarse y el caller debe
 * mostrar un error en vez de girar con una lista vacía o inventada.
 */
export async function getChampionList(): Promise<Champion[]> {
  const version = await getDataDragonVersion();

  const res = await fetch(
    `https://ddragon.leagueoflegends.com/cdn/${version}/data/es_MX/champion.json`,
    { next: { revalidate: 3600 } },
  );

  if (!res.ok) {
    throw new Error(`Data Dragon respondió ${res.status} al pedir el listado de campeones`);
  }

  const body = (await res.json()) as RiotChampionData;

  return Object.values(body.data)
    .map((champion) => ({
      id: champion.id,
      name: champion.name,
      iconUrl: `https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${champion.id}.png`,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
}

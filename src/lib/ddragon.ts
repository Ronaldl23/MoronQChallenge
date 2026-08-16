/**
 * Fallback si el endpoint de versiones no responde (red caída, CDN abajo).
 * Solo importa que sea una versión válida de Data Dragon; no necesita ser
 * la más reciente, ya que es el último recurso.
 */
const FALLBACK_VERSION = "14.20.1";

/**
 * Versión actual de Data Dragon, para construir URLs de assets (íconos de
 * invocador, emblemas, etc). Next.js cachea este fetch en su Data Cache
 * (revalidate: 1h) en vez de pedirlo en cada render.
 */
export async function getDataDragonVersion(): Promise<string> {
  try {
    const res = await fetch("https://ddragon.leagueoflegends.com/api/versions.json", {
      next: { revalidate: 3600 },
    });
    if (!res.ok) return FALLBACK_VERSION;

    const versions = (await res.json()) as string[];
    return versions[0] ?? FALLBACK_VERSION;
  } catch {
    return FALLBACK_VERSION;
  }
}

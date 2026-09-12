/**
 * Reintento único para el hipo de red más común en runtime serverless:
 * "TypeError: fetch failed" (undici) cuando una función recién levantada
 * (o con una conexión keep-alive ya vieja) falla al conectar con la API de
 * Supabase — no es un error de la base de datos en sí (permisos, columna
 * inexistente, etc.), sino la conexión de red misma fallando una sola vez.
 * Confirmado en los logs reales de Vercel de moronqchallenge.com: decenas
 * de "Failed to load snapshots: TypeError: fetch failed" repartidos en
 * distintas rutas (/, /participantes, /tierlist, /pickem), sin relación con
 * ninguna consulta en particular — típico de esto, no de un bug de query.
 * Un segundo intento, unos milisegundos después, resuelve casi siempre.
 * `run` debe devolver una consulta NUEVA cada vez que se la llama (no la
 * misma promesa ya resuelta) para que el reintento realmente vuelva a pedir
 * los datos.
 */
export async function withFetchRetry<T>(
  run: () => PromiseLike<{ data: T; error: { message: string } | null }>,
): Promise<{ data: T; error: { message: string } | null }> {
  const first = await run();
  if (!first.error?.message?.includes("fetch failed")) return first;
  await new Promise((resolve) => setTimeout(resolve, 250));
  return run();
}

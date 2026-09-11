/**
 * Fallback de Suspense para TODA navegación entre páginas del sitio (vive en
 * la raíz de app/, así que cubre a cualquier route que sea hijo directo de
 * RootLayout — Home, /jugador, /participantes, /tierlist, /pickem, /admin,
 * /reglas — sin necesitar un loading.tsx por carpeta). Antes, sin ningún
 * Suspense boundary acá, un click en el nav se quedaba sin ninguna señal
 * visual hasta que el Server Component de destino terminara TODAS sus
 * consultas — con rutas force-dynamic (todas lo son) se sentía como que "no
 * pasó nada" al clickear. Este archivo, al ser puramente estático (sin
 * await, sin datos), además hace que Next pueda precargarlo de una junto
 * con el link, para que aparezca al instante en vez de recién después de la
 * primera respuesta del servidor.
 */
export default function Loading() {
  return (
    <div className="flex min-h-screen flex-1 items-center justify-center">
      <div
        role="status"
        aria-label="Cargando"
        className="h-10 w-10 animate-spin rounded-full border-2 border-border-hairline-strong border-t-gold"
      />
    </div>
  );
}

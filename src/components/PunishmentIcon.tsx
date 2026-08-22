/**
 * Ícono de un castigo ya resuelto (Support, hechizo, campeón puntual) —
 * cuando `noFlash` es true (castigo "jugar SIN Flash"), superpone una X en
 * CSS sobre el ícono de Flash en vez de usar una imagen nueva (pedido
 * explícito). Sin estado ni hooks — sirve tanto desde un Server Component
 * (ej. el banner de /jugador) como desde uno de cliente (toasts, ruleta).
 */
export function PunishmentIcon({
  iconUrl,
  noFlash = false,
  size,
  imgClassName,
  alt = "",
}: {
  iconUrl: string;
  noFlash?: boolean;
  size: number;
  imgClassName: string;
  alt?: string;
}) {
  return (
    <span className="relative inline-block shrink-0" style={{ width: size, height: size }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- CDN externo (Data Dragon / Community Dragon) o asset local */}
      <img src={iconUrl} alt={alt} width={size} height={size} className={imgClassName} />
      {noFlash && (
        <svg
          viewBox="0 0 20 20"
          className="pointer-events-none absolute inset-0 h-full w-full text-loss drop-shadow-[0_0_1.5px_black]"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.75"
          strokeLinecap="round"
          aria-hidden
        >
          <line x1="3" y1="3" x2="17" y2="17" />
          <line x1="17" y1="3" x2="3" y2="17" />
        </svg>
      )}
    </span>
  );
}

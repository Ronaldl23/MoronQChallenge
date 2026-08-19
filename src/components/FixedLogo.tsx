import { existsSync } from "node:fs";
import { join } from "node:path";
import Link from "next/link";
import { Logo } from "./Logo";

export function FixedLogo() {
  const hasLogo = existsSync(join(process.cwd(), "public", "logo.png"));

  return (
    <Link
      href="/"
      aria-label="MoronQChallenge — Inicio"
      /*
       * En mobile el logo va en flujo normal (NO fixed): a su alto de
       * sm+ (ver Logo.tsx) flotando fijo sobre el scroll, tapaba filas de
       * la tabla al bajar (nada lo empujaba, se quedaba plantado en
       * top:8px del viewport pase lo que pase). En sm+ sigue fixed, sin
       * tocar nada del diseño de desktop.
       */
      className="relative z-50 block w-fit sm:fixed sm:top-2 sm:left-[100px]"
    >
      <Logo hasLogo={hasLogo} />
    </Link>
  );
}

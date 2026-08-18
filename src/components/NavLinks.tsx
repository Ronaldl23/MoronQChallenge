"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Ranking" },
  { href: "/reglas", label: "Reglas" },
];

export function NavLinks({ isPlayerLoggedIn }: { isPlayerLoggedIn: boolean }) {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-6 font-display text-sm font-semibold tracking-wide uppercase">
      {LINKS.map((link) => {
        const active = pathname === link.href;
        return (
          <Link
            key={link.href}
            href={link.href}
            className={
              active
                ? "text-gold"
                : "text-text-secondary transition-colors hover:text-text-primary"
            }
          >
            {link.label}
          </Link>
        );
      })}
      {/* /jugador ya muestra el contenido correcto según la sesión (login o
          inventario) — acá solo cambia el texto para que el botón adelante
          qué te vas a encontrar al clickearlo. */}
      <Link
        href="/jugador"
        className={
          pathname === "/jugador"
            ? "text-gold"
            : "text-text-secondary transition-colors hover:text-text-primary"
        }
      >
        {isPlayerLoggedIn ? "Inventario" : "Login"}
      </Link>
    </nav>
  );
}

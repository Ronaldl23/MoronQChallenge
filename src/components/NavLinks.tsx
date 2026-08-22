"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const LINKS = [
  { href: "/", label: "Ranking" },
  { href: "/reglas", label: "Reglas" },
  { href: "/participantes", label: "Participantes" },
  { href: "/tierlist", label: "Tier List" },
  { href: "/pickem", label: "Pick'em" },
];

export function NavLinks({ isPlayerLoggedIn }: { isPlayerLoggedIn: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await fetch("/api/jugador/logout", { method: "POST" });
    } finally {
      // router.refresh() además de push: layout.tsx decide qué montar
      // (ChatWidget, MangoNotifications, el texto Inventario/Login) leyendo
      // la cookie del lado del servidor en cada request — sin el refresh,
      // el árbol de Server Components ya cacheado por el router seguiría
      // mostrando el estado logueado hasta la próxima navegación real.
      router.push("/");
      router.refresh();
    }
  }

  return (
    <nav className="flex flex-wrap items-center gap-x-6 gap-y-2 font-display text-sm font-semibold tracking-wide uppercase">
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
      {isPlayerLoggedIn && (
        <button
          type="button"
          onClick={handleLogout}
          disabled={loggingOut}
          className="text-xs font-medium text-text-muted normal-case transition-colors hover:text-loss disabled:opacity-50"
        >
          {loggingOut ? "Saliendo..." : "Cerrar sesión"}
        </button>
      )}
    </nav>
  );
}

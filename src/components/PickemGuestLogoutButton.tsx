"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function PickemGuestLogoutButton() {
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await fetch("/api/pickem/guest-logout", { method: "POST" });
    } finally {
      router.refresh();
    }
  }

  return (
    <button
      type="button"
      onClick={handleLogout}
      disabled={loggingOut}
      className="text-xs font-medium text-text-muted transition-colors hover:text-loss disabled:opacity-50"
    >
      {loggingOut ? "Saliendo..." : "Cerrar sesión de invitado"}
    </button>
  );
}

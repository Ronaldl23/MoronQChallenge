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
      className="fixed top-4 left-6 z-50 rounded-2xl bg-bg-elevated/90 p-2 shadow-lg shadow-black/40 backdrop-blur-sm md:left-[max(1.5rem,calc((100vw-72rem)/2+1.5rem))]"
    >
      <Logo hasLogo={hasLogo} />
    </Link>
  );
}

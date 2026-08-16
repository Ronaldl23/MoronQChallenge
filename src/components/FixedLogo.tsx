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
      className="fixed top-2 left-0 z-50"
    >
      <Logo hasLogo={hasLogo} />
    </Link>
  );
}

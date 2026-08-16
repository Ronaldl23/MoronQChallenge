import { existsSync } from "node:fs";
import { join } from "node:path";
import Link from "next/link";
import { Logo } from "./Logo";
import { NavLinks } from "./NavLinks";
import { Countdown } from "./Countdown";
import { TOURNAMENT_END_DATE } from "@/lib/config";

export function Header() {
  const hasLogo = existsSync(join(process.cwd(), "public", "logo.png"));

  return (
    <header className="border-b border-border-hairline bg-bg-elevated">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-4">
        <Link href="/" className="flex items-center gap-3">
          <Logo hasLogo={hasLogo} />
        </Link>

        <NavLinks />

        <Countdown endDate={TOURNAMENT_END_DATE} />
      </div>
    </header>
  );
}

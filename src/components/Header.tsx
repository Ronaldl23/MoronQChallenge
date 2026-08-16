import { NavLinks } from "./NavLinks";
import { Countdown } from "./Countdown";
import { TOURNAMENT_END_DATE } from "@/lib/config";

export function Header() {
  return (
    <header className="border-b border-border-hairline bg-bg-elevated">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-4">
        {/*
          El logo real vive en <FixedLogo>, con position: fixed, para que
          quede pegado en su lugar mientras el resto del header (esto,
          countdown + nav) se desplaza normalmente con la página. Este
          espaciador invisible ocupa el mismo lugar en el flujo normal para
          que el countdown no se mueva y la fila mantenga su altura.
        */}
        <div aria-hidden className="h-40 w-40 shrink-0" />

        <Countdown endDate={TOURNAMENT_END_DATE} />
      </div>

      <div className="border-t border-border-hairline">
        <div className="mx-auto w-full max-w-6xl px-6 py-3">
          <NavLinks />
        </div>
      </div>
    </header>
  );
}

import { NavLinks } from "./NavLinks";
import { Countdown } from "./Countdown";
import { TOURNAMENT_END_DATE } from "@/lib/config";

export function Header() {
  return (
    <header className="border-b border-border-hairline bg-bg-elevated">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-3">
        <div className="flex items-center gap-6">
          {/*
            El logo real vive en <FixedLogo>, con position: fixed, flotando
            por encima. Este espaciador invisible solo reserva ancho (no
            alto, para que la fila se mantenga compacta) así el texto de
            Ranking/Reglas no arranca tapado por el logo.
          */}
          <div aria-hidden className="w-16 shrink-0 sm:w-20" />
          <NavLinks />
        </div>

        <Countdown endDate={TOURNAMENT_END_DATE} />
      </div>
    </header>
  );
}

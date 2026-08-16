import { NavLinks } from "./NavLinks";
import { Countdown } from "./Countdown";
import { TOURNAMENT_END_DATE } from "@/lib/config";

export function Header() {
  return (
    <header className="border-b border-border-hairline bg-bg-elevated">
      {/*
        pl reserva el espacio horizontal que ocupa <FixedLogo> (fixed,
        flotando por encima) para que NI el nav NI el countdown arranquen
        tapados por el logo — en mobile el logo va de x:0-200px, en sm+ de
        x:100-300px.
      */}
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4 py-3 pr-6 pl-[212px] sm:pl-[336px]">
        <NavLinks />
        <Countdown endDate={TOURNAMENT_END_DATE} />
      </div>
    </header>
  );
}

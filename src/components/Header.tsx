import { NavLinks } from "./NavLinks";
import { Countdown } from "./Countdown";
import { TOURNAMENT_END_DATE } from "@/lib/config";

export function Header() {
  return (
    <header className="border-b border-border-hairline bg-bg-elevated">
      {/*
        En sm+ el pl reserva el espacio horizontal que ocupa <FixedLogo>
        (fixed ahí, flotando por encima) para que NI el nav NI el countdown
        arranquen tapados por el logo (x:100-300px). En mobile el logo ya
        no es fixed — va apilado arriba en flujo normal — así que no hace
        falta reservarle nada acá.
      */}
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4 py-3 pr-6 pl-6 sm:pl-[336px]">
        <NavLinks />
        <Countdown endDate={TOURNAMENT_END_DATE} />
      </div>
    </header>
  );
}

import { NavLinks } from "./NavLinks";
import { Countdown } from "./Countdown";
import { getAuthenticatedParticipantId } from "@/lib/player-auth";

export async function Header() {
  // Server-side porque la cookie de sesión es httpOnly (a propósito, para
  // que no se pueda leer ni falsificar desde JS del cliente) — un client
  // component no podría chequearla con document.cookie.
  const isPlayerLoggedIn = (await getAuthenticatedParticipantId()) !== null;

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
        <NavLinks isPlayerLoggedIn={isPlayerLoggedIn} />
        <Countdown />
      </div>
    </header>
  );
}

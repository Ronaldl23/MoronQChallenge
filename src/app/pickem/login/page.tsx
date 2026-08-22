import { redirect } from "next/navigation";
import { getPickemViewerIdentity } from "@/lib/pickem";
import { Header } from "@/components/Header";
import { FixedLogo } from "@/components/FixedLogo";
import { PickemGuestLoginForm } from "./PickemGuestLoginForm";

export const dynamic = "force-dynamic";

/**
 * Login exclusivo para invitados externos (código generado desde /admin,
 * ver PickemAdminPanel). Los jugadores NO pasan por acá — su sesión de
 * /jugador ya alcanza para /pickem.
 */
export default async function PickemLoginPage() {
  const identity = await getPickemViewerIdentity();
  if (identity) redirect("/pickem");

  return (
    <div className="flex min-h-screen flex-col">
      <FixedLogo />
      <Header />
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-6 pt-6 pb-10 sm:pt-44">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight text-text-primary">
            Login de invitado
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            Ingresá el código de acceso que te compartieron para hacer tu Pick&apos;em.
          </p>
        </div>
        <section className="rounded-2xl border border-border-hairline bg-surface p-6">
          <PickemGuestLoginForm />
        </section>
      </main>
    </div>
  );
}

import { isAdminAuthenticated } from "@/lib/admin-auth";
import { AdminLoginForm } from "./AdminLoginForm";
import { AddParticipantForm } from "./AddParticipantForm";
import { AddShowcaseParticipantForm } from "./AddShowcaseParticipantForm";
import { ReplaceParticipantAccountForm } from "./ReplaceParticipantAccountForm";
import { DisqualifyParticipantForm } from "./DisqualifyParticipantForm";
import { PenaltyReviewPanel } from "./PenaltyReviewPanel";
import { PickemAdminPanel } from "./PickemAdminPanel";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const authenticated = await isAdminAuthenticated();

  return (
    <div className="min-h-screen bg-zinc-50 px-6 py-16 font-sans dark:bg-black">
      <main
        className={`mx-auto flex w-full flex-col gap-8 ${authenticated ? "max-w-2xl" : "max-w-md"}`}
      >
        <header>
          <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
            Admin — MoronQChallenge
          </h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            {authenticated
              ? "Agrega un nuevo participante. El puuid se resuelve automáticamente desde la API de Riot."
              : "Ingresa la contraseña de administrador para continuar."}
          </p>
        </header>

        {authenticated ? <AddParticipantForm /> : <AdminLoginForm />}
        {authenticated && <AddShowcaseParticipantForm />}
        {authenticated && <ReplaceParticipantAccountForm />}
        {authenticated && <DisqualifyParticipantForm />}
        {authenticated && <PenaltyReviewPanel />}
        {authenticated && <PickemAdminPanel />}
      </main>
    </div>
  );
}

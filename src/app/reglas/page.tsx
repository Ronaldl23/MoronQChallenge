import { Header } from "@/components/Header";
import { FixedLogo } from "@/components/FixedLogo";

export default function ReglasPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <FixedLogo />
      <Header />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-10">
        <h1 className="font-display text-3xl font-bold tracking-tight text-text-primary">
          Reglas
        </h1>

        <section className="flex flex-col gap-3 rounded-2xl border border-border-hairline bg-surface p-6">
          <h2 className="font-display text-lg font-semibold text-gold">
            Formato
          </h2>
          <p className="text-sm leading-relaxed text-text-secondary">
            [Edita esta sección con el formato real del torneo: duración,
            colas válidas, servidores, etc.]
          </p>
        </section>

        <section className="flex flex-col gap-3 rounded-2xl border border-border-hairline bg-surface p-6">
          <h2 className="font-display text-lg font-semibold text-gold">
            Elegibilidad
          </h2>
          <p className="text-sm leading-relaxed text-text-secondary">
            [Edita esta sección con los requisitos para participar.]
          </p>
        </section>

        <section className="flex flex-col gap-3 rounded-2xl border border-border-hairline bg-surface p-6">
          <h2 className="font-display text-lg font-semibold text-gold">
            Puntuación
          </h2>
          <p className="text-sm leading-relaxed text-text-secondary">
            El ranking se calcula a partir de tier, división y LP de SoloQ.
            Consulta{" "}
            <code className="font-mono text-gold">src/lib/elo.ts</code> para
            el detalle exacto de la fórmula.
          </p>
        </section>
      </main>
    </div>
  );
}

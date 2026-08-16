import { Header } from "@/components/Header";
import { FixedLogo } from "@/components/FixedLogo";

const PRIZES = [
  { place: "1er lugar", emoji: "🥇", amount: "$100", colorVar: "--gold" },
  { place: "2do lugar", emoji: "🥈", amount: "$50", colorVar: "--silver" },
  { place: "3er lugar", emoji: "🥉", amount: "$25", colorVar: "--bronze" },
  { place: "4to lugar", emoji: "🏅", amount: "$15", colorVar: "--text-secondary" },
  { place: "5to lugar", emoji: "🏅", amount: "$10", colorVar: "--text-secondary" },
] as const;

export default function ReglasPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <FixedLogo />
      <Header />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 pt-44 pb-10">
        <h1 className="font-display text-3xl font-bold tracking-tight text-text-primary">
          Reglas
        </h1>

        <section className="flex flex-col gap-4 rounded-2xl border border-border-hairline bg-surface p-6">
          <h2 className="font-display text-lg font-semibold text-gold">
            Formato
          </h2>
          <ul className="flex flex-col gap-2.5 text-sm leading-relaxed text-text-secondary">
            <li className="flex gap-2.5">
              <span className="text-gold" aria-hidden>
                •
              </span>
              <span>
                Máximo <strong className="text-text-primary">200 partidas</strong>{" "}
                de SoloQ en un plazo de{" "}
                <strong className="text-text-primary">1 mes</strong>.
              </span>
            </li>
            <li className="flex gap-2.5">
              <span className="text-gold" aria-hidden>
                •
              </span>
              <span>
                Gana quien tenga <strong className="text-text-primary">más LP</strong>{" "}
                al finalizar el periodo.
              </span>
            </li>
          </ul>
        </section>

        <section className="flex flex-col gap-4 rounded-2xl border border-border-hairline bg-surface p-6">
          <h2 className="font-display text-lg font-semibold text-gold">
            Límites
          </h2>
          <ul className="flex flex-col gap-2.5 text-sm leading-relaxed text-text-secondary">
            <li className="flex gap-2.5">
              <span className="text-gold" aria-hidden>
                •
              </span>
              <span>
                Si llegas a las <strong className="text-text-primary">200 partidas</strong>{" "}
                antes de que termine el mes, ese es tu límite — ya no puedes
                seguir sumando.
              </span>
            </li>
            <li className="flex gap-2.5">
              <span className="text-gold" aria-hidden>
                •
              </span>
              <span>
                Si se acaba el tiempo (el mes) y no completaste las 200
                partidas, se te acabó el tiempo — el ranking se congela con lo
                que tengas hasta ese momento.
              </span>
            </li>
          </ul>
        </section>

        <section className="flex flex-col gap-2 rounded-2xl border border-border-hairline bg-surface p-6">
          <h2 className="font-display text-lg font-semibold text-gold">
            Premios
          </h2>
          <ul className="flex flex-col divide-y divide-border-hairline">
            {PRIZES.map((prize) => (
              <li
                key={prize.place}
                className="flex items-center justify-between gap-4 py-3 first:pt-2 last:pb-0"
              >
                <div className="flex items-center gap-3">
                  <span className="text-2xl" aria-hidden>
                    {prize.emoji}
                  </span>
                  <span className="font-medium text-text-primary">
                    {prize.place}
                  </span>
                </div>
                <span
                  className="font-display text-xl font-bold"
                  style={{ color: `var(${prize.colorVar})` }}
                >
                  {prize.amount}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}

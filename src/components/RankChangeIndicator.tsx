/**
 * Cuántas posiciones subió/bajó un participante desde la corrida anterior
 * (ver rankChange en src/lib/leaderboard.ts). Sin salida visual con 0 (se
 * mantuvo) o null (recién apareció, sin snapshot previo con qué comparar) —
 * el espacio reservado (w-4) evita que el resto de la fila salte de lugar
 * según si esta fila muestra flecha o no.
 */
export function RankChangeIndicator({ change }: { change: number | null }) {
  return (
    <div className="flex w-4 shrink-0 flex-col items-center justify-center gap-0.5">
      {change ? (
        <span
          className={`flex flex-col items-center gap-0.5 text-[10px] leading-none font-bold ${
            change > 0 ? "text-win" : "text-loss"
          }`}
          title={
            change > 0
              ? `Subió ${change} posición${change === 1 ? "" : "es"} desde la última actualización`
              : `Bajó ${Math.abs(change)} posición${Math.abs(change) === 1 ? "" : "es"} desde la última actualización`
          }
        >
          <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" fill="currentColor">
            {change > 0 ? (
              <path d="M5 1.5 9 8H1Z" />
            ) : (
              <path d="M5 8.5 1 2h8Z" />
            )}
          </svg>
          {Math.abs(change)}
        </span>
      ) : null}
    </div>
  );
}

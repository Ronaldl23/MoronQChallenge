// Test del sistema "Aegis" (src/lib/aegis.ts), sin red ni base de datos —
// mismo patrón que scripts/test-quests.mjs.
//
//   node --experimental-strip-types scripts/test-aegis.mjs
//
import {
  isProbableAegisProc,
  AEGIS_LP_MULTIPLIER,
  AEGIS_ABSOLUTE_LP_THRESHOLD,
} from "../src/lib/aegis.ts";

let passed = 0;
let failed = 0;

function assertEqual(actual, expected, label) {
  if (actual === expected) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL: ${label}`);
    console.error(`  esperado: ${JSON.stringify(expected)}`);
    console.error(`  obtenido: ${JSON.stringify(actual)}`);
  }
}

// Caso base del umbral RELATIVO: promedio 15 => 1.7x = 25.5. Usa valores
// por debajo de AEGIS_ABSOLUTE_LP_THRESHOLD (31) a propósito, para aislar
// el umbral relativo del absoluto (ver más abajo los casos del absoluto).
assertEqual(
  isProbableAegisProc({ isNonRemakeWin: true, lpGained: 26, historicalAvgLpGained: 15 }),
  true,
  "victoria aislada, LP >= 1.7x el promedio -> proc (umbral relativo)",
);

assertEqual(
  isProbableAegisProc({ isNonRemakeWin: true, lpGained: 25, historicalAvgLpGained: 15 }),
  false,
  "justo por debajo del umbral relativo (y por debajo del absoluto) -> no proc",
);

// Partida no aislable (comparte hueco de snapshots con otra, o sin
// snapshot "antes" todavía) -> el caller pasa lpGained null, se salta.
assertEqual(
  isProbableAegisProc({ isNonRemakeWin: true, lpGained: null, historicalAvgLpGained: 20 }),
  false,
  "partida no aislable (lpGained null) -> no proc",
);

// La partida fue una DERROTA -> no cuenta como Aegis.
assertEqual(
  isProbableAegisProc({ isNonRemakeWin: false, lpGained: 40, historicalAvgLpGained: 20 }),
  false,
  "derrota (o remake) -> no proc",
);

// isNonRemakeWin desconocido (no se pudo bajar el detalle de la partida)
// -> no proc, nunca se asume un valor por default.
assertEqual(
  isProbableAegisProc({ isNonRemakeWin: null, lpGained: 40, historicalAvgLpGained: 20 }),
  false,
  "isNonRemakeWin desconocido -> no proc",
);

// Sin promedio histórico todavía (jugador nuevo, sin historial de
// victorias con cambio de LP) y LP ganado por DEBAJO del umbral absoluto ->
// no proc por el relativo (evita el falso positivo de 1.7 * 0 = 0). El
// umbral absoluto es aparte, ver el caso de abajo con 40 LP.
assertEqual(
  isProbableAegisProc({ isNonRemakeWin: true, lpGained: 25, historicalAvgLpGained: 0 }),
  false,
  "sin promedio histórico (0) y por debajo del absoluto -> no proc",
);

// Sin promedio histórico PERO por encima del umbral absoluto, fuera de
// placements -> proc igual: 40 LP es evidencia de Aegis por sí sola, no
// hace falta historial previo para confiar en el umbral absoluto.
assertEqual(
  isProbableAegisProc({ isNonRemakeWin: true, lpGained: 40, historicalAvgLpGained: 0 }),
  true,
  "sin promedio histórico pero 40 LP (más de 31), fuera de placements -> proc",
);

// LP ganado 0 o negativo (no debería pasar en una victoria real, pero por
// las dudas) -> no proc.
assertEqual(
  isProbableAegisProc({ isNonRemakeWin: true, lpGained: 0, historicalAvgLpGained: 20 }),
  false,
  "LP ganado 0 -> no proc",
);

assertEqual(AEGIS_LP_MULTIPLIER, 1.7, "AEGIS_LP_MULTIPLIER es 1.7");
assertEqual(AEGIS_ABSOLUTE_LP_THRESHOLD, 31, "AEGIS_ABSOLUTE_LP_THRESHOLD es 31");

// Caso real reportado (Benimaru): ganó 38 LP en una victoria real, pero su
// promedio histórico ya era alto (38 < 1.7 * promedio) y no se detectaba —
// el umbral ABSOLUTO ahora lo agarra igual, sin importar el promedio.
assertEqual(
  isProbableAegisProc({ isNonRemakeWin: true, lpGained: 38, historicalAvgLpGained: 25 }),
  true,
  "38 LP ganados, promedio alto (no cruza 1.7x) -> proc igual por el umbral absoluto",
);

// Justo en el umbral (31) NO alcanza — tiene que ser MÁS de 31 (32+).
assertEqual(
  isProbableAegisProc({ isNonRemakeWin: true, lpGained: 31, historicalAvgLpGained: 100 }),
  false,
  "exactamente 31 LP, sin cruzar el relativo -> no proc (hace falta MÁS de 31)",
);

assertEqual(
  isProbableAegisProc({ isNonRemakeWin: true, lpGained: 32, historicalAvgLpGained: 100 }),
  true,
  "32 LP (más de 31) -> proc por el umbral absoluto, sin importar el promedio",
);

// En placements: el umbral absoluto NO aplica, aunque gane mucho LP de un
// salto (calibración, no Aegis) — el relativo tampoco dispara sin promedio.
assertEqual(
  isProbableAegisProc({
    isNonRemakeWin: true,
    lpGained: 60,
    historicalAvgLpGained: 0,
    inPlacements: true,
  }),
  false,
  "60 LP en placements, sin promedio histórico -> no proc (el absoluto no aplica en placements)",
);

console.log(`\n${passed} pasaron, ${failed} fallaron`);
if (failed > 0) process.exit(1);

// Test del sistema "Aegis" (src/lib/aegis.ts), sin red ni base de datos —
// mismo patrón que scripts/test-quests.mjs.
//
//   node --experimental-strip-types scripts/test-aegis.mjs
//
import { isProbableAegisProc, AEGIS_LP_MULTIPLIER } from "../src/lib/aegis.ts";

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

// Caso base: victoria, LP ganado justo en el umbral (1.7x el promedio
// histórico de 20 => 34).
assertEqual(
  isProbableAegisProc({ isNonRemakeWin: true, lpGained: 34, historicalAvgLpGained: 20 }),
  true,
  "victoria aislada, LP >= 1.7x el promedio -> proc",
);

assertEqual(
  isProbableAegisProc({ isNonRemakeWin: true, lpGained: 33, historicalAvgLpGained: 20 }),
  false,
  "justo por debajo del umbral (1.65x) -> no proc",
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
// victorias con cambio de LP) -> nunca proc, aunque el LP ganado sea alto,
// para evitar falsos positivos con el umbral 1.7 * 0 = 0.
assertEqual(
  isProbableAegisProc({ isNonRemakeWin: true, lpGained: 40, historicalAvgLpGained: 0 }),
  false,
  "sin promedio histórico (0) -> no proc aunque haya LP ganado",
);

// LP ganado 0 o negativo (no debería pasar en una victoria real, pero por
// las dudas) -> no proc.
assertEqual(
  isProbableAegisProc({ isNonRemakeWin: true, lpGained: 0, historicalAvgLpGained: 20 }),
  false,
  "LP ganado 0 -> no proc",
);

assertEqual(AEGIS_LP_MULTIPLIER, 1.7, "AEGIS_LP_MULTIPLIER es 1.7");

console.log(`\n${passed} pasaron, ${failed} fallaron`);
if (failed > 0) process.exit(1);

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

// Caso base: 1 sola partida nueva, victoria, LP ganado justo en el umbral
// (1.7x el promedio histórico de 20 => 34).
assertEqual(
  isProbableAegisProc({
    newMatchCount: 1,
    singleNewMatchIsNonRemakeWin: true,
    lpGainedThisMatch: 34,
    historicalAvgLpGained: 20,
  }),
  true,
  "1 partida aislable, victoria, LP >= 1.7x el promedio -> proc",
);

assertEqual(
  isProbableAegisProc({
    newMatchCount: 1,
    singleNewMatchIsNonRemakeWin: true,
    lpGainedThisMatch: 33,
    historicalAvgLpGained: 20,
  }),
  false,
  "justo por debajo del umbral (1.65x) -> no proc",
);

// 2+ partidas nuevas en la misma corrida: no se puede aislar cuál dio
// cuánto LP -> se salta, igual que un remake para las quests.
assertEqual(
  isProbableAegisProc({
    newMatchCount: 2,
    singleNewMatchIsNonRemakeWin: null,
    lpGainedThisMatch: null,
    historicalAvgLpGained: 20,
  }),
  false,
  "2+ partidas nuevas en la misma corrida -> se salta",
);

assertEqual(
  isProbableAegisProc({
    newMatchCount: 5,
    singleNewMatchIsNonRemakeWin: null,
    lpGainedThisMatch: null,
    historicalAvgLpGained: 20,
  }),
  false,
  "5 partidas nuevas en la misma corrida -> se salta",
);

// La única partida nueva fue una DERROTA -> no cuenta como Aegis.
assertEqual(
  isProbableAegisProc({
    newMatchCount: 1,
    singleNewMatchIsNonRemakeWin: false,
    lpGainedThisMatch: null,
    historicalAvgLpGained: 20,
  }),
  false,
  "única partida nueva es derrota (o remake) -> no proc",
);

// Sin promedio histórico todavía (jugador nuevo, sin historial de
// victorias con cambio de LP) -> nunca proc, aunque el LP ganado sea alto,
// para evitar falsos positivos con el umbral 1.7 * 0 = 0.
assertEqual(
  isProbableAegisProc({
    newMatchCount: 1,
    singleNewMatchIsNonRemakeWin: true,
    lpGainedThisMatch: 40,
    historicalAvgLpGained: 0,
  }),
  false,
  "sin promedio histórico (0) -> no proc aunque haya LP ganado",
);

// newMatchCount o singleNewMatchIsNonRemakeWin desconocidos (Riot no
// respondió, o el fetch de la única partida falló) -> no proc, nunca se
// asume un valor por default.
assertEqual(
  isProbableAegisProc({
    newMatchCount: null,
    singleNewMatchIsNonRemakeWin: null,
    lpGainedThisMatch: null,
    historicalAvgLpGained: 20,
  }),
  false,
  "newMatchCount desconocido -> no proc",
);

assertEqual(
  isProbableAegisProc({
    newMatchCount: 1,
    singleNewMatchIsNonRemakeWin: null,
    lpGainedThisMatch: null,
    historicalAvgLpGained: 20,
  }),
  false,
  "1 partida nueva pero no se pudo bajar su detalle -> no proc",
);

// lpGainedThisMatch no comparable (cambio de tier/división, o sin
// snapshot previo) -> no proc, aunque el resto de las condiciones se
// cumplan.
assertEqual(
  isProbableAegisProc({
    newMatchCount: 1,
    singleNewMatchIsNonRemakeWin: true,
    lpGainedThisMatch: null,
    historicalAvgLpGained: 20,
  }),
  false,
  "LP no comparable (cambio de tier/división) -> no proc",
);

// Sin partidas nuevas -> no proc.
assertEqual(
  isProbableAegisProc({
    newMatchCount: 0,
    singleNewMatchIsNonRemakeWin: null,
    lpGainedThisMatch: null,
    historicalAvgLpGained: 20,
  }),
  false,
  "0 partidas nuevas -> no proc",
);

assertEqual(AEGIS_LP_MULTIPLIER, 1.7, "AEGIS_LP_MULTIPLIER es 1.7");

console.log(`\n${passed} pasaron, ${failed} fallaron`);
if (failed > 0) process.exit(1);

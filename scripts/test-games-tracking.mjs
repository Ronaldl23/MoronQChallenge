// Test del tope de partidas rastreadas (src/lib/games-tracking.ts), sin red
// ni base de datos — mismo patrón que scripts/test-aegis.mjs.
//
//   node --experimental-strip-types scripts/test-games-tracking.mjs
//
import { isTrackingFrozen, GAMES_TRACKING_LIMIT } from "../src/lib/games-tracking.ts";

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

assertEqual(GAMES_TRACKING_LIMIT, 200, "GAMES_TRACKING_LIMIT es 200");

assertEqual(
  isTrackingFrozen(199, false),
  false,
  "por debajo del límite, sin excepción -> no congelado",
);

assertEqual(
  isTrackingFrozen(200, false),
  true,
  "justo en el límite, sin excepción -> congelado",
);

assertEqual(
  isTrackingFrozen(500, false),
  true,
  "muy por encima del límite, sin excepción -> congelado",
);

assertEqual(
  isTrackingFrozen(500, true),
  false,
  "por encima del límite pero CON excepción del admin -> nunca congelado",
);

assertEqual(
  isTrackingFrozen(0, false),
  false,
  "recién arrancando (0 partidas) -> no congelado",
);

console.log(`\n${passed} pasaron, ${failed} fallaron`);
if (failed > 0) process.exit(1);

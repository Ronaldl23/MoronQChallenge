// Test de rankOrdinal() — sin red ni base de datos, mismo patrón que
// scripts/test-presence.mjs. Cubre en particular el caso que elo_score NO
// resuelve bien: un ascenso de tier en el límite apex (Master/GM/Challenger)
// donde el LP arranca más bajo del otro lado (se resetea al ascender).
//
//   node --experimental-strip-types scripts/test-rank-ordinal.mjs
//
import { rankOrdinal } from "../src/lib/elo.ts";

let passed = 0;
let failed = 0;

function assertTrue(actual, label) {
  if (actual) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL: ${label}`);
  }
}

function assertEqual(actual, expected, label) {
  const ok = actual === expected;
  if (ok) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL: ${label}`);
    console.error(`  esperado: ${expected}`);
    console.error(`  obtenido: ${actual}`);
  }
}

// Divisiones dentro del mismo tier: IV < III < II < I.
assertTrue(
  rankOrdinal("GOLD", "III") > rankOrdinal("GOLD", "IV"),
  "GOLD III > GOLD IV",
);
assertTrue(
  rankOrdinal("GOLD", "I") > rankOrdinal("GOLD", "II"),
  "GOLD I > GOLD II",
);

// Cruzar de tier siempre pesa más que cualquier división del tier anterior.
assertTrue(
  rankOrdinal("PLATINUM", "IV") > rankOrdinal("GOLD", "I"),
  "PLATINUM IV > GOLD I (el tier de arriba gana aunque sea la división más baja)",
);

// El caso que elo_score NO resuelve bien: ascenso real de Master a
// Grandmaster con LP reseteado más bajo del lado de Grandmaster.
assertTrue(
  rankOrdinal("GRANDMASTER", null) > rankOrdinal("MASTER", null),
  "GRANDMASTER > MASTER (sin importar LP — rankOrdinal no usa LP)",
);
assertTrue(
  rankOrdinal("CHALLENGER", null) > rankOrdinal("GRANDMASTER", null),
  "CHALLENGER > GRANDMASTER",
);

// Orden completo IRON -> CHALLENGER (tiers, sin división para apex).
const ORDERED_TIERS = [
  "IRON",
  "BRONZE",
  "SILVER",
  "GOLD",
  "PLATINUM",
  "EMERALD",
  "DIAMOND",
  "MASTER",
  "GRANDMASTER",
  "CHALLENGER",
];
for (let i = 1; i < ORDERED_TIERS.length; i++) {
  assertTrue(
    rankOrdinal(ORDERED_TIERS[i], null) >
      rankOrdinal(ORDERED_TIERS[i - 1], null),
    `${ORDERED_TIERS[i]} > ${ORDERED_TIERS[i - 1]}`,
  );
}

// Mismo tier/división: ordinal idéntico (no hay "cambio" a detectar).
assertEqual(
  rankOrdinal("DIAMOND", "II"),
  rankOrdinal("DIAMOND", "II"),
  "mismo tier/división: mismo ordinal",
);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

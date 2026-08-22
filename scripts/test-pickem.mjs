// Test de la lógica pura de Pick'em (src/lib/pickem.ts), sin red ni base
// de datos — mismo patrón que scripts/test-quests.mjs.
//
//   node --experimental-strip-types scripts/test-pickem.mjs
//
import {
  validatePredictedOrder,
  computePickemResultStatus,
  normalizePickemName,
  isPickemLockedAt,
} from "../src/lib/pickem-logic.ts";

let passed = 0;
let failed = 0;

function assertEqual(actual, expected, label) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL: ${label}`);
    console.error(`  esperado: ${JSON.stringify(expected)}`);
    console.error(`  obtenido: ${JSON.stringify(actual)}`);
  }
}

const roster = ["a", "b", "c"];

assertEqual(
  validatePredictedOrder(["a", "b", "c"], roster),
  { ok: true, order: ["a", "b", "c"] },
  "orden válido, mismo roster -> ok",
);

assertEqual(
  validatePredictedOrder(["a", "a", "c"], roster).ok,
  false,
  "id repetido -> inválido",
);

assertEqual(
  validatePredictedOrder(["a", "b"], roster).ok,
  false,
  "faltan participantes -> inválido",
);

assertEqual(
  validatePredictedOrder(["a", "b", "c", "d"], roster).ok,
  false,
  "id que no existe en el roster -> inválido",
);

assertEqual(validatePredictedOrder("no-array", roster).ok, false, "no es un array -> inválido");

// computePickemResultStatus
const participantsById = new Map([
  ["a", { id: "a", nombre: "Ana", photo_url: "", created_at: "" }],
  ["b", { id: "b", nombre: "Beto", photo_url: "", created_at: "" }],
  ["c", { id: "c", nombre: "Caro", photo_url: "", created_at: "" }], // sin match en el ranking final
]);
const finalRankByName = new Map([
  ["ana", 1],
  ["beto", 3],
]);

assertEqual(
  computePickemResultStatus(["a", "b", "c"], participantsById, finalRankByName),
  ["correct", "incorrect", "unknown"],
  "acierto en pos 1 (Ana), fallo en pos 2 (Beto quedó 3ro), sin dato para Caro",
);

// normalizePickemName — mismatch de mayúsculas/espacios no debería romper el match
assertEqual(normalizePickemName("  Ana  "), "ana", "normaliza espacios y mayúsculas");

// isPickemLockedAt — puro respecto a `now`/`lockAtIso`, sin depender del reloj real
const LOCK_AT = "2026-08-25T00:00:00Z"; // mismo valor que TOURNAMENT_START_DATE
const START = new Date(LOCK_AT).getTime();
assertEqual(isPickemLockedAt(START - 1000, LOCK_AT), false, "1s antes del inicio -> no bloqueado");
assertEqual(isPickemLockedAt(START, LOCK_AT), true, "justo en el inicio -> bloqueado");
assertEqual(isPickemLockedAt(START + 1000, LOCK_AT), true, "1s después del inicio -> bloqueado");

console.log(`\n${passed} pasaron, ${failed} fallaron`);
if (failed > 0) process.exit(1);

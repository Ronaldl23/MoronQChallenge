// Test del cálculo puro de ranking (src/lib/ranking.ts), sin red ni base
// de datos — mismo patrón que scripts/test-rank-change.mjs.
//
//   node --experimental-strip-types scripts/test-ranking.mjs
//
import { computeRankOrder, effectiveEloScoreForRanking } from "../src/lib/ranking.ts";

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

function toObject(map) {
  return Object.fromEntries(map);
}

// === effectiveEloScoreForRanking ===

// --- 1. No descalificado -> su elo_score tal cual ---
{
  assertEqual(effectiveEloScoreForRanking(1500, false), 1500, "no descalificado: elo_score real");
}

// --- 2. Descalificado -> MIN_SAFE_INTEGER, sin importar el elo_score real ---
{
  assertEqual(
    effectiveEloScoreForRanking(9999, true),
    Number.MIN_SAFE_INTEGER,
    "descalificado: siempre MIN_SAFE_INTEGER sin importar el elo real",
  );
}

// === computeRankOrder ===

// --- 3. Orden simple por elo_score descendente ---
{
  const result = computeRankOrder([
    { id: "a", eloScore: 100, isDisqualified: false },
    { id: "b", eloScore: 300, isDisqualified: false },
    { id: "c", eloScore: 200, isDisqualified: false },
  ]);
  assertEqual(toObject(result), { b: 1, c: 2, a: 3 }, "orden simple: b > c > a");
}

// --- 4. Un descalificado con el elo más alto igual cae al último lugar ---
{
  const result = computeRankOrder([
    { id: "a", eloScore: 100, isDisqualified: false },
    { id: "b", eloScore: 9999, isDisqualified: true },
    { id: "c", eloScore: 50, isDisqualified: false },
  ]);
  assertEqual(toObject(result), { a: 1, c: 2, b: 3 }, "descalificado con elo altísimo: último igual");
}

// --- 5. Dos descalificados a la vez -> no crashea ni da NaN, ambos al final ---
{
  const result = computeRankOrder([
    { id: "a", eloScore: 100, isDisqualified: false },
    { id: "b", eloScore: 200, isDisqualified: true },
    { id: "c", eloScore: 300, isDisqualified: true },
  ]);
  const values = [...result.values()];
  assertEqual(values.every((v) => Number.isInteger(v)), true, "dos descalificados: todos los ranks son enteros válidos");
  assertEqual(result.get("a"), 1, "dos descalificados: el único no-descalificado queda 1ro");
  assertEqual(
    new Set([result.get("b"), result.get("c")]).size === 2 &&
      result.get("b") > 1 &&
      result.get("c") > 1,
    true,
    "dos descalificados: ambos quedan atrás del no-descalificado, con ranks distintos",
  );
}

// --- 6. Un solo participante -> rank 1 ---
{
  const result = computeRankOrder([{ id: "solo", eloScore: 1, isDisqualified: false }]);
  assertEqual(toObject(result), { solo: 1 }, "un solo participante: rank 1");
}

// --- 7. Lista vacía -> mapa vacío ---
{
  assertEqual(toObject(computeRankOrder([])), {}, "lista vacía: mapa vacío");
}

console.log(`\n${passed} pasaron, ${failed} fallaron`);
if (failed > 0) process.exit(1);

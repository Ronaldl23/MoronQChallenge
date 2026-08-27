// Test del cálculo puro de cambio de posición en el ranking
// (src/lib/rank-change.ts), sin red ni base de datos — mismo patrón que
// scripts/test-quests.mjs.
//
//   node --experimental-strip-types scripts/test-rank-change.mjs
//
import { computeRankChanges, findEloScoreAtOrBefore } from "../src/lib/rank-change.ts";

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

// --- 1. Alguien sube 1 posición, otro baja 1 (se cruzan) ---
{
  // Antes: a=100, b=90 (a 1ro, b 2do). Ahora: b=110, a=100 (b 1ro, a 2do).
  const result = computeRankChanges([
    { id: "a", currentEloScore: 100, previousEloScore: 100 },
    { id: "b", currentEloScore: 110, previousEloScore: 90 },
  ]);
  assertEqual(
    toObject(result),
    { a: -1, b: 1 },
    "a baja 1 (1ro->2do), b sube 1 (2do->1ro)",
  );
}

// --- 2. Nadie se mueve -> 0 para todos ---
{
  const result = computeRankChanges([
    { id: "a", currentEloScore: 100, previousEloScore: 100 },
    { id: "b", currentEloScore: 90, previousEloScore: 90 },
    { id: "c", currentEloScore: 80, previousEloScore: 80 },
  ]);
  assertEqual(toObject(result), { a: 0, b: 0, c: 0 }, "mismo orden -> 0 para todos");
}

// --- 3. Sin previousEloScore -> null (recién apareció en el ranking) ---
{
  const result = computeRankChanges([
    { id: "a", currentEloScore: 100, previousEloScore: 100 },
    { id: "b", currentEloScore: 90, previousEloScore: null },
  ]);
  assertEqual(
    toObject(result),
    { a: 0, b: null },
    "b sin snapshot anterior -> null, a no se ve afectado por la ausencia de b",
  );
}

// --- 4. Alguien nuevo se cuela en el medio: SÍ corre a los de abajo (posición real observada en el leaderboard, antes b ni aparecía rankeado) ---
{
  // Antes (b todavía sin rango, ni entraba a esta lista): a=100 (1ro), c=50 (2do, de verdad).
  // Ahora: a=100 (1ro), b=80 (2do, nuevo), c=50 (3ro).
  const result = computeRankChanges([
    { id: "a", currentEloScore: 100, previousEloScore: 100 },
    { id: "b", currentEloScore: 80, previousEloScore: null },
    { id: "c", currentEloScore: 50, previousEloScore: 50 },
  ]);
  assertEqual(
    toObject(result),
    { a: 0, b: null, c: -1 },
    "b (nuevo, sin previousEloScore) no tiene rankChange; c SÍ baja de 2do a 3ro — antes b ni aparecía rankeado, así que c de verdad era 2do",
  );
}

// --- 5. Salto de varias posiciones a la vez ---
{
  // Antes: a=10(1ro) b=9(2do) c=8(3ro) d=5(4to, el más bajo)
  // Ahora: d=110(1ro, pegó el salto) a=10(2do) b=9(3ro) c=8(4to)
  const result = computeRankChanges([
    { id: "a", currentEloScore: 10, previousEloScore: 10 },
    { id: "b", currentEloScore: 9, previousEloScore: 9 },
    { id: "c", currentEloScore: 8, previousEloScore: 8 },
    { id: "d", currentEloScore: 110, previousEloScore: 5 },
  ]);
  assertEqual(
    toObject(result),
    { a: -1, b: -1, c: -1, d: 3 },
    "d salta del 4to al 1ro puesto (+3), el resto baja 1 cada uno",
  );
}

// --- 6. Empate exacto en el elo_score anterior -> el orden de sort es estable (no debería crashear ni dar NaN) ---
{
  const result = computeRankChanges([
    { id: "a", currentEloScore: 100, previousEloScore: 50 },
    { id: "b", currentEloScore: 90, previousEloScore: 50 },
  ]);
  const values = [...result.values()];
  assertEqual(
    values.every((v) => Number.isInteger(v)),
    true,
    "empate en previousEloScore: ambos resultados son enteros válidos, sin NaN",
  );
}

// --- 7. Un solo participante -> siempre rank 1, rankChange 0 si tenía previousEloScore ---
{
  const result = computeRankChanges([{ id: "a", currentEloScore: 100, previousEloScore: 100 }]);
  assertEqual(toObject(result), { a: 0 }, "un solo participante: siempre 1ro, sin cambio");
}

function point(eloScore, createdAt) {
  return { eloScore, createdAt };
}

// === findEloScoreAtOrBefore ===

// --- 8. Caso normal: elige el snapshot más reciente que sea <= cutoff, no el más viejo de todos ---
{
  const history = [
    point(10, "2026-01-01T00:00:00Z"),
    point(20, "2026-01-01T00:30:00Z"), // <= cutoff (00:45) -> este es el elegido
    point(30, "2026-01-01T01:00:00Z"), // > cutoff, se ignora
  ];
  const result = findEloScoreAtOrBefore(history, "2026-01-01T00:45:00Z");
  assertEqual(result, 20, "elige el snapshot más reciente que sigue siendo <= cutoff");
}

// --- 9. Todos los snapshots son más nuevos que el cutoff -> null (participante muy nuevo) ---
{
  const history = [point(10, "2026-01-01T00:50:00Z"), point(20, "2026-01-01T00:55:00Z")];
  const result = findEloScoreAtOrBefore(history, "2026-01-01T00:00:00Z");
  assertEqual(result, null, "sin ningún snapshot con la antigüedad pedida -> null");
}

// --- 10. Todos los snapshots son más viejos que el cutoff -> se queda con el más reciente de todos ---
{
  const history = [point(10, "2026-01-01T00:00:00Z"), point(20, "2026-01-01T00:10:00Z")];
  const result = findEloScoreAtOrBefore(history, "2026-01-01T12:00:00Z");
  assertEqual(result, 20, "cutoff muy en el futuro respecto al historial -> el más reciente de todos");
}

// --- 11. Exactamente en el borde (createdAt === cutoff) -> se incluye (<=, no <) ---
{
  const history = [point(10, "2026-01-01T00:00:00Z")];
  const result = findEloScoreAtOrBefore(history, "2026-01-01T00:00:00Z");
  assertEqual(result, 10, "createdAt igual al cutoff -> se incluye, no se excluye");
}

// --- 12. Historial vacío -> null ---
{
  assertEqual(findEloScoreAtOrBefore([], "2026-01-01T00:00:00Z"), null, "sin historial -> null");
}

console.log(`\n${passed} pasaron, ${failed} fallaron`);
if (failed > 0) process.exit(1);

// Test del motor de cumplimiento de castigos del sistema de Mangos
// (src/lib/penalty.ts), sin red ni base de datos — mismo patrón que
// scripts/test-quests.mjs.
//
//   node --experimental-strip-types scripts/test-penalty.mjs
//
import { processPenaltyMatches, PENALTY_GAME_LIMIT } from "../src/lib/penalty.ts";
import { SUPPORT_ASSIGNMENT as SUPPORT_ASSIGNMENT_FROM_MANGO_LAUNCH } from "../src/lib/mango-launch.ts";

// penalty.ts duplica este valor a propósito (ver comentario ahí) — este test
// es lo que garantiza que no se desincronice del original en mango-launch.ts.
const SUPPORT_ASSIGNMENT = SUPPORT_ASSIGNMENT_FROM_MANGO_LAUNCH;

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

const BASE_DATE = "2026-01-01T00:00:00.000Z";

function penalty(id, championAssigned, { gamesWithoutCompliance = 0, createdAt = BASE_DATE } = {}) {
  return { id, championAssigned, gamesWithoutCompliance, createdAt };
}

function match(id, { playedAt, championPlayed = "Ahri", teamPosition = "MIDDLE" } = {}) {
  return { matchId: id, playedAt, championPlayed, teamPosition };
}

// Timestamps crecientes después de BASE_DATE, para no tener que escribirlos a mano en cada test.
function at(hoursAfterBase) {
  return new Date(new Date(BASE_DATE).getTime() + hoursAfterBase * 60 * 60 * 1000).toISOString();
}

// --- 1. Cumple a tiempo: jugó el campeón asignado en la primera partida -> 'completed' de inmediato ---
{
  const penalties = [penalty("p1", "Teemo")];
  const matches = [match("m1", { playedAt: at(1), championPlayed: "Teemo" })];
  const result = processPenaltyMatches({ penalties, matches });
  assertEqual(
    result,
    [{ id: "p1", gamesWithoutCompliance: 0, status: "completed", completedOnMatchId: "m1" }],
    "cumple en la 1ra partida: completed sin incrementar el contador",
  );
}

// --- 2. Cumple en la 3ra partida (las primeras 2 no cumplen): completed, contador quedó en 2 ---
{
  const penalties = [penalty("p1", "Teemo")];
  const matches = [
    match("m1", { playedAt: at(1), championPlayed: "Ahri" }),
    match("m2", { playedAt: at(2), championPlayed: "Zed" }),
    match("m3", { playedAt: at(3), championPlayed: "Teemo" }),
  ];
  const result = processPenaltyMatches({ penalties, matches });
  assertEqual(
    result,
    [{ id: "p1", gamesWithoutCompliance: 2, status: "completed", completedOnMatchId: "m3" }],
    "cumple en la 3ra partida: completed, gamesWithoutCompliance quedó en 2 (no sube en la que sí cumple)",
  );
}

// --- 3. No cumple en 3 partidas seguidas -> pasa a 'flagged_for_review' ---
{
  const penalties = [penalty("p1", "Teemo")];
  const matches = [
    match("m1", { playedAt: at(1), championPlayed: "Ahri" }),
    match("m2", { playedAt: at(2), championPlayed: "Zed" }),
    match("m3", { playedAt: at(3), championPlayed: "Jinx" }),
  ];
  const result = processPenaltyMatches({ penalties, matches });
  assertEqual(
    result,
    [{ id: "p1", gamesWithoutCompliance: 3, status: "flagged_for_review", completedOnMatchId: null }],
    "3 partidas sin cumplir: flagged_for_review, contador en el límite exacto",
  );
}

// --- 4. Solo 2 partidas sin cumplir todavía (no llegó al límite) -> sigue 'pending' ---
{
  const penalties = [penalty("p1", "Teemo")];
  const matches = [
    match("m1", { playedAt: at(1), championPlayed: "Ahri" }),
    match("m2", { playedAt: at(2), championPlayed: "Zed" }),
  ];
  const result = processPenaltyMatches({ penalties, matches });
  assertEqual(
    result,
    [{ id: "p1", gamesWithoutCompliance: 2, status: "pending", completedOnMatchId: null }],
    "2 partidas sin cumplir (todavía no llega a 3): sigue pending, con margen",
  );
}

// --- 5. Una vez flagged, partidas siguientes no lo tocan más (no sigue subiendo el contador) ---
{
  const penalties = [penalty("p1", "Teemo")];
  const matches = [
    match("m1", { playedAt: at(1), championPlayed: "Ahri" }),
    match("m2", { playedAt: at(2), championPlayed: "Zed" }),
    match("m3", { playedAt: at(3), championPlayed: "Jinx" }),
    match("m4", { playedAt: at(4), championPlayed: "Teemo" }), // llega tarde, ya no cuenta
  ];
  const result = processPenaltyMatches({ penalties, matches });
  assertEqual(
    result,
    [{ id: "p1", gamesWithoutCompliance: 3, status: "flagged_for_review", completedOnMatchId: null }],
    "flagged en m3: partidas posteriores (m4, aunque cumpla) no lo revierten ni lo tocan más",
  );
}

// --- 6. Castigo "Support": cumple jugando CUALQUIER campeón en UTILITY ---
{
  const penalties = [penalty("p1", SUPPORT_ASSIGNMENT)];
  const matches = [
    match("m1", { playedAt: at(1), championPlayed: "Ahri", teamPosition: "MIDDLE" }),
    match("m2", { playedAt: at(2), championPlayed: "Jinx", teamPosition: "UTILITY" }), // cualquier campeón sirve, lo que importa es la línea
  ];
  const result = processPenaltyMatches({ penalties, matches });
  assertEqual(
    result,
    [{ id: "p1", gamesWithoutCompliance: 1, status: "completed", completedOnMatchId: "m2" }],
    "castigo Support: cumple con Jinx en UTILITY (no hace falta un campeón específico)",
  );
}

// --- 7. Castigo "Support": jugar Support de nombre (campeón) pero en otra línea NO cumple ---
{
  const penalties = [penalty("p1", SUPPORT_ASSIGNMENT)];
  const matches = [match("m1", { playedAt: at(1), championPlayed: "Soraka", teamPosition: "BOTTOM" })];
  const result = processPenaltyMatches({ penalties, matches });
  assertEqual(
    result,
    [{ id: "p1", gamesWithoutCompliance: 1, status: "pending", completedOnMatchId: null }],
    "castigo Support: jugar en BOTTOM no cumple aunque el campeón sea un support típico — importa teamPosition, no el campeón",
  );
}

// --- 8. Múltiples castigos simultáneos: una partida cumple SOLO el que coincide, el otro sigue sumando ---
{
  const penalties = [penalty("teemo", "Teemo"), penalty("zed", "Zed")];
  const matches = [match("m1", { playedAt: at(1), championPlayed: "Teemo" })];
  const result = processPenaltyMatches({ penalties, matches });
  assertEqual(
    result,
    [
      { id: "teemo", gamesWithoutCompliance: 0, status: "completed", completedOnMatchId: "m1" },
      { id: "zed", gamesWithoutCompliance: 1, status: "pending", completedOnMatchId: null },
    ],
    "2 castigos pendientes, 1 partida: se cumple el que coincide, el otro suma 1 sin cumplir",
  );
}

// --- 9. Múltiples castigos simultáneos: UNA partida cumple DOS a la vez (dos Support pendientes) ---
{
  const penalties = [penalty("s1", SUPPORT_ASSIGNMENT), penalty("s2", SUPPORT_ASSIGNMENT)];
  const matches = [match("m1", { playedAt: at(1), championPlayed: "Lulu", teamPosition: "UTILITY" })];
  const result = processPenaltyMatches({ penalties, matches });
  assertEqual(
    result,
    [
      { id: "s1", gamesWithoutCompliance: 0, status: "completed", completedOnMatchId: "m1" },
      { id: "s2", gamesWithoutCompliance: 0, status: "completed", completedOnMatchId: "m1" },
    ],
    "2 castigos Support pendientes a la vez: la misma partida en UTILITY cumple los DOS simultáneamente",
  );
}

// --- 10. Partidas jugadas ANTES de que se asignara el castigo no cuentan ni a favor ni en contra ---
{
  const penalties = [penalty("p1", "Teemo", { createdAt: at(5) })];
  const matches = [
    match("m1", { playedAt: at(1), championPlayed: "Ahri" }), // antes del castigo: se ignora
    match("m2", { playedAt: at(2), championPlayed: "Teemo" }), // antes del castigo: se ignora aunque "cumpliría"
  ];
  const result = processPenaltyMatches({ penalties, matches });
  assertEqual(
    result,
    [{ id: "p1", gamesWithoutCompliance: 0, status: "pending", completedOnMatchId: null }],
    "partidas anteriores a created_at del castigo: no cuentan, ni para sumar ni para cumplir",
  );
}

// --- 11. Retoma un contador que ya venía con progreso de una corrida anterior (2/3) -> la 3ra partida sin cumplir lo flaggea ---
{
  const penalties = [penalty("p1", "Teemo", { gamesWithoutCompliance: 2 })];
  const matches = [match("m1", { playedAt: at(1), championPlayed: "Ahri" })];
  const result = processPenaltyMatches({ penalties, matches });
  assertEqual(
    result,
    [{ id: "p1", gamesWithoutCompliance: 3, status: "flagged_for_review", completedOnMatchId: null }],
    "arranca en 2/3 de una corrida anterior: 1 partida más sin cumplir alcanza el límite (PENALTY_GAME_LIMIT=3)",
  );
}

// --- 12. Sin partidas nuevas: no-op, se devuelve tal cual estaba ---
{
  const penalties = [penalty("p1", "Teemo", { gamesWithoutCompliance: 1 })];
  const result = processPenaltyMatches({ penalties, matches: [] });
  assertEqual(
    result,
    [{ id: "p1", gamesWithoutCompliance: 1, status: "pending", completedOnMatchId: null }],
    "sin partidas nuevas: no cambia nada",
  );
}

assertEqual(PENALTY_GAME_LIMIT, 3, "PENALTY_GAME_LIMIT es 3 (regla confirmada por el usuario)");

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

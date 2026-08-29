// Test de la correlación LP-por-partida (src/lib/lp-correlation.ts), sin
// red ni base de datos — mismo patrón que scripts/test-quests.mjs.
//
//   node --experimental-strip-types scripts/test-lp-correlation.mjs
//
import { correlateLpChanges, correlateSingleMatchLp } from "../src/lib/lp-correlation.ts";

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

function snap(tier, division, lp, iso) {
  return { tier, division, lp, created_at: iso };
}

// === correlateLpChanges (varias partidas a la vez) ===

// --- 1. Una sola partida, bracket limpio -> LP correcto ---
{
  const snapshots = [
    snap("GOLD", "II", 40, "2026-01-01T00:00:00Z"),
    snap("GOLD", "II", 65, "2026-01-01T00:20:00Z"),
  ];
  const result = correlateLpChanges(
    [{ matchId: "m1", gameEndTimestamp: new Date("2026-01-01T00:10:00Z").getTime() }],
    snapshots,
  );
  assertEqual(toObj(result), { m1: 25 }, "1 partida en un bracket limpio -> +25 LP");
}

// --- 2. Dos partidas en el mismo hueco -> ambigua, se descarta ---
{
  const snapshots = [
    snap("GOLD", "II", 40, "2026-01-01T00:00:00Z"),
    snap("GOLD", "II", 90, "2026-01-01T00:40:00Z"),
  ];
  const result = correlateLpChanges(
    [
      { matchId: "m1", gameEndTimestamp: new Date("2026-01-01T00:10:00Z").getTime() },
      { matchId: "m2", gameEndTimestamp: new Date("2026-01-01T00:30:00Z").getTime() },
    ],
    snapshots,
  );
  assertEqual(toObj(result), {}, "2 partidas en el mismo hueco -> ninguna se puede aislar");
}

// --- 3. Cambio de tier entre snapshots -> se calcula vía calculateEloScore
// en vez de descartarse (Oro I 95 LP -> Platino IV 10 LP: ganó 95->100,
// asciende, y le quedan 10 más = 15 LP reales en esa partida) ---
{
  const snapshots = [
    snap("GOLD", "I", 95, "2026-01-01T00:00:00Z"),
    snap("PLATINUM", "IV", 10, "2026-01-01T00:20:00Z"),
  ];
  const result = correlateLpChanges(
    [{ matchId: "m1", gameEndTimestamp: new Date("2026-01-01T00:10:00Z").getTime() }],
    snapshots,
  );
  assertEqual(toObj(result), { m1: 15 }, "asciende de tier en el medio -> +15 LP, ya no se descarta");
}

// --- 3b. Cambio de división dentro del mismo tier -> mismo criterio (ej.
// del usuario: Oro II 27 LP -> Oro I 7 LP, un salto grande que podría ser
// un Aegis y antes quedaba invisible solo por cruzar de división) ---
{
  const snapshots = [
    snap("GOLD", "II", 27, "2026-01-01T00:00:00Z"),
    snap("GOLD", "I", 7, "2026-01-01T00:20:00Z"),
  ];
  const result = correlateLpChanges(
    [{ matchId: "m1", gameEndTimestamp: new Date("2026-01-01T00:10:00Z").getTime() }],
    snapshots,
  );
  assertEqual(toObj(result), { m1: 80 }, "asciende de división en el medio -> +80 LP reales, ya no se descarta");
}

// --- 4. Sin snapshot "antes" disponible -> se descarta ---
{
  const snapshots = [snap("GOLD", "II", 65, "2026-01-01T00:20:00Z")];
  const result = correlateLpChanges(
    [{ matchId: "m1", gameEndTimestamp: new Date("2026-01-01T00:10:00Z").getTime() }],
    snapshots,
  );
  assertEqual(toObj(result), {}, "sin snapshot anterior a la partida -> no se puede aislar");
}

// === correlateSingleMatchLp (el caso de Aegis: una sola partida nueva) ===

// --- 5. Caso normal: la corrida que detecta la partida es la misma que ve el LP nuevo ---
{
  const snapshots = [
    snap("GOLD", "II", 40, "2026-01-01T00:00:00Z"), // antes
    snap("GOLD", "II", 65, "2026-01-01T00:16:00Z"), // corrida que la detecta, LP ya actualizado
  ];
  const result = correlateSingleMatchLp({
    gameEndTimestamp: new Date("2026-01-01T00:10:00Z").getTime(),
    snapshots,
  });
  assertEqual(result.lpGained, 25, "caso normal: +25 LP aislados correctamente");
  assertEqual(
    result.priorSnapshots,
    [snapshots[0]],
    "caso normal: priorSnapshots excluye el snapshot posterior a la partida",
  );
}

// --- 6. EL CASO REPORTADO: match-v5 se atrasa varias corridas — el LP ya estaba en un snapshot VIEJO cuando por fin se detecta la partida ---
{
  const snapshots = [
    snap("GOLD", "II", 40, "2026-01-01T00:00:00Z"), // antes de la partida
    snap("GOLD", "II", 65, "2026-01-01T00:16:00Z"), // corrida N: LP ya actualizado, pero match-v5 todavía no la mostraba
    snap("GOLD", "II", 65, "2026-01-01T00:31:00Z"), // corrida N+1: nada nuevo jugado, LP sigue igual
    snap("GOLD", "II", 65, "2026-01-01T00:46:00Z"), // corrida N+2: AHORA SÍ aparece la partida en match-v5
  ];
  // Antes de este fix, el caller comparaba contra "el snapshot de la
  // corrida anterior" (el de 00:31, LP=65) contra el actual (LP=65) ->
  // delta 0, Aegis nunca se evaluaba pese a haber sido una subida real.
  const result = correlateSingleMatchLp({
    gameEndTimestamp: new Date("2026-01-01T00:10:00Z").getTime(),
    snapshots,
  });
  assertEqual(
    result.lpGained,
    25,
    "match-v5 atrasado varias corridas: el LP real (+25) se detecta igual, anclado a la hora de la partida",
  );
}

// --- 7. Sin snapshot "antes" -> null, sin explotar ---
{
  const snapshots = [snap("GOLD", "II", 65, "2026-01-01T00:20:00Z")];
  const result = correlateSingleMatchLp({
    gameEndTimestamp: new Date("2026-01-01T00:10:00Z").getTime(),
    snapshots,
  });
  assertEqual(result.lpGained, null, "sin snapshot anterior -> lpGained null");
  assertEqual(result.priorSnapshots, [], "sin snapshot anterior -> priorSnapshots vacío");
}

// --- 8. Cambio de tier en el medio -> ya no da null, se calcula vía calculateEloScore (esto es lo que ahora deja detectar un Aegis que cruza de tier/división) ---
{
  const snapshots = [
    snap("GOLD", "I", 95, "2026-01-01T00:00:00Z"),
    snap("PLATINUM", "IV", 10, "2026-01-01T00:20:00Z"),
  ];
  const result = correlateSingleMatchLp({
    gameEndTimestamp: new Date("2026-01-01T00:10:00Z").getTime(),
    snapshots,
  });
  assertEqual(result.lpGained, 15, "asciende de tier -> +15 LP reales, ya no null");
  assertEqual(
    result.priorSnapshots,
    [snapshots[0]],
    "asciende de tier: priorSnapshots igual excluye el snapshot posterior",
  );
}

function toObj(map) {
  return Object.fromEntries(map);
}

console.log(`\n${passed} pasaron, ${failed} fallaron`);
if (failed > 0) process.exit(1);

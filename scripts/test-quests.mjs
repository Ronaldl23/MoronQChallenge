// Test del motor de misiones del sistema de Mangos (src/lib/quests.ts), sin
// red ni base de datos — corre directo con Node (usa --experimental-strip-types
// para leer el .ts; los imports type-only se borran solos, no hace falta
// resolver el alias "@/").
//
//   node --experimental-strip-types scripts/test-quests.mjs
//
import {
  processNewMatches,
  calculateKda,
  QUEST_TARGETS,
  MAX_MANGO_INVENTORY,
  KDA_STREAK_THRESHOLD,
  MIN_MATCH_DURATION_SECONDS,
} from "../src/lib/quests.ts";

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

// Duración por defecto DELIBERADAMENTE por encima del mínimo (20 min) — los
// casos que testean el corte de remakes lo piden explícito (ver remake()).
const NORMAL_GAME_DURATION_SECONDS = 1200;

// KDA por defecto DELIBERADAMENTE bajo (< umbral) y muertes > 0 en ambos
// helpers, para que los casos de win_streak "puro" no completen kda_streak
// ni deathless_win de arrastre — los casos que necesitan buen KDA o 0
// muertes lo piden explícito (ver match()).
function win(id, kills = 3, deaths = 5, assists = 1) {
  return {
    matchId: id,
    win: true,
    kda: calculateKda({ kills, deaths, assists }),
    deaths,
    gameDurationSeconds: NORMAL_GAME_DURATION_SECONDS,
  };
}
function loss(id, kills = 1, deaths = 5, assists = 1) {
  return {
    matchId: id,
    win: false,
    kda: calculateKda({ kills, deaths, assists }),
    deaths,
    gameDurationSeconds: NORMAL_GAME_DURATION_SECONDS,
  };
}
function match(id, { win: w, kda, deaths = 1, gameDurationSeconds = NORMAL_GAME_DURATION_SECONDS }) {
  return { matchId: id, win: w, kda, deaths, gameDurationSeconds };
}
// Remake: gana o pierde da igual (0/0/0), lo único que importa es que dure
// menos que MIN_MATCH_DURATION_SECONDS — por defecto bien corto (3 min).
function remake(id, { win: w = true, kda = 0, deaths = 0, gameDurationSeconds = 180 } = {}) {
  return { matchId: id, win: w, kda, deaths, gameDurationSeconds };
}

const ZERO = { win_streak: 0, kda_streak: 0, deathless_win: 0 };

// --- 1. Racha de 5 victorias seguidas -> 1 mango, progreso vuelve a 0 ---
{
  const matches = ["m1", "m2", "m3", "m4", "m5"].map((id) => win(id));
  const result = processNewMatches({ progress: ZERO, matches, mangoCount: 0 });
  assertEqual(result.progress, ZERO, "5 wins: progreso resetea a 0");
  assertEqual(
    result.grants,
    [{ matchId: "m5", quest_type: "win_streak" }],
    "5 wins: se otorga exactamente 1 mango, en la 5ta partida",
  );
  assertEqual(result.mangoCount, 1, "5 wins: mangoCount sube a 1");
  assertEqual(result.lastProcessedMatchId, "m5", "5 wins: lastProcessedMatchId = m5");
}

// --- 2. Derrota a mitad de la racha corta el contador a 0 ---
{
  // W W W W L W W W W W -> la derrota en la 5ta corta; recién completa en la 10ma (5 wins reales seguidas: partidas 6-10)
  const seq = [win("a1"), win("a2"), win("a3"), win("a4"), loss("a5"), win("a6"), win("a7"), win("a8"), win("a9"), win("a10")];
  const result = processNewMatches({ progress: ZERO, matches: seq, mangoCount: 0 });
  assertEqual(
    result.grants,
    [{ matchId: "a10", quest_type: "win_streak" }],
    "W×4 + L + W×5: se otorga UNA sola vez, en a10 (no en a4, no antes)",
  );
  assertEqual(result.progress.win_streak, 0, "W×4 + L + W×5: win_streak vuelve a 0 tras el otorgamiento");
}

// --- 3. 4 wins y corta ahí (no llega a 5): sin mango, progreso = 4 ---
{
  const seq = [win("b1"), win("b2"), win("b3"), win("b4")];
  const result = processNewMatches({ progress: ZERO, matches: seq, mangoCount: 0 });
  assertEqual(result.grants, [], "4 wins: todavía no se otorga nada");
  assertEqual(result.progress.win_streak, 4, "4 wins: progreso queda en 4, esperando la 5ta");
}

// --- 4. 5 partidas con KDA >= 5 (umbral nuevo), resultado mixto (no importa ganar o perder) ---
{
  const seq = [
    match("k1", { win: true, kda: 6 }),
    match("k2", { win: false, kda: 5 }), // exactamente el nuevo umbral: cuenta
    match("k3", { win: true, kda: 10 }),
    match("k4", { win: false, kda: 5.5 }),
    match("k5", { win: true, kda: 5 }),
  ];
  const result = processNewMatches({ progress: ZERO, matches: seq, mangoCount: 0 });
  assertEqual(
    result.grants,
    [{ matchId: "k5", quest_type: "kda_streak" }],
    "5 partidas con KDA>=5 (resultado mixto): otorga mango de kda_streak en k5",
  );
  assertEqual(KDA_STREAK_THRESHOLD, 5, "el umbral de kda_streak es 5 (antes 4)");
}

// --- 5. Ya NO es una racha consecutiva: una partida con KDA < 5 en el medio NO corta el contador, solo no lo avanza ---
// (win/loss alternados a propósito para que win_streak nunca se acerque a 5
// y no contamine el resultado — este caso testea SOLO kda_streak).
{
  const seq = [
    match("c1", { win: true, kda: 5 }), // cuenta -> 1
    match("c2", { win: false, kda: 5 }), // cuenta -> 2
    match("c3", { win: true, kda: 4.9 }), // NO cumple — pero ya no corta nada, se ignora
    match("c4", { win: false, kda: 5 }), // cuenta -> 3
    match("c5", { win: true, kda: 5 }), // cuenta -> 4
    match("c6", { win: false, kda: 5 }), // cuenta -> 5, se completa acá
  ];
  const result = processNewMatches({ progress: ZERO, matches: seq, mangoCount: 0 });
  assertEqual(
    result.grants,
    [{ matchId: "c6", quest_type: "kda_streak" }],
    "KDA<5 en el medio (c3) ya no corta el contador — se completa en c6 con las 5 partidas que sí cumplieron (c1,c2,c4,c5,c6)",
  );
}

// --- 6. win_streak y kda_streak avanzan independientemente en la misma secuencia ---
{
  // Wins con KDA bajo: avanza win_streak pero no kda_streak.
  const seq = [win("d1", 3, 5, 1), win("d2", 3, 5, 1), win("d3", 3, 5, 1), win("d4", 3, 5, 1), win("d5", 3, 5, 1)];
  const result = processNewMatches({ progress: ZERO, matches: seq, mangoCount: 0 });
  assertEqual(
    result.grants,
    [{ matchId: "d5", quest_type: "win_streak" }],
    "wins con KDA bajo: solo se otorga el mango de win_streak, no el de kda_streak",
  );
  assertEqual(result.progress.kda_streak, 0, "wins con KDA bajo: kda_streak nunca avanzó (KDA=0.8 < 4)");
}

// --- 7. Ambas quests se completan en la MISMA partida: 2 grants para ese matchId ---
{
  // win=true Y kda alto en cada partida -> ambas rachas avanzan juntas.
  const seq = [1, 2, 3, 4, 5].map((n) => match(`e${n}`, { win: true, kda: 15 }));
  const result = processNewMatches({ progress: ZERO, matches: seq, mangoCount: 0 });
  assertEqual(
    result.grants,
    [
      { matchId: "e5", quest_type: "win_streak" },
      { matchId: "e5", quest_type: "kda_streak" },
    ],
    "5 wins con KDA alto: se completan las dos quests en la misma partida, 2 mangos otorgados",
  );
  assertEqual(result.mangoCount, 2, "ambas quests completas: mangoCount sube en 2");
}

// --- 8. CASO LÍMITE: ya tiene 3 mangos (cupo lleno) -> no se otorga, progreso queda pegado en el target ---
{
  const seq = [win("f1"), win("f2"), win("f3"), win("f4"), win("f5"), win("f6")]; // 6 wins seguidas, cupo lleno todo el tiempo
  const result = processNewMatches({ progress: ZERO, matches: seq, mangoCount: MAX_MANGO_INVENTORY });
  assertEqual(result.grants.filter((g) => g.quest_type === "win_streak"), [], "cupo lleno: no se otorga ningún mango de win_streak");
  assertEqual(
    result.progress.win_streak,
    QUEST_TARGETS.win_streak,
    "cupo lleno: win_streak queda pegado en el target (5), ni resetea ni sigue subiendo con la 6ta victoria",
  );
  assertEqual(result.mangoCount, MAX_MANGO_INVENTORY, "cupo lleno: mangoCount no cambia");
}

// --- 9. CASO LÍMITE: cupo lleno y llega una DERROTA -> el progreso pegado en el target NO se resetea ---
{
  const seq = [win("g1"), win("g2"), win("g3"), win("g4"), win("g5"), loss("g6"), loss("g7")];
  const result = processNewMatches({ progress: ZERO, matches: seq, mangoCount: MAX_MANGO_INVENTORY });
  assertEqual(
    result.progress.win_streak,
    QUEST_TARGETS.win_streak,
    "cupo lleno + derrotas después: la racha ya cumplida no se pierde, sigue esperando cupo",
  );
}

// --- 10. Se libera cupo entre corridas (progreso ya en el target, sin partidas nuevas esta vez) -> se otorga al toque ---
{
  const stuckProgress = { win_streak: QUEST_TARGETS.win_streak, kda_streak: 0, deathless_win: 0 };
  const result = processNewMatches({ progress: stuckProgress, matches: [], mangoCount: MAX_MANGO_INVENTORY - 1 });
  assertEqual(
    result.grants,
    [{ matchId: null, quest_type: "win_streak" }],
    "se libera cupo sin partidas nuevas: se otorga el mango pendiente igual (matchId null, no hay partida asociada)",
  );
  assertEqual(result.progress.win_streak, 0, "se libera cupo: win_streak resetea a 0 tras otorgarse");
  assertEqual(result.mangoCount, MAX_MANGO_INVENTORY, "se libera cupo: mangoCount vuelve a estar lleno");
}

// --- 11. Sin partidas nuevas y sin nada pendiente: no pasa nada ---
{
  const result = processNewMatches({ progress: ZERO, matches: [], mangoCount: 1 });
  assertEqual(result, { progress: ZERO, grants: [], mangoCount: 1, lastProcessedMatchId: null }, "sin partidas nuevas: no-op total");
}

// --- 12. Racha larga con más de un ciclo completo en la misma corrida (backfill grande) ---
{
  const seq = Array.from({ length: 12 }, (_, i) => win(`h${i + 1}`)); // 12 wins seguidas -> 2 mangos completos (10) + progreso de 2 sobrando
  const result = processNewMatches({ progress: ZERO, matches: seq, mangoCount: 0 });
  assertEqual(
    result.grants,
    [
      { matchId: "h5", quest_type: "win_streak" },
      { matchId: "h10", quest_type: "win_streak" },
    ],
    "12 wins seguidas en una sola corrida: se otorgan 2 mangos (en h5 y h10)",
  );
  assertEqual(result.progress.win_streak, 2, "12 wins: quedan 2 wins de racha corriendo hacia el próximo mango");
  assertEqual(result.mangoCount, 2, "12 wins: mangoCount terminó en 2 (no llegó al tope)");
}

// --- 13. Racha larga que SÍ pega contra el tope de inventario a mitad de camino ---
{
  const seq = Array.from({ length: 20 }, (_, i) => win(`i${i + 1}`)); // 20 wins seguidas -> alcanzaría para 4 mangos, pero el tope es 3
  const result = processNewMatches({ progress: ZERO, matches: seq, mangoCount: 0 });
  assertEqual(
    result.grants.map((g) => g.matchId),
    ["i5", "i10", "i15"],
    "20 wins seguidas: se otorgan solo 3 mangos (i5, i10, i15) — el 4to (que caería en i20) se bloquea por el tope",
  );
  assertEqual(result.mangoCount, MAX_MANGO_INVENTORY, "20 wins: mangoCount tope en 3");
  assertEqual(
    result.progress.win_streak,
    QUEST_TARGETS.win_streak,
    "20 wins: tras i15 el tope ya está lleno, así que i16..i20 (5 wins más) dejan win_streak pegado en 5, no se pierden ni se resetean",
  );
}

// --- 14. Victoria con 0 muertes -> mango inmediato (target=1, no es racha) ---
{
  const seq = [match("j1", { win: true, kda: 10, deaths: 0 })];
  const result = processNewMatches({ progress: ZERO, matches: seq, mangoCount: 0 });
  assertEqual(
    result.grants,
    [{ matchId: "j1", quest_type: "deathless_win" }],
    "1 victoria con 0 muertes: se otorga el mango en esa misma partida",
  );
  assertEqual(result.progress.deathless_win, 0, "victoria sin morir: progreso vuelve a 0 tras otorgarse");
  assertEqual(result.mangoCount, 1, "victoria sin morir: mangoCount sube a 1");
}

// --- 15. Victoria CON muertes -> no cuenta, aunque el KDA sea altísimo ---
{
  const seq = [match("k1", { win: true, kda: 20, deaths: 1 })];
  const result = processNewMatches({ progress: ZERO, matches: seq, mangoCount: 0 });
  assertEqual(result.grants, [], "victoria con 1 muerte (KDA alto igual): no otorga deathless_win");
  assertEqual(result.progress.deathless_win, 0, "victoria con 1 muerte: progreso sigue en 0");
}

// --- 16. Derrota con 0 muertes -> no cuenta (hace falta GANAR, no alcanza con no morir) ---
{
  const seq = [match("l1", { win: false, kda: 10, deaths: 0 })];
  const result = processNewMatches({ progress: ZERO, matches: seq, mangoCount: 0 });
  assertEqual(result.grants, [], "derrota con 0 muertes: no otorga deathless_win, hace falta ganar");
  assertEqual(result.progress.deathless_win, 0, "derrota sin morir: progreso sigue en 0");
}

// --- 17. Varias victorias sin morir en la misma corrida -> un mango por cada una (no es racha, no hay que encadenarlas) ---
{
  const seq = [
    match("n1", { win: true, kda: 10, deaths: 0 }),
    win("n2"), // victoria normal, con muertes -> no interrumpe nada, deathless_win no es racha
    match("n3", { win: true, kda: 8, deaths: 0 }),
  ];
  const result = processNewMatches({ progress: ZERO, matches: seq, mangoCount: 0 });
  assertEqual(
    result.grants.filter((g) => g.quest_type === "deathless_win"),
    [
      { matchId: "n1", quest_type: "deathless_win" },
      { matchId: "n3", quest_type: "deathless_win" },
    ],
    "2 victorias sin morir en la misma corrida (con una partida normal en el medio): 2 mangos, uno por cada una",
  );
}

// --- 18. CASO LÍMITE: cupo lleno -> deathless_win también queda pegado en el target esperando espacio ---
{
  const seq = [
    match("o1", { win: true, kda: 10, deaths: 0 }),
    match("o2", { win: true, kda: 10, deaths: 0 }),
  ];
  const result = processNewMatches({ progress: ZERO, matches: seq, mangoCount: MAX_MANGO_INVENTORY });
  assertEqual(
    result.grants.filter((g) => g.quest_type === "deathless_win"),
    [],
    "cupo lleno: ninguna de las 2 victorias sin morir otorga mango",
  );
  assertEqual(
    result.progress.deathless_win,
    QUEST_TARGETS.deathless_win,
    "cupo lleno: deathless_win queda pegado en el target (1), esperando espacio como las otras dos quests",
  );
}

// --- 19. Una misma partida completa las TRES quests a la vez (5ta victoria de la racha, con KDA alto y 0 muertes) ---
{
  const seq = [
    match("p1", { win: true, kda: 10, deaths: 1 }),
    match("p2", { win: true, kda: 10, deaths: 1 }),
    match("p3", { win: true, kda: 10, deaths: 1 }),
    match("p4", { win: true, kda: 10, deaths: 1 }),
    match("p5", { win: true, kda: 10, deaths: 0 }), // completa win_streak, kda_streak Y deathless_win
  ];
  const result = processNewMatches({ progress: ZERO, matches: seq, mangoCount: 0 });
  assertEqual(
    result.grants,
    [
      { matchId: "p5", quest_type: "win_streak" },
      { matchId: "p5", quest_type: "kda_streak" },
      { matchId: "p5", quest_type: "deathless_win" },
    ],
    "p5 completa las 3 quests a la vez: 3 mangos otorgados en la misma partida",
  );
  assertEqual(result.mangoCount, 3, "3 quests completas a la vez: mangoCount sube en 3, justo al tope");
}

// --- 20. Remake en medio de una racha de victorias: se ignora por completo, no cuenta ni corta la racha ---
{
  const seq = [win("r1"), win("r2"), remake("r3", { win: false }), win("r4"), win("r5"), win("r6")];
  const result = processNewMatches({ progress: ZERO, matches: seq, mangoCount: 0 });
  assertEqual(
    result.grants,
    [{ matchId: "r6", quest_type: "win_streak" }],
    "remake en el medio de una racha de wins: se ignora — la racha real (r1,r2,r4,r5,r6) se completa en r6",
  );
}

// --- 21. Remake como última partida de la corrida: lastProcessedMatchId avanza igual (si no, se reprocesaría para siempre) ---
{
  const seq = [win("s1"), remake("s2")];
  const result = processNewMatches({ progress: ZERO, matches: seq, mangoCount: 0 });
  assertEqual(
    result.lastProcessedMatchId,
    "s2",
    "remake al final de la corrida: el cursor avanza hasta ahí igual",
  );
  assertEqual(result.progress.win_streak, 1, "remake al final: no resetea el progreso que ya había ganado s1");
}

// --- 22. Duración exactamente en el mínimo (300s): SÍ cuenta, no es remake (>=, no >) ---
{
  const seq = [match("t1", { win: true, kda: 10, gameDurationSeconds: MIN_MATCH_DURATION_SECONDS })];
  const result = processNewMatches({ progress: ZERO, matches: seq, mangoCount: 0 });
  assertEqual(result.progress.win_streak, 1, "duración == MIN_MATCH_DURATION_SECONDS: cuenta normal");
}

// --- 23. Un segundo menos que el mínimo: se ignora como remake ---
{
  const seq = [match("u1", { win: true, kda: 10, gameDurationSeconds: MIN_MATCH_DURATION_SECONDS - 1 })];
  const result = processNewMatches({ progress: ZERO, matches: seq, mangoCount: 0 });
  assertEqual(result.progress.win_streak, 0, "duración == MIN_MATCH_DURATION_SECONDS - 1: se ignora como remake");
}

assertEqual(MIN_MATCH_DURATION_SECONDS, 300, "MIN_MATCH_DURATION_SECONDS es 300 (5 minutos, regla confirmada por el usuario)");

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

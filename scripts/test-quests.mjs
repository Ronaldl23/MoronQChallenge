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
  MAX_MANGO_INVENTORY,
  MIN_MATCH_DURATION_SECONDS,
  MISSION_TIERS,
  tierForRank,
  questTargetsForTier,
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

// La mayoría de los tests que no son específicamente sobre categorías usan
// top1_3 a propósito: es la categoría con las reglas más estrictas
// (win requerido en high_kills y en deathless_win), así que un test que
// pasa ahí no está aprovechando ninguna relajación de una categoría más
// floja.
const TOP_TIER = "top1_3";

// Duración por defecto DELIBERADAMENTE por encima del mínimo (20 min) — los
// casos que testean el corte de remakes lo piden explícito (ver remake()).
const NORMAL_GAME_DURATION_SECONDS = 1200;

// kills/KDA/muertes por defecto DELIBERADAMENTE bajos (no alcanzan ningún
// umbral) para que los casos de win_streak "puro" no completen de arrastre
// ninguna otra quest — los casos que necesitan buen KDA, muchos kills o 0
// muertes lo piden explícito (ver match()). beatTrackedParticipant en false
// por defecto en los cuatro helpers — los casos de beat_participant lo
// piden explícito (ver beatWin()).
function win(id, kills = 2, deaths = 5, assists = 1) {
  return {
    matchId: id,
    win: true,
    kda: calculateKda({ kills, deaths, assists }),
    kills,
    deaths,
    gameDurationSeconds: NORMAL_GAME_DURATION_SECONDS,
    beatTrackedParticipant: false,
  };
}
function loss(id, kills = 1, deaths = 5, assists = 1) {
  return {
    matchId: id,
    win: false,
    kda: calculateKda({ kills, deaths, assists }),
    kills,
    deaths,
    gameDurationSeconds: NORMAL_GAME_DURATION_SECONDS,
    beatTrackedParticipant: false,
  };
}
function match(
  id,
  { win: w, kda = 0, kills = 0, deaths = 1, gameDurationSeconds = NORMAL_GAME_DURATION_SECONDS, beatTrackedParticipant = false },
) {
  return { matchId: id, win: w, kda, kills, deaths, gameDurationSeconds, beatTrackedParticipant };
}
// Remake: gana o pierde da igual (0/0/0), lo único que importa es que dure
// menos que MIN_MATCH_DURATION_SECONDS — por defecto bien corto (3 min).
function remake(id, { win: w = true, kda = 0, kills = 0, deaths = 0, gameDurationSeconds = 180 } = {}) {
  return { matchId: id, win: w, kda, kills, deaths, gameDurationSeconds, beatTrackedParticipant: false };
}
// Victoria contra al menos un participante registrado del lado rival.
function beatWin(id, kills = 2, deaths = 5, assists = 1) {
  return { ...win(id, kills, deaths, assists), beatTrackedParticipant: true };
}

const ZERO = { win_streak: 0, kda_streak: 0, deathless_win: 0, high_kills: 0, beat_participant: 0 };

function run(overrides) {
  return processNewMatches({ tier: TOP_TIER, ...overrides });
}

// --- 1. Racha de 5 victorias seguidas (top1_3) -> 1 mango, progreso vuelve a 0 ---
{
  const matches = ["m1", "m2", "m3", "m4", "m5"].map((id) => win(id));
  const result = run({ progress: ZERO, matches, mangoCount: 0 });
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
  const seq = [win("a1"), win("a2"), win("a3"), win("a4"), loss("a5"), win("a6"), win("a7"), win("a8"), win("a9"), win("a10")];
  const result = run({ progress: ZERO, matches: seq, mangoCount: 0 });
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
  const result = run({ progress: ZERO, matches: seq, mangoCount: 0 });
  assertEqual(result.grants, [], "4 wins: todavía no se otorga nada");
  assertEqual(result.progress.win_streak, 4, "4 wins: progreso queda en 4, esperando la 5ta");
}

// --- 4. kda_streak: acumular kdaGames partidas con KDA >= el umbral de la categoría, resultado mixto (no importa ganar o perder) ---
{
  const seq = [
    match("k1", { win: true, kda: 8 }),
    match("k2", { win: false, kda: 6 }), // exactamente el umbral de top1_3: cuenta
    match("k3", { win: true, kda: 12 }),
    match("k4", { win: false, kda: 6.5 }),
    match("k5", { win: true, kda: 6 }),
  ];
  const result = run({ progress: ZERO, matches: seq, mangoCount: 0 });
  assertEqual(
    result.grants,
    [{ matchId: "k5", quest_type: "kda_streak" }],
    "top1_3: 5 partidas con KDA>=6 (resultado mixto) otorgan kda_streak en la 5ta",
  );
  assertEqual(MISSION_TIERS.top1_3.kdaGames, 5, "top1_3: 5 partidas necesarias para kda_streak");
  assertEqual(MISSION_TIERS.top1_3.kdaThreshold, 6, "top1_3: umbral de KDA es 6");
}

// --- 5. kda_streak NO es una racha consecutiva: una partida bajo el umbral en el medio no corta el contador, solo no lo avanza ---
{
  const seq = [
    match("c1", { win: true, kda: 6 }), // cuenta -> 1
    match("c2", { win: false, kda: 6 }), // cuenta -> 2
    match("c3", { win: true, kda: 5.9 }), // NO cumple — se ignora, no corta
    match("c4", { win: false, kda: 6 }), // cuenta -> 3
    match("c5", { win: true, kda: 6 }), // cuenta -> 4
    match("c6", { win: false, kda: 6 }), // cuenta -> 5, se completa acá
  ];
  const result = run({ progress: ZERO, matches: seq, mangoCount: 0 });
  assertEqual(
    result.grants,
    [{ matchId: "c6", quest_type: "kda_streak" }],
    "KDA bajo el umbral en el medio (c3) no corta el contador — se completa en c6 con las 5 que sí cumplieron",
  );
}

// --- 6. win_streak y kda_streak avanzan independientemente en la misma secuencia ---
{
  const seq = [win("d1"), win("d2"), win("d3"), win("d4"), win("d5")]; // KDA bajo por defecto (helper win())
  const result = run({ progress: ZERO, matches: seq, mangoCount: 0 });
  assertEqual(
    result.grants,
    [{ matchId: "d5", quest_type: "win_streak" }],
    "wins con KDA bajo: solo se otorga el mango de win_streak, no el de kda_streak",
  );
  assertEqual(result.progress.kda_streak, 0, "wins con KDA bajo: kda_streak nunca avanzó");
}

// --- 7. Varias quests se completan en la MISMA corrida, cada una en su propia partida ---
{
  const seq = [1, 2, 3, 4, 5].map((n) => match(`e${n}`, { win: true, kda: 20 }));
  const result = run({ progress: ZERO, matches: seq, mangoCount: 0 });
  assertEqual(
    result.grants,
    [
      { matchId: "e5", quest_type: "win_streak" },
      { matchId: "e5", quest_type: "kda_streak" },
    ],
    "5 wins con KDA alto: win_streak Y kda_streak se completan juntas en la 5ta (ambas piden 5 partidas en top1_3)",
  );
  assertEqual(result.mangoCount, 2, "ambas quests completas: mangoCount sube en 2");
}

// --- 8. CASO LÍMITE: ya tiene 3 mangos (cupo lleno) -> la misión se completa igual, pero el mango se pierde y el progreso vuelve a 0 ---
{
  const seq = [win("f1"), win("f2"), win("f3"), win("f4"), win("f5"), win("f6")];
  const result = run({ progress: ZERO, matches: seq, mangoCount: MAX_MANGO_INVENTORY });
  assertEqual(result.grants.filter((g) => g.quest_type === "win_streak"), [], "cupo lleno: no se otorga ningún mango de win_streak, se pierde");
  assertEqual(
    result.progress.win_streak,
    1,
    "cupo lleno: win_streak se completa en f5 y resetea a 0 igual (mango perdido) — f6 ya es la 1ra de la próxima racha",
  );
  assertEqual(result.mangoCount, MAX_MANGO_INVENTORY, "cupo lleno: mangoCount no cambia");
}

// --- 9. Red de seguridad: progreso YA en el target (dato viejo) se resuelve apenas arranca ---
{
  const stuckProgress = { ...ZERO, win_streak: questTargetsForTier(TOP_TIER).win_streak };
  const result = run({ progress: stuckProgress, matches: [], mangoCount: MAX_MANGO_INVENTORY - 1 });
  assertEqual(
    result.grants,
    [{ matchId: null, quest_type: "win_streak" }],
    "progreso viejo ya en el target, con cupo libre: se otorga el mango al toque (matchId null)",
  );
  assertEqual(result.progress.win_streak, 0, "progreso viejo resuelto: win_streak resetea a 0");
}

// --- 10. Sin partidas nuevas y sin nada pendiente: no pasa nada ---
{
  const result = run({ progress: ZERO, matches: [], mangoCount: 1 });
  assertEqual(result, { progress: ZERO, grants: [], mangoCount: 1, lastProcessedMatchId: null }, "sin partidas nuevas: no-op total");
}

// --- 11. Racha larga que pega contra el tope de inventario a mitad de camino ---
{
  const seq = Array.from({ length: 20 }, (_, i) => win(`i${i + 1}`)); // 20 wins seguidas -> alcanzaría para 4 mangos, tope es 3
  const result = run({ progress: ZERO, matches: seq, mangoCount: 0 });
  assertEqual(
    result.grants.map((g) => g.matchId),
    ["i5", "i10", "i15"],
    "20 wins seguidas: se otorgan solo 3 mangos — el 4to (i20) se pierde por el tope",
  );
  assertEqual(result.mangoCount, MAX_MANGO_INVENTORY, "20 wins: mangoCount tope en 3");
}

// --- 12. Remake en medio de una racha: se ignora por completo ---
{
  const seq = [win("r1"), win("r2"), remake("r3", { win: false }), win("r4"), win("r5"), win("r6")];
  const result = run({ progress: ZERO, matches: seq, mangoCount: 0 });
  assertEqual(
    result.grants,
    [{ matchId: "r6", quest_type: "win_streak" }],
    "remake en el medio de una racha de wins: se ignora — la racha real (r1,r2,r4,r5,r6) se completa en r6",
  );
}

// --- 13. Duración exactamente en el mínimo (240s) SÍ cuenta; un segundo menos es remake ---
{
  const okDuration = run({
    progress: ZERO,
    matches: [match("t1", { win: true, gameDurationSeconds: MIN_MATCH_DURATION_SECONDS })],
    mangoCount: 0,
  });
  assertEqual(okDuration.progress.win_streak, 1, "duración == MIN_MATCH_DURATION_SECONDS: cuenta normal");

  const remakeDuration = run({
    progress: ZERO,
    matches: [match("u1", { win: true, gameDurationSeconds: MIN_MATCH_DURATION_SECONDS - 1 })],
    mangoCount: 0,
  });
  assertEqual(remakeDuration.progress.win_streak, 0, "duración == MIN_MATCH_DURATION_SECONDS - 1: se ignora como remake");
}

// ============================================================
// deathless_win: varía por categoría (target, muertes tope, si exige ganar)
// ============================================================

// --- 14. top1_3: exige GANAR y 0 muertes exactas (target=1) ---
{
  const winNoDeaths = processNewMatches({
    tier: "top1_3",
    progress: ZERO,
    matches: [match("j1", { win: true, deaths: 0 })],
    mangoCount: 0,
  });
  assertEqual(
    winNoDeaths.grants,
    [{ matchId: "j1", quest_type: "deathless_win" }],
    "top1_3: victoria con 0 muertes otorga deathless_win",
  );

  const lossNoDeaths = processNewMatches({
    tier: "top1_3",
    progress: ZERO,
    matches: [match("j2", { win: false, deaths: 0 })],
    mangoCount: 0,
  });
  assertEqual(
    lossNoDeaths.grants,
    [],
    "top1_3: DERROTA con 0 muertes no alcanza — esta categoría exige ganar",
  );
}

// --- 15. top4_10: 0 muertes alcanza SIN necesidad de ganar ---
{
  const result = processNewMatches({
    tier: "top4_10",
    progress: ZERO,
    matches: [match("k1", { win: false, deaths: 0 })],
    mangoCount: 0,
  });
  assertEqual(
    result.grants,
    [{ matchId: "k1", quest_type: "deathless_win" }],
    "top4_10: derrota con 0 muertes SÍ otorga deathless_win — no exige ganar",
  );
}

// --- 16. Cualquier categoría con target=1: una muerte ya descalifica esa partida ---
{
  const result = processNewMatches({
    tier: "top4_10",
    progress: ZERO,
    matches: [match("l1", { win: true, deaths: 1 })],
    mangoCount: 0,
  });
  assertEqual(result.grants, [], "1 muerte: no otorga deathless_win, hace falta 0 muertes exactas");
}

// --- 17. top21_plus: 3 partidas (no necesariamente seguidas) con MENOS de 3 muertes, sin exigir ganar ---
{
  const seq = [
    match("n1", { win: false, deaths: 2 }), // cuenta -> 1
    match("n2", { win: true, deaths: 5 }), // NO cumple (5 muertes) — se ignora, no corta
    match("n3", { win: false, deaths: 0 }), // cuenta -> 2
    match("n4", { win: true, deaths: 2 }), // cuenta -> 3, se completa acá
  ];
  const result = processNewMatches({ tier: "top21_plus", progress: ZERO, matches: seq, mangoCount: 0 });
  assertEqual(
    result.grants,
    [{ matchId: "n4", quest_type: "deathless_win" }],
    "top21_plus: 3 partidas con menos de 3 muertes (n1,n3,n4) completan deathless_win en n4, sin exigir ganar ninguna",
  );
  assertEqual(MISSION_TIERS.top21_plus.lowDeathsGames, 3, "top21_plus: 3 partidas necesarias");
  assertEqual(MISSION_TIERS.top21_plus.lowDeathsMaxDeaths, 3, "top21_plus: tope de muertes es 3 (deaths < 3)");
}

// ============================================================
// high_kills: partida puntual con N+ kills — varía por categoría
// ============================================================

// --- 18. top1_3: exige GANAR y 20+ kills ---
{
  const winHighKills = processNewMatches({
    tier: "top1_3",
    progress: ZERO,
    matches: [match("p1", { win: true, kills: 20 })],
    mangoCount: 0,
  });
  assertEqual(
    winHighKills.grants,
    [{ matchId: "p1", quest_type: "high_kills" }],
    "top1_3: victoria con exactamente 20 kills otorga high_kills",
  );

  const lossHighKills = processNewMatches({
    tier: "top1_3",
    progress: ZERO,
    matches: [match("p2", { win: false, kills: 25 })],
    mangoCount: 0,
  });
  assertEqual(lossHighKills.grants, [], "top1_3: DERROTA con muchos kills no alcanza — esta categoría exige ganar");
}

// --- 19. top11_20: 15+ kills alcanza SIN necesidad de ganar, con umbral más bajo ---
{
  const result = processNewMatches({
    tier: "top11_20",
    progress: ZERO,
    matches: [match("q1", { win: false, kills: 15 })],
    mangoCount: 0,
  });
  assertEqual(
    result.grants,
    [{ matchId: "q1", quest_type: "high_kills" }],
    "top11_20: derrota con 15 kills SÍ otorga high_kills — no exige ganar, umbral más bajo",
  );
}

// --- 20. Un kill menos del umbral no alcanza ---
{
  const result = processNewMatches({
    tier: "top21_plus",
    progress: ZERO,
    matches: [match("s1", { win: true, kills: 9 })], // umbral top21_plus es 10
    mangoCount: 0,
  });
  assertEqual(result.grants, [], "9 kills contra un umbral de 10: no alcanza");
}

// ============================================================
// beat_participant: sin cambios por categoría
// ============================================================

// --- 21. Victoria contra un participante registrado -> mango inmediato, igual en cualquier categoría ---
{
  const result = processNewMatches({ tier: "top21_plus", progress: ZERO, matches: [beatWin("v1")], mangoCount: 0 });
  assertEqual(
    result.grants,
    [{ matchId: "v1", quest_type: "beat_participant" }],
    "beat_participant: victoria contra un participante registrado otorga el mango, sin cambios por categoría",
  );
}

// --- 22. Derrota contra un participante registrado -> no cuenta (hace falta GANAR) ---
{
  const result = run({ progress: ZERO, matches: [{ ...loss("v2"), beatTrackedParticipant: true }], mangoCount: 0 });
  assertEqual(result.grants, [], "derrota contra un participante registrado: no otorga beat_participant, hace falta ganar");
}

// ============================================================
// Categorías: límites y targets
// ============================================================

// --- 23. tierForRank: límites de las cuatro categorías ---
{
  assertEqual(tierForRank(1), "top1_3", "rank 1 -> top1_3");
  assertEqual(tierForRank(3), "top1_3", "rank 3 -> top1_3 (límite inclusive)");
  assertEqual(tierForRank(4), "top4_10", "rank 4 -> top4_10 (justo pasado el límite)");
  assertEqual(tierForRank(10), "top4_10", "rank 10 -> top4_10 (límite inclusive)");
  assertEqual(tierForRank(11), "top11_20", "rank 11 -> top11_20");
  assertEqual(tierForRank(20), "top11_20", "rank 20 -> top11_20 (límite inclusive)");
  assertEqual(tierForRank(21), "top21_plus", "rank 21 -> top21_plus");
  assertEqual(tierForRank(500), "top21_plus", "rank alto (roster grande): top21_plus igual, sin techo");
  assertEqual(tierForRank(null), "top21_plus", "sin rango todavía (en placements): la categoría más floja");
}

// --- 24. questTargetsForTier: targets efectivos de cada categoría (regla confirmada por el usuario) ---
{
  assertEqual(
    questTargetsForTier("top1_3"),
    { win_streak: 5, kda_streak: 5, deathless_win: 1, high_kills: 1, beat_participant: 1 },
    "top1_3: 5 wins seguidas, 5 partidas KDA>=6, deathless target=1, high_kills target=1",
  );
  assertEqual(
    questTargetsForTier("top4_10"),
    { win_streak: 5, kda_streak: 5, deathless_win: 1, high_kills: 1, beat_participant: 1 },
    "top4_10: mismos targets numéricos que top1_3 (solo cambian los umbrales/requisito de ganar)",
  );
  assertEqual(
    questTargetsForTier("top11_20"),
    { win_streak: 4, kda_streak: 4, deathless_win: 1, high_kills: 1, beat_participant: 1 },
    "top11_20: 4 wins seguidas, 4 partidas KDA>=4",
  );
  assertEqual(
    questTargetsForTier("top21_plus"),
    { win_streak: 3, kda_streak: 3, deathless_win: 3, high_kills: 1, beat_participant: 1 },
    "top21_plus: 3 wins seguidas, 3 partidas KDA>=3, deathless_win pasa a target=3 (3 partidas con menos de 3 muertes)",
  );
}

// --- 25. Misma secuencia de wins, distinto resultado según categoría (win_streak más floja en tiers bajos) ---
{
  const seq = [win("w1"), win("w2"), win("w3")]; // 3 wins seguidas
  const bottom = processNewMatches({ progress: ZERO, matches: seq, mangoCount: 0, tier: "top21_plus" });
  assertEqual(bottom.grants, [{ matchId: "w3", quest_type: "win_streak" }], "top21_plus: 3 wins seguidas ya completan win_streak (target=3)");

  const top = processNewMatches({ progress: ZERO, matches: seq, mangoCount: 0, tier: "top1_3" });
  assertEqual(top.grants, [], "top1_3: las mismas 3 wins seguidas NO alcanzan (target=5)");
  assertEqual(top.progress.win_streak, 3, "top1_3: progreso queda en 3/5, esperando 2 más");
}

assertEqual(MIN_MATCH_DURATION_SECONDS, 240, "MIN_MATCH_DURATION_SECONDS es 240 (4 minutos, regla confirmada por el usuario)");

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

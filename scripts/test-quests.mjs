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
  KDA_STREAK_GAMES,
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
// top1_10 a propósito: mantiene los números "clásicos" (win_streak=5,
// umbral de KDA=5) que ya tenía el motor antes de las categorías.
const TOP_TIER = "top1_10";

// Duración por defecto DELIBERADAMENTE por encima del mínimo (20 min) — los
// casos que testean el corte de remakes lo piden explícito (ver remake()).
const NORMAL_GAME_DURATION_SECONDS = 1200;

// KDA por defecto DELIBERADAMENTE bajo (< umbral) y muertes > 0 en ambos
// helpers, para que los casos de win_streak "puro" no completen kda_streak
// ni deathless_win de arrastre — los casos que necesitan buen KDA o 0
// muertes lo piden explícito (ver match()).
// beatTrackedParticipant en false por defecto en los cuatro helpers — los
// casos que testean beat_participant lo piden explícito (ver beatWin()).
function win(id, kills = 3, deaths = 5, assists = 1) {
  return {
    matchId: id,
    win: true,
    kda: calculateKda({ kills, deaths, assists }),
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
    deaths,
    gameDurationSeconds: NORMAL_GAME_DURATION_SECONDS,
    beatTrackedParticipant: false,
  };
}
function match(id, { win: w, kda, deaths = 1, gameDurationSeconds = NORMAL_GAME_DURATION_SECONDS, beatTrackedParticipant = false }) {
  return { matchId: id, win: w, kda, deaths, gameDurationSeconds, beatTrackedParticipant };
}
// Remake: gana o pierde da igual (0/0/0), lo único que importa es que dure
// menos que MIN_MATCH_DURATION_SECONDS — por defecto bien corto (3 min).
function remake(id, { win: w = true, kda = 0, deaths = 0, gameDurationSeconds = 180 } = {}) {
  return { matchId: id, win: w, kda, deaths, gameDurationSeconds, beatTrackedParticipant: false };
}
// Victoria contra al menos un participante registrado del lado rival.
function beatWin(id, kills = 3, deaths = 5, assists = 1) {
  return { ...win(id, kills, deaths, assists), beatTrackedParticipant: true };
}

const ZERO = { win_streak: 0, kda_streak: 0, deathless_win: 0, beat_participant: 0 };

function run(overrides) {
  return processNewMatches({ tier: TOP_TIER, ...overrides });
}

// --- 1. Racha de 5 victorias seguidas -> 1 mango, progreso vuelve a 0 ---
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
  // W W W W L W W W W W -> la derrota en la 5ta corta; recién completa en la 10ma (5 wins reales seguidas: partidas 6-10)
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

// --- 4. KDA_STREAK_GAMES (3) partidas con KDA >= el umbral de la categoría, resultado mixto (no importa ganar o perder) ---
{
  const seq = [
    match("k1", { win: true, kda: 6 }),
    match("k2", { win: false, kda: 5 }), // exactamente el umbral de top1_10: cuenta
    match("k3", { win: true, kda: 10 }),
  ];
  const result = run({ progress: ZERO, matches: seq, mangoCount: 0 });
  assertEqual(
    result.grants,
    [{ matchId: "k3", quest_type: "kda_streak" }],
    "3 partidas con KDA>=5 (resultado mixto): otorga mango de kda_streak en la 3ra",
  );
  assertEqual(KDA_STREAK_GAMES, 3, "KDA_STREAK_GAMES es 3 (fijo en las tres categorías)");
  assertEqual(MISSION_TIERS.top1_10.kdaThreshold, 5, "top1_10: umbral de KDA es 5");
}

// --- 5. Ya NO es una racha consecutiva: una partida con KDA bajo el umbral en el medio NO corta el contador, solo no lo avanza ---
// (win/loss alternados a propósito para que win_streak nunca se acerque a 5
// y no contamine el resultado — este caso testea SOLO kda_streak).
{
  const seq = [
    match("c1", { win: true, kda: 5 }), // cuenta -> 1
    match("c2", { win: false, kda: 4.9 }), // NO cumple — pero ya no corta nada, se ignora
    match("c3", { win: true, kda: 5 }), // cuenta -> 2
    match("c4", { win: false, kda: 5 }), // cuenta -> 3, se completa acá
  ];
  const result = run({ progress: ZERO, matches: seq, mangoCount: 0 });
  assertEqual(
    result.grants,
    [{ matchId: "c4", quest_type: "kda_streak" }],
    "KDA bajo el umbral en el medio (c2) ya no corta el contador — se completa en c4 con las 3 partidas que sí cumplieron (c1,c3,c4)",
  );
}

// --- 6. win_streak y kda_streak avanzan independientemente en la misma secuencia ---
{
  // Wins con KDA bajo: avanza win_streak pero no kda_streak.
  const seq = [win("d1", 3, 5, 1), win("d2", 3, 5, 1), win("d3", 3, 5, 1), win("d4", 3, 5, 1), win("d5", 3, 5, 1)];
  const result = run({ progress: ZERO, matches: seq, mangoCount: 0 });
  assertEqual(
    result.grants,
    [{ matchId: "d5", quest_type: "win_streak" }],
    "wins con KDA bajo: solo se otorga el mango de win_streak, no el de kda_streak",
  );
  assertEqual(result.progress.kda_streak, 0, "wins con KDA bajo: kda_streak nunca avanzó (KDA=0.8 < 5)");
}

// --- 7. Ambas quests se completan en la MISMA partida: 2 grants para ese matchId ---
{
  // win=true Y kda alto en cada partida -> ambas rachas avanzan juntas, kda_streak llega primero (3 partidas) que win_streak (5).
  const seq = [1, 2, 3, 4, 5].map((n) => match(`e${n}`, { win: true, kda: 15 }));
  const result = run({ progress: ZERO, matches: seq, mangoCount: 0 });
  assertEqual(
    result.grants,
    [
      { matchId: "e3", quest_type: "kda_streak" },
      { matchId: "e5", quest_type: "win_streak" },
    ],
    "5 wins con KDA alto: kda_streak se completa en e3 (3 partidas), win_streak en e5 (5 partidas) — 2 mangos otorgados",
  );
  assertEqual(result.mangoCount, 2, "ambas quests completas: mangoCount sube en 2");
}

// --- 8. CASO LÍMITE: ya tiene 3 mangos (cupo lleno) -> la misión se completa igual, pero el mango se pierde y el progreso vuelve a 0 (confirmado por el usuario: sin cupo en el momento exacto, no hay segunda oportunidad) ---
{
  const seq = [win("f1"), win("f2"), win("f3"), win("f4"), win("f5"), win("f6")]; // 6 wins seguidas, cupo lleno todo el tiempo
  const result = run({ progress: ZERO, matches: seq, mangoCount: MAX_MANGO_INVENTORY });
  assertEqual(result.grants.filter((g) => g.quest_type === "win_streak"), [], "cupo lleno: no se otorga ningún mango de win_streak, se pierde");
  assertEqual(
    result.progress.win_streak,
    1,
    "cupo lleno: win_streak se completa en f5 y resetea a 0 igual (mango perdido) — la 6ta victoria (f6) ya es la 1ra de la próxima racha",
  );
  assertEqual(result.mangoCount, MAX_MANGO_INVENTORY, "cupo lleno: mangoCount no cambia (nunca se otorgó nada)");
}

// --- 9. CASO LÍMITE: cupo lleno -> la racha se completa y se pierde en el momento, no queda "pegada" esperando nada ---
{
  const seq = [win("g1"), win("g2"), win("g3"), win("g4"), win("g5"), loss("g6"), loss("g7")];
  const result = run({ progress: ZERO, matches: seq, mangoCount: MAX_MANGO_INVENTORY });
  assertEqual(
    result.progress.win_streak,
    0,
    "cupo lleno: la racha se completa y se pierde en g5 (resetea a 0 ahí mismo) — las derrotas después no tienen nada que cortar",
  );
  assertEqual(result.grants.filter((g) => g.quest_type === "win_streak"), [], "cupo lleno: nunca se otorgó el mango de win_streak");
}

// --- 10. Red de seguridad: si llega un progreso YA en el target (dato viejo, de antes de que el mango se pierda al instante en vez de quedar pendiente), lo resuelve apenas arranca en vez de dejarlo pegado para siempre ---
{
  const stuckProgress = { win_streak: questTargetsForTier(TOP_TIER).win_streak, kda_streak: 0, deathless_win: 0, beat_participant: 0 };
  const result = run({ progress: stuckProgress, matches: [], mangoCount: MAX_MANGO_INVENTORY - 1 });
  assertEqual(
    result.grants,
    [{ matchId: null, quest_type: "win_streak" }],
    "progreso viejo ya en el target, con cupo libre: se otorga el mango al toque (matchId null, no hay partida asociada)",
  );
  assertEqual(result.progress.win_streak, 0, "progreso viejo resuelto: win_streak resetea a 0 tras otorgarse");
  assertEqual(result.mangoCount, MAX_MANGO_INVENTORY, "progreso viejo resuelto: mangoCount vuelve a estar lleno");
}

// --- 11. Sin partidas nuevas y sin nada pendiente: no pasa nada ---
{
  const result = run({ progress: ZERO, matches: [], mangoCount: 1 });
  assertEqual(result, { progress: ZERO, grants: [], mangoCount: 1, lastProcessedMatchId: null }, "sin partidas nuevas: no-op total");
}

// --- 12. Racha larga con más de un ciclo completo en la misma corrida (backfill grande) ---
{
  const seq = Array.from({ length: 12 }, (_, i) => win(`h${i + 1}`)); // 12 wins seguidas -> 2 mangos completos (10) + progreso de 2 sobrando
  const result = run({ progress: ZERO, matches: seq, mangoCount: 0 });
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
  const result = run({ progress: ZERO, matches: seq, mangoCount: 0 });
  assertEqual(
    result.grants.map((g) => g.matchId),
    ["i5", "i10", "i15"],
    "20 wins seguidas: se otorgan solo 3 mangos (i5, i10, i15) — el 4to (que se completaría en i20) se pierde por el tope",
  );
  assertEqual(result.mangoCount, MAX_MANGO_INVENTORY, "20 wins: mangoCount tope en 3");
  assertEqual(
    result.progress.win_streak,
    0,
    "20 wins: la 4ta racha (i16..i20) también se completa y resetea a 0 en i20, aunque el mango se pierda por no haber cupo",
  );
}

// --- 14. Victoria con 0 muertes -> mango inmediato (target=1, no es racha) ---
{
  const seq = [match("j1", { win: true, kda: 10, deaths: 0 })];
  const result = run({ progress: ZERO, matches: seq, mangoCount: 0 });
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
  const result = run({ progress: ZERO, matches: seq, mangoCount: 0 });
  assertEqual(result.grants, [], "victoria con 1 muerte (KDA alto igual): no otorga deathless_win");
  assertEqual(result.progress.deathless_win, 0, "victoria con 1 muerte: progreso sigue en 0");
}

// --- 16. Derrota con 0 muertes -> no cuenta (hace falta GANAR, no alcanza con no morir) ---
{
  const seq = [match("l1", { win: false, kda: 10, deaths: 0 })];
  const result = run({ progress: ZERO, matches: seq, mangoCount: 0 });
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
  const result = run({ progress: ZERO, matches: seq, mangoCount: 0 });
  assertEqual(
    result.grants.filter((g) => g.quest_type === "deathless_win"),
    [
      { matchId: "n1", quest_type: "deathless_win" },
      { matchId: "n3", quest_type: "deathless_win" },
    ],
    "2 victorias sin morir en la misma corrida (con una partida normal en el medio): 2 mangos, uno por cada una",
  );
}

// --- 18. CASO LÍMITE: cupo lleno -> deathless_win se completa y se pierde cada vez, sin quedar pegada ---
{
  const seq = [
    match("o1", { win: true, kda: 10, deaths: 0 }),
    match("o2", { win: true, kda: 10, deaths: 0 }),
  ];
  const result = run({ progress: ZERO, matches: seq, mangoCount: MAX_MANGO_INVENTORY });
  assertEqual(
    result.grants.filter((g) => g.quest_type === "deathless_win"),
    [],
    "cupo lleno: ninguna de las 2 victorias sin morir otorga mango, se pierden las dos",
  );
  assertEqual(
    result.progress.deathless_win,
    0,
    "cupo lleno: deathless_win resetea a 0 en cada una (no es racha, se completa y se pierde de nuevo en o2)",
  );
}

// --- 19. Una misma partida completa las TRES quests a la vez (3ra de kda_streak, con victoria y 0 muertes) ---
{
  const seq = [
    match("p1", { win: true, kda: 10, deaths: 1 }),
    match("p2", { win: true, kda: 10, deaths: 1 }),
    match("p3", { win: true, kda: 10, deaths: 0 }), // completa kda_streak (3ra) Y deathless_win
  ];
  const result = run({ progress: ZERO, matches: seq, mangoCount: 0 });
  assertEqual(
    result.grants,
    [
      { matchId: "p3", quest_type: "kda_streak" },
      { matchId: "p3", quest_type: "deathless_win" },
    ],
    "p3 completa kda_streak y deathless_win a la vez: 2 mangos otorgados en la misma partida",
  );
  assertEqual(result.mangoCount, 2, "2 quests completas a la vez: mangoCount sube en 2");
}

// --- 20. Remake en medio de una racha de victorias: se ignora por completo, no cuenta ni corta la racha ---
{
  const seq = [win("r1"), win("r2"), remake("r3", { win: false }), win("r4"), win("r5"), win("r6")];
  const result = run({ progress: ZERO, matches: seq, mangoCount: 0 });
  assertEqual(
    result.grants,
    [{ matchId: "r6", quest_type: "win_streak" }],
    "remake en el medio de una racha de wins: se ignora — la racha real (r1,r2,r4,r5,r6) se completa en r6",
  );
}

// --- 21. Remake como última partida de la corrida: lastProcessedMatchId avanza igual (si no, se reprocesaría para siempre) ---
{
  const seq = [win("s1"), remake("s2")];
  const result = run({ progress: ZERO, matches: seq, mangoCount: 0 });
  assertEqual(
    result.lastProcessedMatchId,
    "s2",
    "remake al final de la corrida: el cursor avanza hasta ahí igual",
  );
  assertEqual(result.progress.win_streak, 1, "remake al final: no resetea el progreso que ya había ganado s1");
}

// --- 22. Duración exactamente en el mínimo (240s): SÍ cuenta, no es remake (>=, no >) ---
{
  const seq = [match("t1", { win: true, kda: 10, gameDurationSeconds: MIN_MATCH_DURATION_SECONDS })];
  const result = run({ progress: ZERO, matches: seq, mangoCount: 0 });
  assertEqual(result.progress.win_streak, 1, "duración == MIN_MATCH_DURATION_SECONDS: cuenta normal");
}

// --- 23. Un segundo menos que el mínimo: se ignora como remake ---
{
  const seq = [match("u1", { win: true, kda: 10, gameDurationSeconds: MIN_MATCH_DURATION_SECONDS - 1 })];
  const result = run({ progress: ZERO, matches: seq, mangoCount: 0 });
  assertEqual(result.progress.win_streak, 0, "duración == MIN_MATCH_DURATION_SECONDS - 1: se ignora como remake");
}

// --- 24. Victoria contra un participante registrado del torneo -> mango inmediato (target=1, no es racha) ---
{
  const seq = [beatWin("v1")];
  const result = run({ progress: ZERO, matches: seq, mangoCount: 0 });
  assertEqual(
    result.grants,
    [{ matchId: "v1", quest_type: "beat_participant" }],
    "1 victoria contra un participante registrado: se otorga el mango en esa misma partida",
  );
  assertEqual(result.progress.beat_participant, 0, "beat_participant: progreso vuelve a 0 tras otorgarse");
}

// --- 25. Victoria SIN enfrentar a ningún participante registrado -> no cuenta ---
{
  const seq = [win("v2")];
  const result = run({ progress: ZERO, matches: seq, mangoCount: 0 });
  assertEqual(result.grants, [], "victoria sin rival registrado: no otorga beat_participant");
  assertEqual(result.progress.beat_participant, 0, "victoria sin rival registrado: progreso sigue en 0");
}

// --- 26. Derrota contra un participante registrado -> no cuenta (hace falta GANAR) ---
{
  const seq = [{ ...loss("v3"), beatTrackedParticipant: true }];
  const result = run({ progress: ZERO, matches: seq, mangoCount: 0 });
  assertEqual(result.grants, [], "derrota contra un participante registrado: no otorga beat_participant, hace falta ganar");
}

// --- 27. Varias victorias contra participantes registrados en la misma corrida -> un mango por cada una (no es racha) ---
{
  const seq = [beatWin("v4"), win("v5"), beatWin("v6")]; // v5 no tiene rival registrado, no interrumpe nada
  const result = run({ progress: ZERO, matches: seq, mangoCount: 0 });
  assertEqual(
    result.grants.filter((g) => g.quest_type === "beat_participant"),
    [
      { matchId: "v4", quest_type: "beat_participant" },
      { matchId: "v6", quest_type: "beat_participant" },
    ],
    "2 victorias contra participantes registrados en la misma corrida: 2 mangos, uno por cada una",
  );
}

// --- 28. CASO LÍMITE: cupo lleno -> beat_participant se completa y se pierde igual, sin quedar pegada ---
{
  const seq = [beatWin("v7")];
  const result = run({ progress: ZERO, matches: seq, mangoCount: MAX_MANGO_INVENTORY });
  assertEqual(
    result.grants.filter((g) => g.quest_type === "beat_participant"),
    [],
    "cupo lleno: la victoria contra un participante registrado no otorga mango, se pierde",
  );
  assertEqual(
    result.progress.beat_participant,
    0,
    "cupo lleno: beat_participant resetea a 0 igual (mango perdido, no queda pegada en el target)",
  );
}

// --- 29. tierForRank: límites de las tres categorías ---
{
  assertEqual(tierForRank(1), "top1_10", "rank 1 -> top1_10");
  assertEqual(tierForRank(10), "top1_10", "rank 10 -> top1_10 (límite inclusive)");
  assertEqual(tierForRank(11), "top11_20", "rank 11 -> top11_20 (justo pasado el límite)");
  assertEqual(tierForRank(20), "top11_20", "rank 20 -> top11_20 (límite inclusive)");
  assertEqual(tierForRank(21), "top21_30", "rank 21 -> top21_30 (justo pasado el límite)");
  assertEqual(tierForRank(100), "top21_30", "rank 100 (roster grande): top21_30 igual, sin techo");
  assertEqual(tierForRank(null), "top21_30", "sin rango todavía (en placements): la categoría más floja");
}

// --- 30. questTargetsForTier: targets efectivos de cada categoría (regla confirmada por el usuario) ---
{
  assertEqual(
    questTargetsForTier("top1_10"),
    { win_streak: 5, kda_streak: 3, deathless_win: 1, beat_participant: 1 },
    "top1_10: 5 wins seguidas, KDA>=5 en 3 partidas",
  );
  assertEqual(
    questTargetsForTier("top11_20"),
    { win_streak: 4, kda_streak: 3, deathless_win: 1, beat_participant: 1 },
    "top11_20: 4 wins seguidas, KDA>=4 en 3 partidas",
  );
  assertEqual(
    questTargetsForTier("top21_30"),
    { win_streak: 3, kda_streak: 3, deathless_win: 1, beat_participant: 1 },
    "top21_30: 3 wins seguidas, KDA>=3 en 3 partidas",
  );
}

// --- 31. Categorías más flojas piden menos KDA y menos wins seguidas — misma secuencia, distinto resultado según tier ---
{
  const seq = [win("w1"), win("w2"), win("w3")]; // 3 wins seguidas
  const top21_30 = processNewMatches({ progress: ZERO, matches: seq, mangoCount: 0, tier: "top21_30" });
  assertEqual(
    top21_30.grants,
    [{ matchId: "w3", quest_type: "win_streak" }],
    "top21_30: 3 wins seguidas ya completan win_streak (target=3)",
  );

  const top1_10 = processNewMatches({ progress: ZERO, matches: seq, mangoCount: 0, tier: "top1_10" });
  assertEqual(
    top1_10.grants,
    [],
    "top1_10: las mismas 3 wins seguidas NO alcanzan (target=5) — misma secuencia, categoría más exigente",
  );
  assertEqual(top1_10.progress.win_streak, 3, "top1_10: progreso queda en 3/5, esperando 2 más");
}

assertEqual(MIN_MATCH_DURATION_SECONDS, 240, "MIN_MATCH_DURATION_SECONDS es 240 (4 minutos, regla confirmada por el usuario)");

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

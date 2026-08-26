// Test del motor de cumplimiento de castigos del sistema de Mangos
// (src/lib/penalty.ts), sin red ni base de datos — mismo patrón que
// scripts/test-quests.mjs.
//
// Modelo de contador COMPARTIDO (rediseño): un jugador con N castigos
// pendientes tiene UN SOLO contador de partidas-sin-cumplir para todo el
// grupo, no uno por castigo — ver el comentario al tope de penalty.ts.
//
//   node --experimental-strip-types scripts/test-penalty.mjs
//
import { processPenaltyMatches, PENALTY_GAME_LIMIT } from "../src/lib/penalty.ts";
import {
  SUPPORT_ASSIGNMENT as SUPPORT_ASSIGNMENT_FROM_MANGO_LAUNCH,
  NO_FLASH_ASSIGNMENT as NO_FLASH_ASSIGNMENT_FROM_MANGO_LAUNCH,
} from "../src/lib/mango-launch.ts";
import { MIN_MATCH_DURATION_SECONDS as MIN_MATCH_DURATION_SECONDS_FROM_QUESTS } from "../src/lib/quests.ts";

// penalty.ts duplica este valor a propósito (ver comentario ahí) — este test
// es lo que garantiza que no se desincronice del original en mango-launch.ts.
const SUPPORT_ASSIGNMENT = SUPPORT_ASSIGNMENT_FROM_MANGO_LAUNCH;

// Mismo patrón — penalty.ts duplica NO_FLASH_ASSIGNMENT y el mapeo de ids
// numéricos de hechizo (ver comentario ahí); este test garantiza que el
// sentinel al menos siga sincronizado (el mapeo numérico se ejercita con
// los tests de hechizo de abajo, comparando contra los ids reales de Riot).
const NO_FLASH_ASSIGNMENT = NO_FLASH_ASSIGNMENT_FROM_MANGO_LAUNCH;

// Mismo patrón — penalty.ts duplica MIN_MATCH_DURATION_SECONDS de quests.ts
// (ver comentario ahí); este test garantiza que ambos sigan sincronizados.
const MIN_MATCH_DURATION_SECONDS = MIN_MATCH_DURATION_SECONDS_FROM_QUESTS;

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
const NORMAL_GAME_DURATION_SECONDS = 1200;

function penalty(id, championAssigned, { createdAt = BASE_DATE } = {}) {
  return { id, championAssigned, createdAt };
}

// summoner1Id/summoner2Id: 0 por defecto (ningún hechizo real de Riot usa
// ese id) — así un test de castigo de campeón/Support que no pasa estos
// campos explícito nunca "cumple" un castigo de hechizo por accidente.
function match(
  id,
  {
    playedAt,
    championPlayed = "Ahri",
    teamPosition = "MIDDLE",
    summoner1Id = 0,
    summoner2Id = 0,
    gameDurationSeconds = NORMAL_GAME_DURATION_SECONDS,
  },
) {
  return { matchId: id, playedAt, championPlayed, teamPosition, summoner1Id, summoner2Id, gameDurationSeconds };
}
// Remake: duración corta (por defecto 3 min) es lo único que importa acá.
function remakeMatch(
  id,
  {
    playedAt,
    championPlayed = "Ahri",
    teamPosition = "MIDDLE",
    summoner1Id = 0,
    summoner2Id = 0,
    gameDurationSeconds = 180,
  },
) {
  return { matchId: id, playedAt, championPlayed, teamPosition, summoner1Id, summoner2Id, gameDurationSeconds };
}

function at(hoursAfterBase) {
  return new Date(new Date(BASE_DATE).getTime() + hoursAfterBase * 60 * 60 * 1000).toISOString();
}

function run(penalties, matches, gamesWithoutCompliance = 0) {
  return processPenaltyMatches({ penalties, matches, gamesWithoutCompliance });
}

function statusOf(result, id) {
  return result.updates.find((u) => u.id === id).status;
}

// --- 1. Un solo castigo pendiente: cumple en la 1ra partida -> completed, contador vuelve a 0 ---
{
  const result = run([penalty("p1", "Teemo")], [match("m1", { playedAt: at(1), championPlayed: "Teemo" })]);
  assertEqual(statusOf(result, "p1"), "completed", "1 castigo, cumple en m1: completed");
  assertEqual(result.gamesWithoutCompliance, 0, "1 castigo, cumple en m1: contador queda en 0");
}

// --- 2. Un solo castigo: 3 partidas sin cumplir -> disqualified (automático), contador vuelve a 0 (regla 5: sin pendientes, sin contador) ---
{
  const result = run(
    [penalty("p1", "Teemo")],
    [
      match("m1", { playedAt: at(1), championPlayed: "Ahri" }),
      match("m2", { playedAt: at(2), championPlayed: "Zed" }),
      match("m3", { playedAt: at(3), championPlayed: "Jinx" }),
    ],
  );
  assertEqual(statusOf(result, "p1"), "disqualified", "1 castigo, 3 partidas sin cumplir: disqualified");
  assertEqual(
    result.gamesWithoutCompliance,
    0,
    "1 castigo disqualified: el contador vuelve a 0 (ya no queda ningún pendiente corriendo)",
  );
}

// --- 3. EJEMPLO DEL USUARIO: 3 castigos pendientes, 2 partidas sin cumplir ninguno, la 3ra cumple UNO -> ese completed, contador reinicia a 0, quedan 2 pendientes con ventana fresca ---
{
  const penalties = [penalty("a", "Teemo"), penalty("b", "Zed"), penalty("c", "Jinx")];
  const matches = [
    match("m1", { playedAt: at(1), championPlayed: "Ahri" }), // no cumple ninguno -> contador=1
    match("m2", { playedAt: at(2), championPlayed: "Lux" }), // no cumple ninguno -> contador=2
    match("m3", { playedAt: at(3), championPlayed: "Teemo" }), // cumple "a" -> completed, contador vuelve a 0
  ];
  const result = run(penalties, matches);
  assertEqual(statusOf(result, "a"), "completed", "ejemplo del usuario: castigo 'a' (Teemo) se cumple en m3");
  assertEqual(statusOf(result, "b"), "pending", "ejemplo del usuario: 'b' sigue pendiente, con ventana fresca");
  assertEqual(statusOf(result, "c"), "pending", "ejemplo del usuario: 'c' sigue pendiente, con ventana fresca");
  assertEqual(
    result.gamesWithoutCompliance,
    0,
    "ejemplo del usuario: el contador compartido se reinicia a 0 tras cumplir 'a', para 'b' y 'c'",
  );
}

// --- 4. 3 castigos pendientes, NINGUNO se cumple en 3 partidas -> los 3 pasan a disqualified JUNTOS ---
{
  const penalties = [penalty("a", "Teemo"), penalty("b", "Zed"), penalty("c", "Jinx")];
  const matches = [
    match("m1", { playedAt: at(1), championPlayed: "Ahri" }),
    match("m2", { playedAt: at(2), championPlayed: "Lux" }),
    match("m3", { playedAt: at(3), championPlayed: "Vayne" }),
  ];
  const result = run(penalties, matches);
  assertEqual(statusOf(result, "a"), "disqualified", "3 castigos, nada cumplido en 3 partidas: 'a' disqualified");
  assertEqual(statusOf(result, "b"), "disqualified", "3 castigos, nada cumplido en 3 partidas: 'b' disqualified");
  assertEqual(statusOf(result, "c"), "disqualified", "3 castigos, nada cumplido en 3 partidas: 'c' disqualified");
  assertEqual(result.gamesWithoutCompliance, 0, "los 3 disqualified juntos: el contador vuelve a 0");
}

// --- 5. Una misma partida cumple DOS castigos a la vez (dos Support pendientes) -> ambos completed en la misma partida ---
{
  const penalties = [penalty("s1", SUPPORT_ASSIGNMENT), penalty("s2", SUPPORT_ASSIGNMENT)];
  const matches = [match("m1", { playedAt: at(1), championPlayed: "Lulu", teamPosition: "UTILITY" })];
  const result = run(penalties, matches);
  assertEqual(statusOf(result, "s1"), "completed", "2 castigos Support: la misma partida cumple los DOS a la vez (s1)");
  assertEqual(statusOf(result, "s2"), "completed", "2 castigos Support: la misma partida cumple los DOS a la vez (s2)");
  assertEqual(
    result.updates.find((u) => u.id === "s1").completedOnMatchId,
    "m1",
    "ambos quedan marcados con la misma partida que los cumplió",
  );
}

// --- 6. Solo 2 partidas sin cumplir (no llega al límite) -> el grupo entero sigue 'pending', contador en 2 ---
{
  const penalties = [penalty("a", "Teemo"), penalty("b", "Zed")];
  const matches = [
    match("m1", { playedAt: at(1), championPlayed: "Ahri" }),
    match("m2", { playedAt: at(2), championPlayed: "Lux" }),
  ];
  const result = run(penalties, matches);
  assertEqual(statusOf(result, "a"), "pending", "2 partidas sin cumplir (no llega a 3): sigue pending");
  assertEqual(statusOf(result, "b"), "pending", "2 partidas sin cumplir (no llega a 3): sigue pending");
  assertEqual(result.gamesWithoutCompliance, 2, "el contador compartido queda en 2, con margen todavía");
}

// --- 7. Retoma un contador que ya venía con progreso (2) de una corrida anterior -> 1 partida más sin cumplir alcanza el límite ---
{
  const result = run(
    [penalty("a", "Teemo")],
    [match("m1", { playedAt: at(1), championPlayed: "Ahri" })],
    2, // contador ya en 2 al arrancar esta corrida
  );
  assertEqual(statusOf(result, "a"), "disqualified", "arranca en 2/3: 1 partida más sin cumplir alcanza el límite");
  assertEqual(result.gamesWithoutCompliance, 0, "disqualified: el contador vuelve a 0");
}

// --- 8. Sin castigos pendientes: no-op total, sin contador corriendo (regla 5) — incluso si venía un contador viejo pegado ---
{
  const result = run([], [match("m1", { playedAt: at(1), championPlayed: "Teemo" })], 2);
  assertEqual(result.updates, [], "sin castigos pendientes: no hay nada que actualizar");
  assertEqual(result.gamesWithoutCompliance, 0, "sin castigos pendientes: el contador queda/vuelve a 0, no corre");
}

// --- 9. Una vez descalificado el grupo, partidas posteriores en la misma corrida no lo tocan más ---
{
  const penalties = [penalty("a", "Teemo")];
  const matches = [
    match("m1", { playedAt: at(1), championPlayed: "Ahri" }),
    match("m2", { playedAt: at(2), championPlayed: "Lux" }),
    match("m3", { playedAt: at(3), championPlayed: "Vayne" }), // flaggea acá
    match("m4", { playedAt: at(4), championPlayed: "Teemo" }), // llega tarde, ya no cuenta
  ];
  const result = run(penalties, matches);
  assertEqual(statusOf(result, "a"), "disqualified", "disqualified en m3: m4 (aunque cumpla) no lo revierte");
  assertEqual(result.gamesWithoutCompliance, 0, "sigue en 0 tras flaggear, m4 no lo mueve");
}

// --- 10. Castigo "Support": cumple con CUALQUIER campeón en UTILITY, no uno específico ---
{
  const result = run(
    [penalty("p1", SUPPORT_ASSIGNMENT)],
    [match("m1", { playedAt: at(1), championPlayed: "Jinx", teamPosition: "UTILITY" })],
  );
  assertEqual(statusOf(result, "p1"), "completed", "castigo Support: cumple con Jinx en UTILITY, no hace falta un campeón específico");
}

// --- 11. Castigo "Support": jugar un campeón support típico en otra línea NO cumple (importa teamPosition, no el campeón) ---
{
  const result = run(
    [penalty("p1", SUPPORT_ASSIGNMENT)],
    [match("m1", { playedAt: at(1), championPlayed: "Soraka", teamPosition: "BOTTOM" })],
  );
  assertEqual(statusOf(result, "p1"), "pending", "castigo Support: Soraka en BOTTOM no cumple, importa la línea");
}

// --- 12. Partidas jugadas ANTES de que existiera NINGÚN castigo pendiente no cuentan ni a favor ni en contra ---
{
  const result = run(
    [penalty("a", "Teemo", { createdAt: at(5) })],
    [
      match("m1", { playedAt: at(1), championPlayed: "Ahri" }), // antes: se ignora
      match("m2", { playedAt: at(2), championPlayed: "Teemo" }), // antes: se ignora aunque "cumpliría"
    ],
  );
  assertEqual(statusOf(result, "a"), "pending", "partidas anteriores a que existiera el castigo: se ignoran");
  assertEqual(result.gamesWithoutCompliance, 0, "partidas anteriores: no suman al contador");
}

// --- 13. Sin partidas nuevas: no-op, el contador se devuelve tal cual estaba ---
{
  const result = run([penalty("a", "Teemo")], [], 1);
  assertEqual(statusOf(result, "a"), "pending", "sin partidas nuevas: no cambia nada");
  assertEqual(result.gamesWithoutCompliance, 1, "sin partidas nuevas: el contador no se toca");
}

// --- 14. Múltiples castigos: uno se cumple, otro NO en la misma partida (no todos cumplen a la vez) ---
{
  const penalties = [penalty("teemo", "Teemo"), penalty("zed", "Zed")];
  const matches = [match("m1", { playedAt: at(1), championPlayed: "Teemo" })];
  const result = run(penalties, matches);
  assertEqual(statusOf(result, "teemo"), "completed", "2 castigos, 1 partida: se cumple el que coincide");
  assertEqual(statusOf(result, "zed"), "pending", "2 castigos, 1 partida: el que no coincide sigue pendiente");
  assertEqual(result.gamesWithoutCompliance, 0, "al cumplirse uno, el contador compartido se resetea igual");
}

// --- 15. Remake no gasta ventana del contador compartido, aunque no cumpla ---
{
  const result = run(
    [penalty("a", "Teemo")],
    [
      match("m1", { playedAt: at(1), championPlayed: "Ahri" }), // no cumple -> contador=1
      remakeMatch("m2", { playedAt: at(2), championPlayed: "Zed" }), // remake: se ignora, contador sigue en 1
      match("m3", { playedAt: at(3), championPlayed: "Jinx" }), // no cumple -> contador=2
    ],
  );
  assertEqual(statusOf(result, "a"), "pending", "remake en el medio: no gasta ventana, todavía no llega a 3");
  assertEqual(
    result.gamesWithoutCompliance,
    2,
    "remake en el medio: el contador solo cuenta las 2 partidas reales (m1, m3), no el remake",
  );
}

// --- 16. Remake NO cumple un castigo aunque el campeón jugado coincida ---
{
  const result = run([penalty("a", "Teemo")], [remakeMatch("m1", { playedAt: at(1), championPlayed: "Teemo" })]);
  assertEqual(
    statusOf(result, "a"),
    "pending",
    "remake con el campeón correcto: NO cumple el castigo, se ignora por completo",
  );
  assertEqual(result.gamesWithoutCompliance, 0, "remake: tampoco suma al contador");
}

// --- 17. Un remake entre las 3 partidas de la ventana: el grupo NO flaggea todavía (solo cuentan las reales) ---
{
  const result = run(
    [penalty("a", "Teemo")],
    [
      match("m1", { playedAt: at(1), championPlayed: "Ahri" }),
      match("m2", { playedAt: at(2), championPlayed: "Lux" }),
      remakeMatch("m3", { playedAt: at(3), championPlayed: "Vayne" }),
    ],
  );
  assertEqual(statusOf(result, "a"), "pending", "solo 2 partidas reales sin cumplir (el remake no cuenta): sigue pending");
  assertEqual(result.gamesWithoutCompliance, 2, "el contador refleja solo las 2 partidas reales");
}

// --- 18. Castigo de hechizo puntual ("Fantasma" = SummonerHaste, id numérico 6): cumple con ese hechizo en CUALQUIERA de los dos slots ---
{
  const result = run(
    [penalty("p1", "SummonerHaste")],
    [match("m1", { playedAt: at(1), summoner1Id: 4, summoner2Id: 6 })],
  );
  assertEqual(statusOf(result, "p1"), "completed", "castigo de hechizo: cumple con SummonerHaste en el segundo slot");
}

// --- 19. Castigo de hechizo puntual: NO cumple si ninguno de los dos slots es el hechizo pedido ---
{
  const result = run(
    [penalty("p1", "SummonerHaste")],
    [match("m1", { playedAt: at(1), summoner1Id: 4, summoner2Id: 7 })],
  );
  assertEqual(statusOf(result, "p1"), "pending", "castigo de hechizo: Flash+Curar no cumple el pedido de Fantasma");
}

// --- 20. Castigo "sin Flash": cumple con CUALQUIER combinación de los otros dos hechizos ---
{
  const result = run(
    [penalty("p1", NO_FLASH_ASSIGNMENT)],
    [match("m1", { playedAt: at(1), summoner1Id: 7, summoner2Id: 14 })],
  );
  assertEqual(statusOf(result, "p1"), "completed", "castigo sin Flash: cumple con Curar+Incendiar (ninguno es Flash)");
}

// --- 21. Castigo "sin Flash": NO cumple si Flash está en CUALQUIERA de los dos slots ---
{
  const result = run(
    [penalty("p1", NO_FLASH_ASSIGNMENT)],
    [match("m1", { playedAt: at(1), summoner1Id: 7, summoner2Id: 4 })],
  );
  assertEqual(statusOf(result, "p1"), "pending", "castigo sin Flash: Curar+Flash no cumple, Flash está en el segundo slot");
}

// --- 22. Grupo mixto (campeón + hechizo + sin Flash) pendientes a la vez: una partida solo cumple UNO de los tres ---
{
  const penalties = [
    penalty("champ", "Teemo"),
    penalty("spell", "SummonerSmite"), // Hoz, id 11
    penalty("noflash", NO_FLASH_ASSIGNMENT),
  ];
  const matches = [match("m1", { playedAt: at(1), championPlayed: "Ahri", summoner1Id: 11, summoner2Id: 4 })];
  const result = run(penalties, matches);
  assertEqual(statusOf(result, "champ"), "pending", "grupo mixto: no jugó Teemo, sigue pendiente");
  assertEqual(statusOf(result, "spell"), "completed", "grupo mixto: llevó Hoz (id 11) en el primer slot, se cumple");
  assertEqual(statusOf(result, "noflash"), "pending", "grupo mixto: llevó Flash en el segundo slot, sin Flash NO se cumple");
}

// --- 23. Remake tampoco cumple un castigo de hechizo aunque el hechizo coincida ---
{
  const result = run(
    [penalty("a", "SummonerSmite")],
    [remakeMatch("m1", { playedAt: at(1), summoner1Id: 11, summoner2Id: 4 })],
  );
  assertEqual(statusOf(result, "a"), "pending", "remake con el hechizo correcto: NO cumple, se ignora por completo");
  assertEqual(result.gamesWithoutCompliance, 0, "remake: tampoco suma al contador (castigo de hechizo)");
}

assertEqual(PENALTY_GAME_LIMIT, 3, "PENALTY_GAME_LIMIT es 3 (regla confirmada por el usuario)");
assertEqual(
  MIN_MATCH_DURATION_SECONDS,
  300,
  "MIN_MATCH_DURATION_SECONDS sincronizado con quests.ts (300s = 5 min, regla confirmada por el usuario)",
);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

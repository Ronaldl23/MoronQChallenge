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
import { processPenaltyMatches, PENALTY_GAME_LIMIT, SHIELD_STREAK_TARGET } from "../src/lib/penalty.ts";
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

function penalty(id, championAssigned, { createdAt = BASE_DATE, isSelfInflicted = false } = {}) {
  return { id, championAssigned, createdAt, isSelfInflicted };
}

// summoner1Id/summoner2Id: 0 por defecto (ningún hechizo real de Riot usa
// ese id) — así un test de castigo de campeón/Support que no pasa estos
// campos explícito nunca "cumple" un castigo de hechizo por accidente.
// win: true por defecto — la mayoría de los tests de acá no le importa a
// la racha de Misión Escudo, así que todas las partidas "ganan" salvo que
// un test puntual (los de la sección Misión Escudo, más abajo) diga lo
// contrario a propósito.
function match(
  id,
  {
    playedAt,
    championPlayed = "Ahri",
    teamPosition = "MIDDLE",
    summoner1Id = 0,
    summoner2Id = 0,
    gameDurationSeconds = NORMAL_GAME_DURATION_SECONDS,
    win = true,
  },
) {
  return { matchId: id, playedAt, championPlayed, teamPosition, summoner1Id, summoner2Id, gameDurationSeconds, win };
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
    win = true,
  },
) {
  return { matchId: id, playedAt, championPlayed, teamPosition, summoner1Id, summoner2Id, gameDurationSeconds, win };
}

function at(hoursAfterBase) {
  return new Date(new Date(BASE_DATE).getTime() + hoursAfterBase * 60 * 60 * 1000).toISOString();
}

function run(penalties, matches, gamesWithoutCompliance = 0, shieldStreakCount = 0) {
  return processPenaltyMatches({ penalties, matches, gamesWithoutCompliance, shieldStreakCount });
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

// --- 2. Un solo castigo: 3 partidas sin cumplir -> YA NO se descalifica, sigue 'pending' y se otorga 1 castigo nuevo (nonComplianceGrants), contador vuelve a 0 ---
{
  const result = run(
    [penalty("p1", "Teemo")],
    [
      match("m1", { playedAt: at(1), championPlayed: "Ahri" }),
      match("m2", { playedAt: at(2), championPlayed: "Zed" }),
      match("m3", { playedAt: at(3), championPlayed: "Jinx" }),
    ],
  );
  assertEqual(statusOf(result, "p1"), "pending", "1 castigo, 3 partidas sin cumplir: sigue pending (ya no hay descalificación)");
  assertEqual(result.nonComplianceGrants, 1, "1 castigo, 3 partidas sin cumplir: se otorga 1 castigo nuevo");
  assertEqual(
    result.gamesWithoutCompliance,
    0,
    "1 castigo sin cumplir a tiempo: el contador vuelve a 0 (ventana fresca)",
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

// --- 4. 3 castigos pendientes, NINGUNO se cumple en 3 partidas -> los 3 quedan 'pending' (ya no se descalifican), se otorga 1 castigo nuevo para todo el grupo (no uno por cada pendiente) ---
{
  const penalties = [penalty("a", "Teemo"), penalty("b", "Zed"), penalty("c", "Jinx")];
  const matches = [
    match("m1", { playedAt: at(1), championPlayed: "Ahri" }),
    match("m2", { playedAt: at(2), championPlayed: "Lux" }),
    match("m3", { playedAt: at(3), championPlayed: "Vayne" }),
  ];
  const result = run(penalties, matches);
  assertEqual(statusOf(result, "a"), "pending", "3 castigos, nada cumplido en 3 partidas: 'a' sigue pending");
  assertEqual(statusOf(result, "b"), "pending", "3 castigos, nada cumplido en 3 partidas: 'b' sigue pending");
  assertEqual(statusOf(result, "c"), "pending", "3 castigos, nada cumplido en 3 partidas: 'c' sigue pending");
  assertEqual(result.nonComplianceGrants, 1, "3 castigos sin cumplir: 1 solo castigo nuevo por la ventana agotada, no uno por pendiente");
  assertEqual(result.gamesWithoutCompliance, 0, "ventana agotada: el contador vuelve a 0 (fresco para lo que quede pendiente)");
}

// --- 5. Dos castigos pendientes con la MISMA asignación (dos Support): una partida cumple UNO SOLO (el más viejo), no los dos ---
{
  const penalties = [
    penalty("s1", SUPPORT_ASSIGNMENT, { createdAt: at(0) }),
    penalty("s2", SUPPORT_ASSIGNMENT, { createdAt: at(0.5) }),
  ];
  const matches = [match("m1", { playedAt: at(1), championPlayed: "Lulu", teamPosition: "UTILITY" })];
  const result = run(penalties, matches);
  assertEqual(statusOf(result, "s1"), "completed", "2 castigos Support duplicados: se cumple el más viejo (s1)");
  assertEqual(statusOf(result, "s2"), "pending", "2 castigos Support duplicados: el otro sigue pendiente, necesita su propia partida");
  assertEqual(
    result.updates.find((u) => u.id === "s1").completedOnMatchId,
    "m1",
    "el que se cumplió queda marcado con la partida que lo cumplió",
  );
}

// --- 5b. CASO REAL (Juan Ruiz): dos Hoz + un Vayne pendientes, juega Hoz una vez -> se cumple UN Hoz, quedan pendientes el otro Hoz y el Vayne ---
{
  const penalties = [
    penalty("hoz1", "SummonerSmite", { createdAt: at(0) }), // Hoz, id 11
    penalty("hoz2", "SummonerSmite", { createdAt: at(0.5) }),
    penalty("vayne", "Vayne", { createdAt: at(0) }),
  ];
  const matches = [match("m1", { playedAt: at(1), championPlayed: "Ahri", summoner1Id: 11, summoner2Id: 4 })];
  const result = run(penalties, matches);
  assertEqual(statusOf(result, "hoz1"), "completed", "Juan Ruiz: se cumple el Hoz más viejo (hoz1)");
  assertEqual(statusOf(result, "hoz2"), "pending", "Juan Ruiz: el segundo Hoz sigue pendiente, necesita otra partida con Hoz");
  assertEqual(statusOf(result, "vayne"), "pending", "Juan Ruiz: el Vayne no se toca, no jugó Vayne");
  assertEqual(result.gamesWithoutCompliance, 0, "Juan Ruiz: al cumplir uno, el contador compartido igual se resetea");
}

// --- 5c. Dos Hoz pendientes: hacen falta DOS partidas separadas con Hoz para cumplir ambos, no una sola ---
{
  const penalties = [
    penalty("hoz1", "SummonerSmite", { createdAt: at(0) }),
    penalty("hoz2", "SummonerSmite", { createdAt: at(0.5) }),
  ];
  const matches = [
    match("m1", { playedAt: at(1), summoner1Id: 11, summoner2Id: 4 }), // cumple hoz1
    match("m2", { playedAt: at(2), summoner1Id: 11, summoner2Id: 4 }), // cumple hoz2
  ];
  const result = run(penalties, matches);
  assertEqual(statusOf(result, "hoz1"), "completed", "dos Hoz: la primera partida con Hoz cumple hoz1");
  assertEqual(statusOf(result, "hoz2"), "completed", "dos Hoz: la segunda partida con Hoz cumple hoz2");
  assertEqual(
    result.updates.find((u) => u.id === "hoz1").completedOnMatchId,
    "m1",
    "hoz1 se cumplió con m1",
  );
  assertEqual(
    result.updates.find((u) => u.id === "hoz2").completedOnMatchId,
    "m2",
    "hoz2 se cumplió con m2, no con m1",
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

// --- 7. Retoma un contador que ya venía con progreso (2) de una corrida anterior -> 1 partida más sin cumplir alcanza el límite y otorga un castigo nuevo ---
{
  const result = run(
    [penalty("a", "Teemo")],
    [match("m1", { playedAt: at(1), championPlayed: "Ahri" })],
    2, // contador ya en 2 al arrancar esta corrida
  );
  assertEqual(statusOf(result, "a"), "pending", "arranca en 2/3: 1 partida más sin cumplir alcanza el límite, pero sigue pending");
  assertEqual(result.nonComplianceGrants, 1, "arranca en 2/3: se otorga 1 castigo nuevo al agotar la ventana");
  assertEqual(result.gamesWithoutCompliance, 0, "ventana agotada: el contador vuelve a 0");
}

// --- 8. Sin castigos pendientes: no-op total, sin contador corriendo (regla 5) — incluso si venía un contador viejo pegado ---
{
  const result = run([], [match("m1", { playedAt: at(1), championPlayed: "Teemo" })], 2);
  assertEqual(result.updates, [], "sin castigos pendientes: no hay nada que actualizar");
  assertEqual(result.gamesWithoutCompliance, 0, "sin castigos pendientes: el contador queda/vuelve a 0, no corre");
  assertEqual(result.nonComplianceGrants, 0, "sin castigos pendientes: no se otorga ningún castigo nuevo");
}

// --- 9. Ya no hay estado terminal: agotada la ventana en m3 (1er castigo nuevo), "a" sigue pending y una partida posterior en la MISMA corrida todavía puede cumplirlo ---
{
  const penalties = [penalty("a", "Teemo")];
  const matches = [
    match("m1", { playedAt: at(1), championPlayed: "Ahri" }),
    match("m2", { playedAt: at(2), championPlayed: "Lux" }),
    match("m3", { playedAt: at(3), championPlayed: "Vayne" }), // agota la ventana -> +1 castigo nuevo, contador vuelve a 0
    match("m4", { playedAt: at(4), championPlayed: "Teemo" }), // ventana fresca: SÍ lo cumple
  ];
  const result = run(penalties, matches);
  assertEqual(statusOf(result, "a"), "completed", "ventana agotada en m3 no es terminal: m4 todavía puede cumplir 'a'");
  assertEqual(
    result.updates.find((u) => u.id === "a").completedOnMatchId,
    "m4",
    "'a' se cumple con m4, no antes",
  );
  assertEqual(result.nonComplianceGrants, 1, "1 castigo nuevo otorgado en m3, antes de que m4 cumpliera 'a'");
  assertEqual(result.gamesWithoutCompliance, 0, "cumplido en m4: el contador vuelve a 0 de nuevo");
}

// --- 9b. Sin techo: dos ventanas agotadas en la MISMA corrida (6 partidas sin cumplir nada) -> 2 castigos nuevos ---
{
  const penalties = [penalty("a", "Teemo")];
  const matches = [
    match("m1", { playedAt: at(1), championPlayed: "Ahri" }),
    match("m2", { playedAt: at(2), championPlayed: "Lux" }),
    match("m3", { playedAt: at(3), championPlayed: "Vayne" }), // ventana 1 agotada -> +1
    match("m4", { playedAt: at(4), championPlayed: "Ahri" }),
    match("m5", { playedAt: at(5), championPlayed: "Lux" }),
    match("m6", { playedAt: at(6), championPlayed: "Vayne" }), // ventana 2 agotada -> +1 más
  ];
  const result = run(penalties, matches);
  assertEqual(statusOf(result, "a"), "pending", "sin techo: 'a' sigue pending tras 2 ventanas agotadas seguidas");
  assertEqual(result.nonComplianceGrants, 2, "sin techo: 2 castigos nuevos en la misma corrida, uno por cada ventana agotada");
  assertEqual(result.gamesWithoutCompliance, 0, "tras la 2da ventana agotada, el contador vuelve a 0");
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

// --- 24. Misión Escudo: ganar una partida de castigo suma a la racha, sin llegar todavía al Escudo ---
{
  const result = run(
    [penalty("a", "Teemo")],
    [match("m1", { playedAt: at(1), championPlayed: "Teemo", win: true })],
  );
  assertEqual(result.shieldStreakCount, 1, "1 partida de castigo ganada: racha en 1");
  assertEqual(result.shieldsGranted, 0, "1/3: todavía no se otorga ningún Escudo");
}

// --- 25. Misión Escudo: EJEMPLO DEL USUARIO — castigo ganado, partida normal (no castigo) perdida en el medio no corta la racha, otro castigo ganado después -> racha en 2 ---
{
  const penalties = [penalty("a", "Teemo", { createdAt: at(0) }), penalty("b", "Zed", { createdAt: at(0) })];
  const matches = [
    match("m1", { playedAt: at(1), championPlayed: "Teemo", win: true }), // partida de castigo, ganada -> racha=1
    match("m2", { playedAt: at(2), championPlayed: "Ahri", win: false }), // NO es de castigo (no cumple nada pendiente en ese momento) -> no toca la racha
    match("m3", { playedAt: at(3), championPlayed: "Zed", win: true }), // partida de castigo, ganada -> racha=2
  ];
  const result = run(penalties, matches);
  assertEqual(result.shieldStreakCount, 2, "ejemplo del usuario: la partida normal perdida en el medio no corta la racha (queda en 2)");
  assertEqual(result.shieldsGranted, 0, "ejemplo del usuario: todavía 2/3, sin Escudo");
}

// --- 26. Misión Escudo: perder una partida de castigo (la cumple igual, pero la pierde) corta la racha a 0 ---
{
  const result = run(
    [penalty("a", "Teemo")],
    [match("m1", { playedAt: at(1), championPlayed: "Teemo", win: false })],
    0,
    2, // racha ya en 2 al arrancar
  );
  assertEqual(statusOf(result, "a"), "completed", "se cumple el castigo igual, ganarlo o no es aparte");
  assertEqual(result.shieldStreakCount, 0, "perder una partida de castigo corta la racha a 0, aunque la cumpla");
}

// --- 27. Misión Escudo: llegar a SHIELD_STREAK_TARGET otorga un Escudo y reinicia la racha a 0 ---
{
  const result = run(
    [penalty("a", "Teemo")],
    [match("m1", { playedAt: at(1), championPlayed: "Teemo", win: true })],
    0,
    2, // racha ya en 2 al arrancar -> esta partida la lleva a 3
  );
  assertEqual(result.shieldStreakCount, 0, "al llegar al target, la racha se reinicia a 0");
  assertEqual(result.shieldsGranted, 1, "al llegar al target, se otorga 1 Escudo");
}

// --- 28. Misión Escudo: una partida que no cumple NINGÚN castigo pendiente no toca la racha para nada (ni suma ni corta), la pierda o la gane ---
{
  const result = run(
    [penalty("a", "Teemo")],
    [match("m1", { playedAt: at(1), championPlayed: "Ahri", win: false })],
    0,
    2, // racha ya en 2
  );
  assertEqual(result.shieldStreakCount, 2, "partida que no es de castigo: la racha queda intacta en 2, sin importar el resultado");
}

// --- 29. Misión Escudo: sin castigos pendientes, la racha se devuelve tal cual (no se resetea por quedarse sin pendientes) ---
{
  const result = run([], [match("m1", { playedAt: at(1), championPlayed: "Teemo" })], 0, 2);
  assertEqual(result.shieldStreakCount, 2, "sin castigos pendientes: la racha de Misión Escudo sobrevive, a diferencia del contador de incumplimiento");
}

// --- 30. EXPLOIT (preguntado por el usuario): ganar UNA partida que cumple 3 castigos simultáneos distintos a la vez NO da el Escudo de una — la racha solo suma 1, sin importar cuántos castigos cumplió esa misma partida ---
{
  const penalties = [
    penalty("champ", "Teemo", { createdAt: at(0) }),
    penalty("spell", "SummonerSmite", { createdAt: at(0) }), // Hoz, id 11
    penalty("noflash", NO_FLASH_ASSIGNMENT, { createdAt: at(0) }),
  ];
  // Una sola partida que cumple los 3 a la vez (Teemo + Hoz + sin Flash) y encima la gana.
  const matches = [
    match("m1", {
      playedAt: at(1),
      championPlayed: "Teemo",
      summoner1Id: 11,
      summoner2Id: 7,
      win: true,
    }),
  ];
  const result = run(penalties, matches);
  assertEqual(statusOf(result, "champ"), "completed", "exploit: los 3 castigos se cumplen en la misma partida");
  assertEqual(statusOf(result, "spell"), "completed", "exploit: los 3 castigos se cumplen en la misma partida");
  assertEqual(statusOf(result, "noflash"), "completed", "exploit: los 3 castigos se cumplen en la misma partida");
  assertEqual(result.shieldStreakCount, 1, "exploit: cumplir 3 castigos A LA VEZ en una sola partida ganada solo suma 1 a la racha, no 3");
  assertEqual(result.shieldsGranted, 0, "exploit: NO se otorga el Escudo de una — hacen falta 3 partidas GANADAS separadas, no una con triple cumplimiento");
}

// --- 31. EXPLOIT: cumplir/ganar un castigo AUTOINFLIGIDO (rebote/hongo/incumplimiento) no suma a la racha — evita fabricar "partidas de castigo" propias ignorando a propósito los castigos reales (mismo patrón que el exploit de Benimaru con la protección) ---
{
  const result = run(
    [penalty("a", "Teemo", { isSelfInflicted: true })],
    [match("m1", { playedAt: at(1), championPlayed: "Teemo", win: true })],
  );
  assertEqual(statusOf(result, "a"), "completed", "el castigo autoinfligido se cumple igual, eso no cambia");
  assertEqual(result.shieldStreakCount, 0, "exploit: ganar un castigo autoinfligido NO suma a la racha del Escudo");
}

// --- 31b. Una partida que cumple un castigo REAL y uno autoinfligido A LA VEZ sí suma (alcanza con que UNO de los cumplidos sea real) ---
{
  const penalties = [
    penalty("real", "Teemo", { createdAt: at(0) }),
    penalty("auto", NO_FLASH_ASSIGNMENT, { createdAt: at(0), isSelfInflicted: true }),
  ];
  const matches = [
    match("m1", { playedAt: at(1), championPlayed: "Teemo", summoner1Id: 7, summoner2Id: 14, win: true }),
  ];
  const result = run(penalties, matches);
  assertEqual(result.shieldStreakCount, 1, "con al menos un castigo REAL cumplido en la partida, sí suma a la racha aunque también haya cumplido uno autoinfligido de paso");
}

assertEqual(SHIELD_STREAK_TARGET, 3, "SHIELD_STREAK_TARGET es 3 (Misión Escudo, pedido explícito del usuario)");

assertEqual(PENALTY_GAME_LIMIT, 3, "PENALTY_GAME_LIMIT es 3 (regla confirmada por el usuario)");
assertEqual(
  MIN_MATCH_DURATION_SECONDS,
  240,
  "MIN_MATCH_DURATION_SECONDS sincronizado con quests.ts (240s = 4 min, regla confirmada por el usuario)",
);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

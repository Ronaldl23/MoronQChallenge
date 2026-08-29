// Test de la lógica pura del sistema de mangos (src/lib/mango-launch.ts),
// sin red ni base de datos — mismo patrón que scripts/test-quests.mjs.
// randomInt es criptográfico (no mockeable sin inyección de dependencias),
// así que la distribución se valida estadísticamente con muchos trials y
// tolerancia generosa, no comparando un valor exacto — mismo criterio que
// cualquier test de RNG real.
//
//   node --experimental-strip-types scripts/test-mango-launch.mjs
//
import {
  pickWeightedIndex,
  rollFirstOutcome,
  isMangoExpired,
  mangoExpiresAt,
  hoursFromNowIso,
  computeBullyingBonusPercent,
  canLaunchMango,
  MANDATORY_SPELL_IDS,
  FLASH_SPELL_ID,
  BOUNCE_PROBABILITY_PERCENT,
  EXPIRED_BOUNCE_PROBABILITY_PERCENT,
  MANGO_EXPIRY_HOURS,
  BULLYING_BOUNCE_PERCENT_PER_RANK,
  MAX_ACTIVE_PENALTIES,
} from "../src/lib/mango-launch.ts";

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

function assertClose(actual, expected, tolerance, label) {
  const ok = Math.abs(actual - expected) <= tolerance;
  if (ok) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL: ${label}`);
    console.error(`  esperado: ${expected} ± ${tolerance}`);
    console.error(`  obtenido: ${actual}`);
  }
}

const champions = Array.from({ length: 20 }, (_, i) => ({
  id: `Champ${i}`,
  name: `Champ${i}`,
  iconUrl: "",
  key: String(i),
}));
const spells = [
  ...MANDATORY_SPELL_IDS.map((id, i) => ({ id, key: String(i), name: id, iconUrl: "" })),
  { id: FLASH_SPELL_ID, key: "4", name: "Flash", iconUrl: "" },
];

// === pickWeightedIndex ===

// --- 1. Un solo peso -> siempre ese índice ---
{
  for (let i = 0; i < 50; i++) {
    assertEqual(pickWeightedIndex([1]), 0, "un solo slot: siempre índice 0");
  }
}

// --- 2. Peso 0 nunca sale elegido ---
{
  let sawZero = false;
  for (let i = 0; i < 2000; i++) {
    if (pickWeightedIndex([0, 5]) === 0) sawZero = true;
  }
  assertEqual(sawZero, false, "un slot con peso 0 nunca se elige en 2000 intentos");
}

// --- 3. Distribución proporcional a los pesos (mismo patrón que SPELL_SLOT_WEIGHTS: 7x10 + 2x13) ---
{
  const weights = [10, 10, 10, 10, 10, 10, 10, 13, 13];
  const total = weights.reduce((a, b) => a + b, 0);
  const trials = 200_000;
  const counts = new Array(weights.length).fill(0);
  for (let i = 0; i < trials; i++) counts[pickWeightedIndex(weights)]++;

  for (let i = 0; i < weights.length; i++) {
    const expectedPct = (weights[i] / total) * 100;
    const actualPct = (counts[i] / trials) * 100;
    assertClose(actualPct, expectedPct, 1.5, `pickWeightedIndex slot ${i} (peso ${weights[i]}/${total}): ~${expectedPct.toFixed(2)}%`);
  }
  // Los dos slots boosteados (7 y 8) deben salir más seguido que cualquiera de los normales.
  const normalAvg = counts.slice(0, 7).reduce((a, b) => a + b, 0) / 7;
  assertEqual(counts[7] > normalAvg && counts[8] > normalAvg, true, "los slots boosteados salen más que el promedio de los normales");
}

// === rollFirstOutcome: tasa de rebote según el % pasado ===

// --- 4. Mango normal: ~BOUNCE_PROBABILITY_PERCENT de rebote ---
{
  const trials = 50_000;
  let bounces = 0;
  for (let i = 0; i < trials; i++) {
    if (rollFirstOutcome(champions, spells).kind === "bounce") bounces++;
  }
  assertClose((bounces / trials) * 100, BOUNCE_PROBABILITY_PERCENT, 1, `mango normal: ~${BOUNCE_PROBABILITY_PERCENT}% de rebote`);
}

// --- 5. Mango caduco (bounceProbabilityPercent=EXPIRED): ~30% de rebote, notablemente más que el normal ---
{
  const trials = 50_000;
  let bounces = 0;
  for (let i = 0; i < trials; i++) {
    if (rollFirstOutcome(champions, spells, EXPIRED_BOUNCE_PROBABILITY_PERCENT).kind === "bounce") bounces++;
  }
  assertClose((bounces / trials) * 100, EXPIRED_BOUNCE_PROBABILITY_PERCENT, 1, `mango caduco: ~${EXPIRED_BOUNCE_PROBABILITY_PERCENT}% de rebote`);
}

// === isMangoExpired ===

// --- 6. Justo en el borde (exactamente MANGO_EXPIRY_HOURS atrás) -> expirado (>=, no >) ---
{
  const now = new Date("2026-01-02T00:00:00Z");
  const inventorySince = new Date(now.getTime() - MANGO_EXPIRY_HOURS * 60 * 60 * 1000).toISOString();
  assertEqual(isMangoExpired(inventorySince, now), true, "exactamente 24h atrás: expirado");
}

// --- 7. Un minuto antes del borde -> todavía no expiró ---
{
  const now = new Date("2026-01-02T00:00:00Z");
  const inventorySince = new Date(
    now.getTime() - (MANGO_EXPIRY_HOURS * 60 * 60 * 1000 - 60_000),
  ).toISOString();
  assertEqual(isMangoExpired(inventorySince, now), false, "23h59m atrás: todavía no expiró");
}

// --- 8. Recién entrado al inventario -> no expiró ---
{
  const now = new Date("2026-01-02T00:00:00Z");
  assertEqual(isMangoExpired(now.toISOString(), now), false, "recién entrado (0h): no expiró");
}

// --- 9. Mucho más viejo que el umbral -> expirado ---
{
  const now = new Date("2026-01-10T00:00:00Z");
  const inventorySince = new Date("2026-01-01T00:00:00Z").toISOString();
  assertEqual(isMangoExpired(inventorySince, now), true, "9 días atrás: expirado");
}

// === mangoExpiresAt ===

// --- 10. inventory_since + MANGO_EXPIRY_HOURS exacto ---
{
  const inventorySince = "2026-01-01T00:00:00.000Z";
  const result = mangoExpiresAt(inventorySince);
  const expected = new Date(
    new Date(inventorySince).getTime() + MANGO_EXPIRY_HOURS * 60 * 60 * 1000,
  ).toISOString();
  assertEqual(result, expected, "mangoExpiresAt: inventory_since + MANGO_EXPIRY_HOURS");
}

// --- 11. Consistencia con isMangoExpired: justo en mangoExpiresAt(), ya cuenta como expirado ---
{
  const inventorySince = "2026-01-01T00:00:00.000Z";
  const expiresAt = new Date(mangoExpiresAt(inventorySince));
  assertEqual(
    isMangoExpired(inventorySince, expiresAt),
    true,
    "mangoExpiresAt y isMangoExpired son consistentes en el borde exacto",
  );
}

// === computeBullyingBonusPercent ===

// --- 12. El primero le lanza al puesto 20 (ejemplo del usuario): 19 puestos de diferencia * BULLYING_BOUNCE_PERCENT_PER_RANK ---
{
  const result = computeBullyingBonusPercent(1, 20);
  assertEqual(
    result,
    19 * BULLYING_BOUNCE_PERCENT_PER_RANK,
    `rank 1 -> rank 20: 19 puestos * ${BULLYING_BOUNCE_PERCENT_PER_RANK}% = ${19 * BULLYING_BOUNCE_PERCENT_PER_RANK}%`,
  );
}

// --- 13. Mismo puesto (no debería poder pasar en la práctica, pero por las dudas) -> 0 ---
{
  assertEqual(computeBullyingBonusPercent(5, 5), 0, "mismo rank: sin bono");
}

// --- 14. Lanzarle a alguien MEJOR rankeado (para "arriba") -> 0, nunca negativo ---
{
  assertEqual(computeBullyingBonusPercent(10, 1), 0, "lanzar para arriba (rank 10 -> rank 1): sin bono, nunca negativo");
}

// --- 15. Un solo puesto de diferencia -> un solo BULLYING_BOUNCE_PERCENT_PER_RANK ---
{
  assertEqual(
    computeBullyingBonusPercent(3, 4),
    BULLYING_BOUNCE_PERCENT_PER_RANK,
    `un puesto de diferencia: ${BULLYING_BOUNCE_PERCENT_PER_RANK}%`,
  );
}

// --- 16. Sin rank de alguno de los dos (todavía sin partidas ranked) -> 0, no explota ---
{
  assertEqual(computeBullyingBonusPercent(null, 5), 0, "sin rank del lanzador: sin bono");
  assertEqual(computeBullyingBonusPercent(5, null), 0, "sin rank del objetivo: sin bono");
  assertEqual(computeBullyingBonusPercent(null, null), 0, "sin rank de ninguno: sin bono");
}

// === canLaunchMango (vacío legal: el rebote propio te puede sumar UN 4to, pero no más) ===

// --- 17. Con 0..MAX_ACTIVE_PENALTIES castigos activos propios -> puede lanzar ---
{
  for (let n = 0; n <= MAX_ACTIVE_PENALTIES; n++) {
    assertEqual(canLaunchMango(n), true, `con ${n} castigos activos (<= ${MAX_ACTIVE_PENALTIES}): puede lanzar`);
  }
}

// --- 18. Justo en el tope (3): TODAVÍA puede lanzar — así el rebote propio puede sumarle el 4to ---
{
  assertEqual(canLaunchMango(MAX_ACTIVE_PENALTIES), true, "en el tope exacto: puede lanzar (para que el rebote propio pueda pasar)");
}

// --- 19. Con MAX_ACTIVE_PENALTIES + 1 (el 4to, ya sumado por un rebote propio) -> bloqueado ---
{
  assertEqual(canLaunchMango(MAX_ACTIVE_PENALTIES + 1), false, "con el 4to ya sumado: bloqueado hasta bajar de nuevo");
}

// --- 20. Muy por encima del tope -> sigue bloqueado, no hay un techo mágico aparte ---
{
  assertEqual(canLaunchMango(MAX_ACTIVE_PENALTIES + 5), false, "muy por encima del tope: sigue bloqueado");
}

// === hoursFromNowIso ===

// --- 10. Devuelve un timestamp ~N horas en el futuro ---
{
  const before = Date.now();
  const result = new Date(hoursFromNowIso(5)).getTime();
  const after = Date.now();
  const expectedMin = before + 5 * 60 * 60 * 1000;
  const expectedMax = after + 5 * 60 * 60 * 1000;
  assertEqual(result >= expectedMin && result <= expectedMax, true, "hoursFromNowIso(5): cae dentro de la ventana esperada");
}

console.log(`\n${passed} pasaron, ${failed} fallaron`);
if (failed > 0) process.exit(1);

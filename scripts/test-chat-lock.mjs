// Test de la ventana de escritura del chat (src/lib/chat-lock.ts), sin red
// ni base de datos — mismo patrón que scripts/test-pickem.mjs.
//
//   node --experimental-strip-types scripts/test-chat-lock.mjs
//
import { isChatOpenAt } from "../src/lib/chat-lock.ts";
import { isPickemLockedAt } from "../src/lib/pickem-logic.ts";

let passed = 0;
let failed = 0;

function assertEqual(actual, expected, label) {
  if (actual === expected) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL: ${label}`);
    console.error(`  esperado: ${JSON.stringify(expected)}`);
    console.error(`  obtenido: ${JSON.stringify(actual)}`);
  }
}

const START = "2026-08-25T00:00:00Z";
const END = "2026-09-25T00:00:00Z";
const startMs = new Date(START).getTime();
const endMs = new Date(END).getTime();

assertEqual(isChatOpenAt(startMs - 1000, START, END), false, "1s antes del inicio -> cerrado");
assertEqual(isChatOpenAt(startMs, START, END), true, "justo en el inicio -> abierto");
assertEqual(isChatOpenAt(startMs + 1000, START, END), true, "1s después del inicio -> abierto");
assertEqual(isChatOpenAt(endMs - 1000, START, END), true, "1s antes del fin -> todavía abierto");
assertEqual(isChatOpenAt(endMs, START, END), false, "justo en el fin -> ya cerrado");
assertEqual(isChatOpenAt(endMs + 1000, START, END), false, "1s después del fin -> cerrado");

// El Pick'em ya NO se bloquea en el mismo instante en que arranca el
// torneo — tiene 3 días de gracia (PICKEM_LOCK_DATE = TOURNAMENT_START_DATE
// + 3 días, ver src/lib/config.ts) porque es algo casual para la
// comunidad, no parte de la competencia en sí. El chat, en cambio, sigue
// abriendo exactamente en TOURNAMENT_START_DATE sin cambios. Este test
// cruzado verifica que ambas fechas ahora se comportan de forma
// INDEPENDIENTE: durante la ventana de gracia el chat ya está abierto pero
// el Pick'em todavía no está bloqueado, y el bloqueo del Pick'em (en su
// propio instante) no afecta para nada al chat.
const PICKEM_LOCK = "2026-08-28T00:00:00Z"; // TOURNAMENT_START_DATE + 3 días
const pickemLockMs = new Date(PICKEM_LOCK).getTime();

assertEqual(
  isPickemLockedAt(startMs, PICKEM_LOCK),
  false,
  "en el inicio del torneo -> Pick'em todavía NO bloqueado (ventana de gracia de 3 días)",
);
assertEqual(
  isChatOpenAt(startMs, START, END),
  true,
  "en el inicio del torneo -> chat ya abierto (sin cambios)",
);

for (const offsetMs of [-2000, -1, 0, 1, 2000]) {
  const now = pickemLockMs + offsetMs;
  assertEqual(
    isPickemLockedAt(now, PICKEM_LOCK),
    offsetMs >= 0,
    `isPickemLockedAt cambia exactamente en PICKEM_LOCK_DATE (offset ${offsetMs}ms)`,
  );
  assertEqual(
    isChatOpenAt(now, START, END),
    true,
    `el chat sigue abierto en el instante de bloqueo del Pick'em (offset ${offsetMs}ms) — PICKEM_LOCK_DATE no lo afecta`,
  );
}

console.log(`\n${passed} pasaron, ${failed} fallaron`);
if (failed > 0) process.exit(1);

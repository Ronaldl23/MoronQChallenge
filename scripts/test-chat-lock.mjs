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

// El chat se ABRE en el mismo instante en que el Pick'em se BLOQUEA — las
// dos son consecuencias de "¿ya arrancó el torneo?" y usan el mismo
// boundary (now >= start, inclusive), aunque viven en módulos puros
// distintos (cada uno duplica su propia comparación de una sola línea a
// propósito, ver el comentario en src/lib/tournament-schedule.ts). Este
// test cruzado es lo que garantiza que ambas copias sigan de acuerdo en
// el instante exacto del cruce, no solo "parecido".
for (const offsetMs of [-2000, -1, 0, 1, 2000]) {
  const now = startMs + offsetMs;
  const chatConsidersStarted = isChatOpenAt(now, START, "2099-01-01T00:00:00Z");
  const pickemConsidersStarted = isPickemLockedAt(now, START);
  assertEqual(
    chatConsidersStarted,
    pickemConsidersStarted,
    `isChatOpenAt e isPickemLockedAt de acuerdo en el instante de inicio (offset ${offsetMs}ms)`,
  );
}

console.log(`\n${passed} pasaron, ${failed} fallaron`);
if (failed > 0) process.exit(1);

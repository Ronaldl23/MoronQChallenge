// Test de la ventana de escritura del chat (src/lib/chat-lock.ts), sin red
// ni base de datos — mismo patrón que scripts/test-pickem.mjs.
//
//   node --experimental-strip-types scripts/test-chat-lock.mjs
//
import { isChatOpenAt } from "../src/lib/chat-lock.ts";

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

console.log(`\n${passed} pasaron, ${failed} fallaron`);
if (failed > 0) process.exit(1);

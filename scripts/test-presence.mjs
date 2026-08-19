// Test del helper de presencia ("Online" en LaunchModal) — sin red ni base
// de datos, mismo patrón que scripts/test-quests.mjs.
//
//   node --experimental-strip-types scripts/test-presence.mjs
//
import { isOnline, ONLINE_WINDOW_MS } from "../src/lib/presence.ts";

let passed = 0;
let failed = 0;

function assertEqual(actual, expected, label) {
  const ok = actual === expected;
  if (ok) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL: ${label}`);
    console.error(`  esperado: ${expected}`);
    console.error(`  obtenido: ${actual}`);
  }
}

const NOW = new Date("2026-01-01T00:01:00.000Z").getTime();

assertEqual(isOnline(null, NOW), false, "sin last_seen_at (nunca hizo poll): offline");
assertEqual(
  isOnline(new Date(NOW - 1000).toISOString(), NOW),
  true,
  "hace 1s: online",
);
assertEqual(
  isOnline(new Date(NOW - ONLINE_WINDOW_MS + 1).toISOString(), NOW),
  true,
  "1ms antes del límite: online (borde inclusivo hacia adentro)",
);
assertEqual(
  isOnline(new Date(NOW - ONLINE_WINDOW_MS).toISOString(), NOW),
  false,
  "exactamente en el límite (45000ms): offline",
);
assertEqual(
  isOnline(new Date(NOW - ONLINE_WINDOW_MS - 1000).toISOString(), NOW),
  false,
  "1s después del límite: offline",
);
assertEqual(isOnline("no-es-una-fecha", NOW), false, "fecha inválida: offline, no explota");
assertEqual(ONLINE_WINDOW_MS, 45_000, "ONLINE_WINDOW_MS es 45s (regla confirmada por el usuario)");

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

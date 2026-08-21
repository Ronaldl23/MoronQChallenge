// Test de normalizeLoginCode() — sin red ni base de datos, mismo patrón que
// scripts/test-presence.mjs.
//
//   node --experimental-strip-types scripts/test-login-code.mjs
//
import { normalizeLoginCode } from "../src/lib/login-code.ts";

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

const STORED_CODE = "ABC123XY"; // como lo dejó el generador (ya en mayúsculas)

// Caso reportado: código editado a mano con minúsculas.
assertEqual(
  normalizeLoginCode("abc123xy"),
  STORED_CODE,
  "minúsculas: normaliza a mayúsculas y hace match contra lo guardado",
);

// Caso reportado: código copiado con espacios extra (típico al pegar desde
// un chat o una celda de spreadsheet).
assertEqual(
  normalizeLoginCode("  ABC123XY  "),
  STORED_CODE,
  "espacios extra al principio/final: se recortan (trim)",
);

// Combinación de ambos, más case mixto (edición manual descuidada).
assertEqual(
  normalizeLoginCode("  aBc123xY \n"),
  STORED_CODE,
  "case mixto + espacios/salto de línea: normaliza igual",
);

// Ya normalizado: no debería alterarse.
assertEqual(
  normalizeLoginCode(STORED_CODE),
  STORED_CODE,
  "código ya normalizado: sin cambios",
);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

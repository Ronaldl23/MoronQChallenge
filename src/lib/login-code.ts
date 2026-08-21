import { randomBytes } from "node:crypto";

/**
 * Sin 0/O/1/I/L — se comparten de palabra o por WhatsApp, y esos pares se
 * confunden fácil. 32 símbolos exactos para que `byte % 32` no tenga sesgo
 * (256 / 32 = 8 entero).
 */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const LENGTH = 8;

/** Código personal de acceso a /jugador — no es el mismo secreto que ADMIN_SECRET. */
export function generateLoginCode(): string {
  const bytes = randomBytes(LENGTH);
  let code = "";
  for (let i = 0; i < LENGTH; i++) {
    code += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return code;
}

/**
 * generateLoginCode() ya produce códigos en mayúsculas sin espacios por
 * construcción (ALPHABET), pero login_code también se puede editar a mano
 * desde el Table Editor de Supabase — ahí nada garantiza mayúsculas ni
 * recorta espacios. Normalizar el código ingresado en /api/jugador/login
 * con esta misma función antes de comparar es lo que hace que un código
 * copiado con case distinto o espacios de más siga haciendo match.
 */
export function normalizeLoginCode(code: string): string {
  return code.trim().toUpperCase();
}

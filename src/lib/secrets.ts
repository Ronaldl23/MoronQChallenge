import { createHash, timingSafeEqual } from "node:crypto";

/** Constant-time string comparison for secrets (avoids leaking length via timing). */
export function secretsMatch(a: string, b: string): boolean {
  const hashA = createHash("sha256").update(a).digest();
  const hashB = createHash("sha256").update(b).digest();
  return timingSafeEqual(hashA, hashB);
}

/**
 * Password hashing for Contrax — runtime-agnostic.
 *
 * The app runs on Bun locally and on Node (Vercel serverless) in production,
 * so `Bun.password.*` is NOT safe: it throws "Bun is not defined" on Vercel.
 * This module uses the global Web Crypto API (PBKDF2-SHA256), which exists in
 * Node 19+/20+ (Vercel's runtime), Bun, and browsers — no `node:` imports, so
 * it is safe to import from client-reachable route files without tripping
 * TanStack Start's import protection.
 *
 * Stored format: "pbkdf2$<salt-hex>$<hash-hex>" (salt 16B, hash 32B).
 *
 * Legacy hashes created with `Bun.password.hash` (argon2) can still be
 * verified when running under Bun via a fallback — useful for local dev and
 * the handful of pre-launch test accounts. On Node, legacy hashes simply
 * fail verification.
 */

const PBKDF2_ITERATIONS = 210_000;
const SALT_BYTES = 16;
const KEY_BYTES = 32;
const PREFIX = "pbkdf2";

const enc = new TextEncoder();

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
  return out;
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** Constant-time compare of two byte arrays. */
function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function derive(password: string, salt: Uint8Array, keyBytes: number): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    keyBytes * 8,
  );
  return new Uint8Array(bits);
}

/** Hash a password for storage. */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(password, salt, KEY_BYTES);
  return `${PREFIX}$${toHex(salt)}$${toHex(hash)}`;
}

/** Verify a password against a stored hash (pbkdf2$…, or legacy argon2 via Bun). */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length === 3 && parts[0] === PREFIX) {
    try {
      const salt = fromHex(parts[1]);
      const expected = fromHex(parts[2]);
      const derived = await derive(password, salt, expected.length);
      return timingSafeEqualBytes(derived, expected);
    } catch {
      return false;
    }
  }
  // Legacy: Bun argon2 hashes — only verifiable when running under Bun.
  const bunGlobal = (globalThis as { Bun?: { password?: { verify(p: string, h: string): Promise<boolean> } } }).Bun;
  if (bunGlobal?.password?.verify) {
    try {
      return await bunGlobal.password.verify(password, stored);
    } catch {
      return false;
    }
  }
  return false;
}

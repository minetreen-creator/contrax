/**
 * "Connect with Thumbtack" (owner 2026-10-22; Thumbtack partner ticket
 * PINT-4484, staging credentials issued 2026-10-22).
 *
 * A Thumbtack pro links their Thumbtack account (OAuth 2.0 authorization code
 * flow) so Contrax can read their business profile (name, services, service
 * area) and set up government-bid matching without a manual profile. Contrax
 * reads only; it never reads or answers leads, messages or reviews, never
 * writes to Thumbtack, and deletes the stored data when the pro disconnects —
 * the commitments made in the partner application.
 *
 * Env (Vercel project settings; nothing is hard-coded):
 *   THUMBTACK_CLIENT_ID, THUMBTACK_CLIENT_SECRET — issued by Thumbtack
 *   THUMBTACK_ENV            — "staging" (default) or "production"
 *   THUMBTACK_SCOPES         — space-separated scopes to request; default
 *                              THUMBTACK_DEFAULT_SCOPES (read-only, below)
 *   THUMBTACK_REDIRECT_URI   — defaults to https://www.contrax.company/auth/thumbtack/callback
 *   THUMBTACK_BUSINESSES_PATH — profile endpoint path (default /api/v4/businesses);
 *                              confirm against the partner API reference
 *   TOKEN_ENCRYPTION_KEY     — 32+ random bytes (any string); encrypts stored tokens
 *
 * Hosts (Thumbtack OAuth guide): auth.thumbtack.com / api.thumbtack.com, and
 * staging-auth.thumbtack.com / staging-api.thumbtack.com for staging.
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { sql } from "~/db";

/**
 * The scopes Contrax asks for: the read-only subset of what Thumbtack enabled
 * on our client (Gabe Isidro, Thumbtack, 2026-10-23). profile.read is the one
 * for business profile data; offline_access gives a refresh token. No write,
 * message or negotiation scopes: the partner application promises read-only.
 */
export const THUMBTACK_DEFAULT_SCOPES = "offline_access supply::businesses.list supply::businesses/profile.read supply::users.read";
/** Thumbtack requires this audience on the authorization request (same reply). */
export const THUMBTACK_AUDIENCE = "urn:partner-api";

export interface ThumbtackConfig {
  clientId: string;
  clientSecret: string;
  authBase: string;
  apiBase: string;
  scopes: string;
  redirectUri: string;
  businessesPath: string;
}

export function thumbtackConfig(env: Record<string, string | undefined> = process.env): ThumbtackConfig | null {
  const clientId = env.THUMBTACK_CLIENT_ID;
  const clientSecret = env.THUMBTACK_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  const prod = env.THUMBTACK_ENV === "production";
  return {
    clientId,
    clientSecret,
    authBase: prod ? "https://auth.thumbtack.com" : "https://staging-auth.thumbtack.com",
    apiBase: prod ? "https://api.thumbtack.com" : "https://staging-api.thumbtack.com",
    scopes: (env.THUMBTACK_SCOPES ?? "").trim() || THUMBTACK_DEFAULT_SCOPES,
    redirectUri: env.THUMBTACK_REDIRECT_URI || "https://www.contrax.company/auth/thumbtack/callback",
    businessesPath: env.THUMBTACK_BUSINESSES_PATH || "/api/v4/businesses",
  };
}

// ── Signed state (CSRF + which Contrax user started the connection) ──────────

const STATE_TTL_MS = 10 * 60 * 1000;

function stateKey(cfg: ThumbtackConfig): Buffer {
  return createHash("sha256").update(`thumbtack-state:${cfg.clientSecret}`).digest();
}

/** `userId.expiresMs.nonce.signature` — the nonce is also set as a cookie and must match. */
export function signState(cfg: ThumbtackConfig, userId: number, nonce: string, now = Date.now()): string {
  const body = `${userId}.${now + STATE_TTL_MS}.${nonce}`;
  const sig = createHmac("sha256", stateKey(cfg)).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyState(cfg: ThumbtackConfig, state: string, cookieNonce: string | null, now = Date.now()): number | null {
  const parts = state.split(".");
  if (parts.length !== 4) return null;
  const [uid, exp, nonce, sig] = parts as [string, string, string, string];
  const expected = createHmac("sha256", stateKey(cfg)).update(`${uid}.${exp}.${nonce}`).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  if (!cookieNonce || cookieNonce !== nonce) return null;
  if (!(Number(exp) > now)) return null;
  const userId = Number(uid);
  return Number.isSafeInteger(userId) && userId > 0 ? userId : null;
}

export const THUMBTACK_NONCE_COOKIE = "contrax_tt_nonce";

export function authorizeUrl(cfg: ThumbtackConfig, state: string): string {
  const q = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: "code",
    state,
    audience: THUMBTACK_AUDIENCE,
  });
  if (cfg.scopes) q.set("scope", cfg.scopes);
  return `${cfg.authBase}/oauth2/auth?${q.toString()}`;
}

// ── Token encryption at rest (AES-256-GCM) ───────────────────────────────────

function encKey(env: Record<string, string | undefined> = process.env): Buffer {
  const k = env.TOKEN_ENCRYPTION_KEY;
  if (!k || k.length < 32) throw new Error("TOKEN_ENCRYPTION_KEY is not set (32+ characters required)");
  return createHash("sha256").update(k).digest();
}

export function encryptToken(plain: string, env?: Record<string, string | undefined>): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", encKey(env), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `v1.${iv.toString("base64url")}.${c.getAuthTag().toString("base64url")}.${ct.toString("base64url")}`;
}

export function decryptToken(stored: string, env?: Record<string, string | undefined>): string {
  const [v, iv, tag, ct] = stored.split(".");
  if (v !== "v1" || !iv || !tag || !ct) throw new Error("Unrecognized token format");
  const d = createDecipheriv("aes-256-gcm", encKey(env), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
}

// ── Token endpoint ───────────────────────────────────────────────────────────

export interface ThumbtackTokens {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
}

async function tokenRequest(cfg: ThumbtackConfig, form: Record<string, string>, fetchImpl: typeof fetch): Promise<ThumbtackTokens> {
  const res = await fetchImpl(`${cfg.authBase}/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64")}`,
    },
    body: new URLSearchParams(form).toString(),
  });
  const body = (await res.json().catch(() => ({}))) as Partial<ThumbtackTokens> & { error?: string };
  if (!res.ok || !body.access_token) throw new Error(`Thumbtack token request failed (${res.status}${body.error ? `: ${body.error}` : ""})`);
  return body as ThumbtackTokens;
}

export function exchangeCode(cfg: ThumbtackConfig, code: string, fetchImpl: typeof fetch = fetch) {
  return tokenRequest(cfg, { grant_type: "authorization_code", code, redirect_uri: cfg.redirectUri }, fetchImpl);
}

export function refreshTokens(cfg: ThumbtackConfig, refreshToken: string, fetchImpl: typeof fetch = fetch) {
  return tokenRequest(cfg, { grant_type: "refresh_token", refresh_token: refreshToken }, fetchImpl);
}

// ── Business profile (read-only) ─────────────────────────────────────────────

/**
 * Read the connected business profile. The response is stored verbatim
 * (`profile` JSON) because the field names are confirmed against Thumbtack's
 * partner API reference before they are mapped to Contrax trades and states.
 * Never throws: a failed read leaves the connection in place.
 */
export async function fetchBusinessProfile(
  cfg: ThumbtackConfig,
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<unknown | null> {
  try {
    const res = await fetchImpl(`${cfg.apiBase}${cfg.businessesPath}`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    });
    if (!res.ok) {
      console.warn(`[thumbtack] business profile read failed: HTTP ${res.status}`);
      return null;
    }
    return await res.json();
  } catch (e) {
    console.warn("[thumbtack] business profile read failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

// ── Storage ──────────────────────────────────────────────────────────────────

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS thumbtack_connections (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    access_token_enc TEXT NOT NULL,
    refresh_token_enc TEXT,
    expires_at TIMESTAMPTZ,
    scopes TEXT,
    profile JSONB,
    connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;

async function ensureTable() {
  const db = sql();
  await db`${db.unsafe(CREATE_TABLE)}`;
}

export async function saveConnection(userId: number, tokens: ThumbtackTokens, profile: unknown | null): Promise<void> {
  await ensureTable();
  const expiresAt = tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000).toISOString() : null;
  const access = encryptToken(tokens.access_token);
  const refresh = tokens.refresh_token ? encryptToken(tokens.refresh_token) : null;
  const profileJson = profile == null ? null : JSON.stringify(profile);
  await sql()`
    INSERT INTO thumbtack_connections (user_id, access_token_enc, refresh_token_enc, expires_at, scopes, profile)
    VALUES (${userId}, ${access}, ${refresh}, ${expiresAt}, ${tokens.scope ?? null}, ${profileJson}::jsonb)
    ON CONFLICT (user_id) DO UPDATE SET
      access_token_enc = EXCLUDED.access_token_enc,
      refresh_token_enc = COALESCE(EXCLUDED.refresh_token_enc, thumbtack_connections.refresh_token_enc),
      expires_at = EXCLUDED.expires_at,
      scopes = EXCLUDED.scopes,
      profile = COALESCE(EXCLUDED.profile, thumbtack_connections.profile),
      updated_at = NOW()`;
}

export async function connectionStatus(userId: number): Promise<{ connected: boolean; connectedAt: string | null; hasProfile: boolean }> {
  await ensureTable();
  const rows = (await sql()`
    SELECT connected_at, profile IS NOT NULL AS has_profile FROM thumbtack_connections WHERE user_id = ${userId}
  `) as { connected_at: Date | string; has_profile: boolean }[];
  const r = rows[0];
  return { connected: Boolean(r), connectedAt: r ? new Date(r.connected_at).toISOString() : null, hasProfile: Boolean(r?.has_profile) };
}

/** Disconnect: delete every stored Thumbtack token and profile field for the user. */
export async function deleteConnection(userId: number): Promise<void> {
  await ensureTable();
  await sql()`DELETE FROM thumbtack_connections WHERE user_id = ${userId}`;
}

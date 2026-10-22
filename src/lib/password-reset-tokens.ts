import { sql } from "~/db";

// Migration-style DDL — idempotent, run before each insert so the table
// self-heals on any environment that hasn't applied it yet.
const CREATE_RESET_TOKENS_TABLE = `
  CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id SERIAL PRIMARY KEY,
    email TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    used BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )
`;

/** /forgot-password links last an hour. */
export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

/** The welcome email's "set your password" link for an account created by a
 *  paid checkout lasts a week: the buyer may not open it right away. */
export const SET_PASSWORD_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Issue a one-time token that /reset-password redeems (api/reset-password.ts
 * handleTokenReset) to set the password on the account for `email`.
 */
export async function issuePasswordResetToken(email: string, ttlMs: number): Promise<string> {
  const db = sql();
  // db.unsafe() is a fragment factory — inlines DDL safely when interpolated
  await db`${db.unsafe(CREATE_RESET_TOKENS_TABLE)}`;
  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + ttlMs);
  await db`
    INSERT INTO password_reset_tokens (email, token, expires_at)
    VALUES (${email}, ${token}, ${expiresAt.toISOString()})
  `;
  return token;
}

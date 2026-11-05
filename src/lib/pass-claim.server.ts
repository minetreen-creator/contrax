import { sql } from "~/db";
import { claimCanMovePass, passMovedAlert } from "~/lib/pass-claim";

/** See src/lib/pass-claim.ts (owner 2026-11-04). */
let ensured = false;
async function ensureTable(): Promise<void> {
  if (ensured) return;
  await sql()`CREATE TABLE IF NOT EXISTS pass_claims (
    token TEXT PRIMARY KEY,
    paid_user_id INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    claimed_at TIMESTAMPTZ,
    claimed_by INTEGER
  )`;
  ensured = true;
}

/** Record a claim for the account a guest checkout just paid for; returns its token. */
export async function createPassClaim(paidUserId: number): Promise<string> {
  await ensureTable();
  const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
  await sql()`INSERT INTO pass_claims (token, paid_user_id) VALUES (${token}, ${paidUserId})`;
  return token;
}

/**
 * Called right after /api/signup creates `newUserId` in a browser that holds a
 * claim. Moves a running $5 pass from the checkout-made account to the new one,
 * once. Returns true when it moved. Never throws into signup.
 */
export async function movePassOnSignup(token: string, newUserId: number, now: number = Date.now()): Promise<boolean> {
  try {
    await ensureTable();
    const [claim] = (await sql()`SELECT paid_user_id, created_at, claimed_at FROM pass_claims WHERE token = ${token}`) as {
      paid_user_id: number;
      created_at: string;
      claimed_at: string | null;
    }[];
    if (!claim) return false;
    const [paid] = (await sql()`SELECT id, email, plan_tier, starter_pass_bought_at, starter_pass_ends_at, stripe_customer_id
      FROM users WHERE id = ${claim.paid_user_id}`) as {
      id: number;
      email: string;
      plan_tier: string | null;
      starter_pass_bought_at: string | null;
      starter_pass_ends_at: string | null;
      stripe_customer_id: string | null;
    }[];
    if (!paid) return false;
    const [{ n: profiles }] = (await sql()`SELECT COUNT(*)::int AS n FROM business_profiles WHERE user_id = ${paid.id}`) as { n: number }[];
    const ok = claimCanMovePass({
      claimCreatedMs: new Date(claim.created_at).getTime(),
      claimed: !!claim.claimed_at,
      now,
      passEndsMs: paid.starter_pass_ends_at ? new Date(paid.starter_pass_ends_at).getTime() : null,
      paidAccountOnboarded: profiles > 0,
      sameAccount: paid.id === newUserId,
    });
    if (!ok) return false;
    // Claim it atomically so a double submit moves the pass once.
    const won = (await sql()`UPDATE pass_claims SET claimed_at = NOW(), claimed_by = ${newUserId}
      WHERE token = ${token} AND claimed_at IS NULL RETURNING token`) as unknown[];
    if (won.length === 0) return false;
    const [to] = (await sql()`UPDATE users SET
        plan_tier = ${paid.plan_tier ?? "starter"},
        subscription_status = 'active',
        trial_started_at = NULL,
        starter_pass_bought_at = ${paid.starter_pass_bought_at},
        starter_pass_ends_at = ${paid.starter_pass_ends_at},
        starter_pass_reminded_at = NULL,
        stripe_customer_id = COALESCE(stripe_customer_id, ${paid.stripe_customer_id})
      WHERE id = ${newUserId} RETURNING email`) as { email: string }[];
    await sql()`UPDATE users SET plan_tier = 'basic', subscription_status = NULL,
        starter_pass_ends_at = NULL, starter_pass_reminded_at = NULL
      WHERE id = ${paid.id}`;
    try {
      const { alertOwner } = await import("~/lib/live-push.server");
      await alertOwner(passMovedAlert(paid.email, to?.email ?? "the new account"));
    } catch (e) {
      console.error("[pass-claim] owner push failed:", (e as Error).message);
    }
    return true;
  } catch (e) {
    console.error("[pass-claim] move failed (signup unaffected):", (e as Error).message);
    return false;
  }
}

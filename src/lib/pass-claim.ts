/**
 * Pass claim (owner 2026-11-04): a buyer paid the $5 Starter pass with one
 * email, the checkout made an account for that email, and 44 seconds later the
 * same browser signed up with a work email — so the pass sat on an account they
 * never used and they saw the free version.
 *
 * /post-checkout now drops a one-day, httpOnly claim cookie when a guest
 * checkout made the paid account. If that browser then signs up with a
 * different email, /api/signup moves the pass onto the new account
 * (src/lib/pass-claim.server.ts) and alerts the owner.
 *
 * PURE: cookie name, parsing and the usable window.
 */
export const PASS_CLAIM_COOKIE = "contrax_pass_claim";
export const PASS_CLAIM_TTL_SECONDS = 24 * 60 * 60;

/** The claim token from a Cookie header, or null (32+ hex/uuid characters only). PURE. */
export function readClaimToken(cookieHeader: string | null | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === PASS_CLAIM_COOKIE) {
      const token = decodeURIComponent(v.join("=")).trim();
      return /^[0-9a-f-]{32,72}$/i.test(token) ? token : null;
    }
  }
  return null;
}

/** A claim moves a pass only once, within a day, and only while the pass runs. PURE. */
export function claimCanMovePass(args: {
  claimCreatedMs: number;
  claimed: boolean;
  now: number;
  passEndsMs: number | null;
  paidAccountOnboarded: boolean;
  sameAccount: boolean;
}): boolean {
  if (args.claimed || args.sameAccount || args.paidAccountOnboarded) return false;
  if (args.now - args.claimCreatedMs > PASS_CLAIM_TTL_SECONDS * 1000) return false;
  return args.passEndsMs != null && args.passEndsMs > args.now;
}

/** The owner's push when a pass moves. PURE. */
export function passMovedAlert(fromEmail: string, toEmail: string): { title: string; body: string; tag: string; url: string } {
  return {
    title: "$5 pass moved to the account they use",
    body: `Paid as ${fromEmail}, signed up as ${toEmail}. The pass is now on ${toEmail}.`,
    tag: "pass-moved",
    url: "/admin/signups",
  };
}

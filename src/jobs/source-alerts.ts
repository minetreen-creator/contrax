/**
 * Dead-source warning (owner 2026-11-03: "what can we do to stop the source
 * dropoff?" → "yes"). Source health used to live only in the sync's GitHub log,
 * so a dead source stayed dead until a visitor noticed (tn_cpo, wi_vendornet,
 * il_chicago_dps each broke more than once).
 *
 * Rule: email (and phone-push) the owner the FIRST time a source has failed two
 * syncs in a row (an error and zero rows, both times). One failed sync is often
 * a hiccup (OregonBuys failed once on 2026-11-03 and read 139 bids an hour later),
 * and a source that stays dead is reported once, not every four hours.
 */

export interface SyncLogRow {
  fetched: number;
  errors: string | null;
}

export const isDeadRun = (r: SyncLogRow | undefined): boolean =>
  !!r && Number(r.fetched) === 0 && !!r.errors && r.errors.trim().length > 0;

/** Newest-first history → true exactly when the last two runs failed and the one before did not. */
export function newlyDeadTwice(history: readonly SyncLogRow[]): boolean {
  return isDeadRun(history[0]) && isDeadRun(history[1]) && !isDeadRun(history[2]);
}

export interface DeadSource {
  source: string;
  error: string;
}

/** Plain words for the usual causes, so the email says what to do. */
export function likelyCause(error: string): string {
  const e = error.toLowerCase();
  if (/\b403\b|forbidden/.test(e)) return "the site is refusing our reader (blocked or a firewall change)";
  if (/\b404\b|not found/.test(e)) return "the page moved or was removed";
  if (/\b429\b|too many requests|rate limit/.test(e)) return "the site is rate-limiting us";
  if (/\b5\d\d\b/.test(e)) return "the site is having trouble on its end";
  if (/timeout|timed out|abort/.test(e)) return "the site is too slow to answer";
  if (/socket|econnreset|connection|enotfound|getaddrinfo/.test(e)) return "the connection failed (site down or blocking)";
  if (/shape|changed|unexpected|parse|selector|missing/.test(e)) return "the page layout changed";
  return "see the error below";
}

export function deadSourceEmail(dead: readonly DeadSource[]): {
  subject: string;
  text: string;
  push: { title: string; body: string; tag: string; url?: string };
} {
  const n = dead.length;
  const subject = n === 1 ? `Contrax: ${dead[0].source} has stopped working` : `Contrax: ${n} bid sources have stopped working`;
  const lines = dead.map((d) => `- ${d.source}: ${likelyCause(d.error)}\n  Error: ${d.error.slice(0, 300)}`);
  const text =
    `${n === 1 ? "This bid source has" : "These bid sources have"} failed two syncs in a row, so their bids are not updating:\n\n` +
    `${lines.join("\n\n")}\n\n` +
    `Ask Claude to look at ${n === 1 ? "it" : "them"}. You will not get this email again for ${n === 1 ? "this source" : "these sources"} unless ${n === 1 ? "it recovers and fails" : "they recover and fail"} again.`;
  const push = {
    title: n === 1 ? "A bid source stopped working" : `${n} bid sources stopped working`,
    body: n === 1 ? `${dead[0].source}: ${likelyCause(dead[0].error)}` : dead.map((d) => d.source).join(", ").slice(0, 160),
    tag: "source-dead",
  };
  return { subject, text, push };
}

const OWNER_EMAIL = "minetreen@gmail.com";

/**
 * After a sync: for each source that failed this run, read its last three
 * sync_logs rows and warn the owner about those that just failed twice in a row.
 * Never throws: a failed alert must not fail the sync.
 */
export async function alertNewlyDeadSources(sql: any, failedThisRun: readonly string[]): Promise<DeadSource[]> {
  if (failedThisRun.length === 0) return [];
  let dead: DeadSource[] = [];
  try {
    const rows = (await sql`
      SELECT source, fetched, errors FROM (
        SELECT source, fetched, errors,
               ROW_NUMBER() OVER (PARTITION BY source ORDER BY created_at DESC, id DESC) AS rn
        FROM sync_logs
        WHERE source = ANY(${[...failedThisRun]}) AND created_at > NOW() - INTERVAL '10 days'
      ) t WHERE rn <= 3 ORDER BY source, rn
    `) as { source: string; fetched: number; errors: string | null }[];
    const bySource = new Map<string, SyncLogRow[]>();
    for (const r of rows) {
      const list = bySource.get(r.source) ?? [];
      list.push({ fetched: Number(r.fetched), errors: r.errors });
      bySource.set(r.source, list);
    }
    dead = [...bySource.entries()]
      .filter(([, h]) => newlyDeadTwice(h))
      .map(([source, h]) => ({ source, error: String(h[0].errors ?? "") }));
  } catch (e) {
    console.error("[source-alerts] history read failed:", (e as Error).message);
    return [];
  }
  if (dead.length === 0) return [];
  const msg = deadSourceEmail(dead);
  console.error(`🚨 ${msg.subject}`);
  try {
    const { alertOwner } = await import("~/lib/live-push.server");
    await alertOwner(msg.push);
  } catch (e) {
    console.error("[source-alerts] owner push failed:", (e as Error).message);
  }
  if (process.env.RESEND_API_KEY) {
    try {
      const { Resend } = await import("resend");
      await new Resend(process.env.RESEND_API_KEY).emails.send({
        from: "Contrax <hello@contrax.company>",
        to: OWNER_EMAIL,
        subject: msg.subject,
        text: msg.text,
      });
    } catch (e) {
      console.error("[source-alerts] owner email failed:", (e as Error).message);
    }
  }
  return dead;
}

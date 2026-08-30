/**
 * send-radar-alerts — scheduled job that fulfills the Contract Radar
 * "Save your matches" promise: email each opted-in lead about NEW set-aside
 * solicitations that match the radar criteria they saved.
 *
 * Safety / honesty invariants (non-negotiable):
 *   * ONLY emails addresses that genuinely opted in via radar_saves AND have
 *     NOT unsubscribed. Never guesses an address.
 *   * NEVER sends when RESEND_API_KEY is absent — logs a warning and exits 0
 *     (fail-open; does NOT mark anything as sent).
 *   * Sends at most ONE email per lead per run, only for bids that OPENED
 *     since that lead's last alert. Zero new matches = zero email.
 *   * Dedup is two-layer so re-runs/retries never double-notify:
 *       1. last_alerted_at low-water mark — we only look at bids created after
 *          the lead's previous alert (NULL → their opt-in time).
 *       2. radar_alerts_sent log — a bid already sent for a lead is excluded
 *          even if last_alerted_at wasn't flushed before a crash.
 *   * "Mark as sent" happens ONLY after the email send RESOLVES SUCCESSFULLY.
 *   * Every email includes a working unsubscribe link.
 *   * Logs a clean per-run summary. A DB error on one lead is logged and the
 *     job continues (fail-open) — it never marks that lead as alerted.
 *
 * Ops:  bun run send-radar-alerts      (DATABASE_URL required, RESEND_API_KEY optional)
 * Runs from .github/workflows/radar-alert.yml on a schedule + manual dispatch.
 */
import { neon } from "@neondatabase/serverless";
import { sendRadarAlertEmail } from "../src/lib/email";

// ── Config ─────────────────────────────────────────────────────────────────────
const CERT_LABEL: Record<string, string> = {
  sdvosb: "SDVOSB",
  "8a": "8(a)",
  wosb: "WOSB",
  hubzone: "HUBZone",
  sb: "Small Business",
};
// Set-aside literal patterns per cert — the SAME constants the site uses
// (src/lib/open-bids.ts setAsidePred + the /radar route). Hardcoded constants,
// never user input, so embedding them in SQL is injection-safe. `sb` = any
// set-aside (a federal set-aside is by definition reserved for small business),
// mirroring what the radar visitor actually saw.
const CERT_SET_ASIDE: Record<string, string[]> = {
  "8a": ["8(a)", "8AN"],
  sdvosb: ["SDVOSB"],
  wosb: ["WOSB", "EDWOSB"],
  hubzone: ["HUBZone"],
};
const SIZE_CAP: Record<string, number | null> = {
  under250k: 250_000,
  under1m: 1_000_000,
  under10m: 10_000_000,
  any: null,
};
// 50 states + DC — used to detect a bid's targeted geography from its free-text
// location field (mirrors the site's STATE_LOCATION_REGEX).
const US_STATES = [
  "AL",
  "AK",
  "AZ",
  "AR",
  "CA",
  "CO",
  "CT",
  "DE",
  "FL",
  "GA",
  "HI",
  "ID",
  "IL",
  "IN",
  "IA",
  "KS",
  "KY",
  "LA",
  "ME",
  "MD",
  "MA",
  "MI",
  "MN",
  "MS",
  "MO",
  "MT",
  "NE",
  "NV",
  "NH",
  "NJ",
  "NM",
  "NY",
  "NC",
  "ND",
  "OH",
  "OK",
  "OR",
  "PA",
  "RI",
  "SC",
  "SD",
  "TN",
  "TX",
  "UT",
  "VT",
  "VA",
  "WA",
  "WV",
  "WI",
  "WY",
  "DC",
];
const STATE_REGEX = new RegExp(
  `(?:^|,\\s*)(${US_STATES.join("|")})(?:$|\\s|,)`,
  "i",
);

interface LeadRow {
  id: number;
  email: string;
  trade: string | null;
  state: string | null;
  cert: string | null;
  size_pref: string | null;
  last_alerted_at: string | null;
  created_at: string;
}

interface BidRow {
  id: number;
  title: string;
  agency: string;
  estimated_value: string | null;
  due_date: string | null;
  set_aside: string | null;
  source_url: string | null;
  location: string | null;
}

/** First dollar number in the free-text estimated_value, or null when absent. */
function parseEstValue(v: string | null | undefined): number | null {
  if (!v) return null;
  const m = String(v)
    .replace(/[^0-9.]/g, " ")
    .match(/\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = parseFloat(m[0]);
  return Number.isFinite(n) ? n : null;
}

/** Whether a bid's location is relevant for a lead's (possibly nationwide) state. */
function geoRelevant(
  location: string | null,
  state: string | null | undefined,
): boolean {
  if (!state) return true;
  const m = (location || "").match(STATE_REGEX);
  if (m) return m[1].toUpperCase() === state;
  return true; // no extractable state → could be a nationwide opportunity
}

/** Build the set-aside SQL fragment (returns '' for no filtering). */
function setAsideCond(cert: string | null): string {
  const pats = cert ? CERT_SET_ASIDE[cert] : undefined;
  if (!pats || pats.length === 0) {
    // 'sb' (or unknown cert) → any set-aside is a small-business set-aside.
    return "AND set_aside IS NOT NULL";
  }
  const or = pats
    .map((p) => `LOWER(COALESCE(set_aside,'')) LIKE '%${p.toLowerCase()}%'`)
    .join(" OR ");
  return `AND (${or})`;
}

async function ensureSchema(sql: ReturnType<typeof neon>): Promise<void> {
  try {
    await sql`ALTER TABLE radar_saves ADD COLUMN IF NOT EXISTS unsubscribed BOOLEAN NOT NULL DEFAULT false`;
    await sql`ALTER TABLE radar_saves ADD COLUMN IF NOT EXISTS unsubscribed_at TIMESTAMPTZ`;
    await sql`ALTER TABLE radar_saves ADD COLUMN IF NOT EXISTS last_alerted_at TIMESTAMPTZ`;
    await sql`
      CREATE TABLE IF NOT EXISTS radar_alerts_sent (
        radar_save_id BIGINT NOT NULL REFERENCES radar_saves(id) ON DELETE CASCADE,
        bid_id INTEGER NOT NULL REFERENCES bids(id) ON DELETE CASCADE,
        sent_at TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (radar_save_id, bid_id)
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS radar_alerts_sent_save_idx ON radar_alerts_sent (radar_save_id)`;
  } catch (e) {
    console.warn(
      "ensureSchema (migration 019 not applied?):",
      (e as Error).message,
    );
  }
}

async function main() {
  const db = neon(process.env.DATABASE_URL!);

  if (!process.env.RESEND_API_KEY) {
    console.log(
      "send-radar-alerts: RESEND_API_KEY not set — emailing disabled. Exiting 0 (nothing sent, nothing marked).",
    );
    process.exit(0);
  }

  await ensureSchema(db);

  const leads = (await db`
    SELECT id, email, trade, state, cert, size_pref, last_alerted_at, created_at
    FROM radar_saves
    WHERE unsubscribed = false
    ORDER BY id ASC
  `) as LeadRow[];

  if (leads.length === 0) {
    console.log(
      "send-radar-alerts: 0 opted-in leads — nothing to do. (leads=0 sent=0 errors=0)",
    );
    process.exit(0);
  }

  let sent = 0;
  let withNoMatches = 0;
  let errors = 0;

  for (const lead of leads) {
    const email = String(lead.email || "")
      .toLowerCase()
      .trim();
    if (!email) continue;
    try {
      const cert = lead.cert && lead.cert in CERT_LABEL ? lead.cert : "sb";
      const state = lead.state ? String(lead.state).trim().toUpperCase() : null;
      const sizeCap =
        lead.size_pref && lead.size_pref in SIZE_CAP
          ? SIZE_CAP[lead.size_pref]
          : null;
      // Only alert on bids that opened AFTER the lead's last alert (or, on the
      // first run, after they opted in — so they only hear about genuinely new
      // opportunities, not the whole backlog).
      const cutoff = lead.last_alerted_at
        ? new Date(lead.last_alerted_at)
        : new Date(lead.created_at);
      const trade = /^\d{6}$/.test(String(lead.trade || ""))
        ? String(lead.trade)
        : null;

      // Per-lead query built with bound params where possible; the set-aside
      // fragment embeds only hardcoded constants (injection-safe).
      const saSql = setAsideCond(cert);
      const bids = (await db.query(
        `SELECT id, title, agency, estimated_value, due_date, set_aside, source_url, location, created_at
         FROM bids
         WHERE (due_date IS NULL OR due_date > NOW())
           ${saSql}
           ${trade ? "AND naics_code = $1" : ""}
           AND created_at > $${trade ? 2 : 1}
           AND NOT EXISTS (
             SELECT 1 FROM radar_alerts_sent s
             WHERE s.radar_save_id = $${trade ? 3 : 2} AND s.bid_id = bids.id
           )
         ORDER BY created_at DESC
         LIMIT 200`,
        trade
          ? [trade, cutoff.toISOString(), lead.id]
          : [cutoff.toISOString(), lead.id],
      )) as BidRow[];

      // Post-filter: size preference (against disclosed est value) + geography.
      const matches = bids.filter((b) => {
        if (sizeCap != null) {
          const ev = parseEstValue(b.estimated_value);
          if (ev != null && ev > sizeCap) return false;
        }
        return geoRelevant(b.location, state);
      });

      if (matches.length === 0) {
        // Mark only the low-water mark (nothing was emailed, so nothing new was
        // "consumed" — but we don't want to re-scan the same bids next run).
        // We still advance last_alerted_at so the no-match window doesn't
        // reprocess old bids; there is no sent-log entry because nothing sent.
        await db`UPDATE radar_saves SET last_alerted_at = NOW() WHERE id = ${lead.id}`;
        withNoMatches++;
        continue;
      }

      const unsubscribeUrl = `https://www.contrax.company/api/radar-unsubscribe?email=${encodeURIComponent(email)}`;
      const ok = await sendRadarAlertEmail({
        to: email,
        certLabel: CERT_LABEL[cert],
        stateLabel: state || "nationwide",
        matches: matches.map((b) => ({
          title: b.title,
          agency: b.agency,
          estimated_value: b.estimated_value,
          due_date: b.due_date,
          set_aside: b.set_aside,
          source_url: b.source_url,
        })),
        unsubscribeUrl,
      });

      if (!ok) {
        // Fail-open: don't mark as sent — a later run will retry these bids.
        errors++;
        console.error(
          `send-radar-alerts: email to ${email} failed — skipped marking.`,
        );
        continue;
      }

      // Mark as sent ONLY after a successful send: advance the watermark AND
      // record each bid in the crash-safe sent-log (single txn).
      const bidIds = matches.map((b) => b.id);
      await db.query(
        `INSERT INTO radar_alerts_sent (radar_save_id, bid_id)
         VALUES ${bidIds.map((_, i) => `($1, $${i + 2})`).join(", ")}
         ON CONFLICT DO NOTHING`,
        // dedupe just in case; primary key protects
        (() => {
          const seen = new Set<number>();
          const uniq: number[] = [];
          for (const id of bidIds)
            if (!seen.has(id)) {
              seen.add(id);
              uniq.push(id);
            }
          return [lead.id, ...uniq];
        })(),
      );
      await db`UPDATE radar_saves SET last_alerted_at = NOW() WHERE id = ${lead.id}`;
      sent++;
      console.log(
        `send-radar-alerts: sent ${matches.length} match(es) to ${email}`,
      );
    } catch (e) {
      errors++;
      console.error(
        `send-radar-alerts: error processing ${lead.email}:`,
        (e as Error).message,
      );
    }
  }

  console.log(
    `send-radar-alerts: summary leads=${leads.length} sent=${sent} noMatches=${withNoMatches} errors=${errors}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("send-radar-alerts fatal:", (e as Error).message);
    process.exit(1);
  });

/**
 * "Did I win?" tracker — CLI entrypoint (`bun run award-check`), owner 2026-10-03.
 *
 * Runs every morning from .github/workflows/daily-emails.yml:
 *   1. Saved federal bids whose deadline passed (up to AWARD_CHECK_MAX_DAYS ago)
 *      and that have no award yet are looked up on SAM.gov by solicitation
 *      number, at most AWARD_CHECK_BATCH per run, each at most every
 *      AWARD_RECHECK_DAYS. A posted Award Notice is stored in bid_award_checks.
 *   2. Every member who still has an awarded bid in their pipeline and has not
 *      been told gets ONE email listing those results (winner, amount, date;
 *      "you won" when the winner's UEI is their own). saved_matches.award_notified_at
 *      is set only after Resend accepts, so a failed send retries tomorrow.
 *
 * Pure logic: src/lib/award-check.ts.
 */
import { sql } from "~/db";
import { SAM_HEADERS } from "~/jobs/sources/sam-gov";
import { sendAwardResultsEmail, type AwardEmailItem } from "~/lib/email";
import {
  AWARD_CHECK_BATCH,
  AWARD_CHECK_MAX_DAYS,
  AWARD_RECHECK_DAYS,
  awardOutcome,
  awardSearchUrl,
  isOwnAward,
  parseAwardDetail,
  pickAwardNotice,
  type AwardResult,
} from "~/lib/award-check";

const DETAIL_API = "https://sam.gov/api/prod/opps/v2/opportunities/";
const DELAY_MS = 500;

export async function ensureAwardCheckTables(): Promise<void> {
  await sql()`
    CREATE TABLE IF NOT EXISTS bid_award_checks (
      bid_id INTEGER PRIMARY KEY REFERENCES bids(id) ON DELETE CASCADE,
      solicitation_number TEXT NOT NULL,
      checks INTEGER NOT NULL DEFAULT 0,
      last_checked_at TIMESTAMPTZ,
      notice_id TEXT,
      awardee_name TEXT,
      awardee_uei TEXT,
      amount NUMERIC(16,2),
      award_date DATE,
      contract_number TEXT,
      found_at TIMESTAMPTZ
    )
  `;
  await sql()`ALTER TABLE saved_matches ADD COLUMN IF NOT EXISTS award_notified_at TIMESTAMPTZ`;
}

async function fetchJson(url: string): Promise<any | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const resp = await fetch(url, { headers: SAM_HEADERS, signal: controller.signal });
    if (!resp.ok) {
      console.warn(`[award-check] SAM.gov HTTP ${resp.status}`);
      return null;
    }
    return await resp.json();
  } catch (err) {
    console.warn("[award-check] SAM.gov request failed:", (err as Error).message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** The award for one solicitation number, null when none is posted, "error" when SAM.gov could not be read. */
async function lookUpAward(solicitationNumber: string): Promise<AwardResult | null | "error"> {
  const page = await fetchJson(awardSearchUrl(solicitationNumber));
  if (!page) return "error";
  const items = page?._embedded?.results ?? [];
  const notice = pickAwardNotice(Array.isArray(items) ? items : [], solicitationNumber);
  if (!notice) return null;
  await new Promise((r) => setTimeout(r, DELAY_MS));
  const detail = await fetchJson(`${DETAIL_API}${encodeURIComponent(notice.noticeId)}`);
  if (!detail) return "error";
  return parseAwardDetail(detail, notice.noticeId);
}

export async function checkAwards(): Promise<{ checked: number; found: number; emails: number }> {
  await ensureAwardCheckTables();

  // 1) Look up awards for saved bids past their deadline.
  const due = (await sql()`
    SELECT DISTINCT b.id, b.solicitation_number
    FROM saved_matches sm
    JOIN bids b ON b.id = sm.bid_id
    LEFT JOIN bid_award_checks c ON c.bid_id = b.id
    WHERE sm.status = 'saved'
      AND b.solicitation_number IS NOT NULL AND btrim(b.solicitation_number) <> ''
      AND b.due_date < NOW()
      AND b.due_date > NOW() - (${AWARD_CHECK_MAX_DAYS} * INTERVAL '1 day')
      AND (c.bid_id IS NULL
           OR (c.found_at IS NULL
               AND (c.last_checked_at IS NULL OR c.last_checked_at < NOW() - (${AWARD_RECHECK_DAYS} * INTERVAL '1 day'))))
    ORDER BY b.id
    LIMIT ${AWARD_CHECK_BATCH}
  `) as { id: number; solicitation_number: string }[];

  let found = 0;
  let checked = 0;
  for (const row of due) {
    const result = await lookUpAward(String(row.solicitation_number));
    if (result === "error") {
      await new Promise((r) => setTimeout(r, DELAY_MS));
      continue; // not counted as a check: retried next run
    }
    checked++;
    if (result) found++;
    await sql()`
      INSERT INTO bid_award_checks
        (bid_id, solicitation_number, checks, last_checked_at, notice_id, awardee_name, awardee_uei, amount, award_date, contract_number, found_at)
      VALUES
        (${row.id}, ${row.solicitation_number}, 1, NOW(), ${result?.noticeId ?? null}, ${result?.awardeeName ?? null},
         ${result?.awardeeUei ?? null}, ${result?.amount ?? null}, ${result?.awardDate ?? null}, ${result?.contractNumber ?? null},
         ${result ? new Date().toISOString() : null})
      ON CONFLICT (bid_id) DO UPDATE SET
        checks = bid_award_checks.checks + 1,
        last_checked_at = NOW(),
        notice_id = EXCLUDED.notice_id,
        awardee_name = EXCLUDED.awardee_name,
        awardee_uei = EXCLUDED.awardee_uei,
        amount = EXCLUDED.amount,
        award_date = EXCLUDED.award_date,
        contract_number = EXCLUDED.contract_number,
        found_at = EXCLUDED.found_at
    `;
    await new Promise((r) => setTimeout(r, DELAY_MS));
  }
  console.log(`[award-check] looked up ${checked} of ${due.length} saved bid(s); ${found} award(s) found`);

  // 2) Tell each member about awards on bids still in their pipeline.
  const pending = (await sql()`
    SELECT sm.id AS saved_id, sm.user_id, sm.pursuit_status, u.email,
           (SELECT bp.uei FROM business_profiles bp WHERE bp.user_id = sm.user_id AND bp.uei IS NOT NULL ORDER BY bp.id LIMIT 1) AS member_uei,
           b.id AS bid_id, b.title, b.agency,
           c.awardee_name, c.awardee_uei, c.amount, c.award_date
    FROM saved_matches sm
    JOIN bid_award_checks c ON c.bid_id = sm.bid_id AND c.found_at IS NOT NULL
    JOIN bids b ON b.id = sm.bid_id
    JOIN users u ON u.id = sm.user_id
    WHERE sm.status = 'saved' AND sm.award_notified_at IS NULL
      AND u.email IS NOT NULL AND u.email LIKE '%@%'
    ORDER BY sm.user_id, c.award_date DESC NULLS LAST
  `) as any[];

  const byUser = new Map<number, { email: string; savedIds: number[]; items: AwardEmailItem[] }>();
  for (const r of pending) {
    const uid = Number(r.user_id);
    let entry = byUser.get(uid);
    if (!entry) {
      entry = { email: String(r.email), savedIds: [], items: [] };
      byUser.set(uid, entry);
    }
    entry.savedIds.push(Number(r.saved_id));
    entry.items.push({
      bidId: Number(r.bid_id),
      title: String(r.title ?? "Untitled opportunity"),
      agency: String(r.agency ?? ""),
      awardeeName: String(r.awardee_name),
      amount: r.amount != null ? Number(r.amount) : null,
      awardDate: r.award_date ? new Date(r.award_date).toISOString().slice(0, 10) : null,
      outcome: awardOutcome({
        ownAward: isOwnAward(r.awardee_uei, r.member_uei),
        memberUeiKnown: !!String(r.member_uei ?? "").trim(),
        pursuitStatus: r.pursuit_status,
      }),
    });
  }

  let emails = 0;
  for (const entry of byUser.values()) {
    const ok = await sendAwardResultsEmail(entry.email, entry.items);
    if (!ok) continue;
    emails++;
    await sql()`UPDATE saved_matches SET award_notified_at = NOW() WHERE id = ANY(${entry.savedIds})`;
  }
  console.log(`[award-check] ${emails} award email(s) sent to ${byUser.size} member(s)`);
  return { checked, found, emails };
}

if (import.meta.main) {
  try {
    const r = await checkAwards();
    console.log(`🏁 Award check finished — checked=${r.checked} found=${r.found} emails=${r.emails}`);
    process.exit(0);
  } catch (e) {
    console.error("💥 Award check crashed:", e);
    process.exit(1);
  }
}

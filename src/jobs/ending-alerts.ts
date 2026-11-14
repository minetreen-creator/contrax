/**
 * Ending-contract alerts — CLI entrypoint (`bun run ending-alerts`), from
 * .github/workflows/ending-alerts.yml (owner 2026-11-14). Once a week it emails each confirmed,
 * not-unsubscribed alert subscriber the largest federal contracts in their trade and state that
 * have just come inside six months of ending. A contract is sent to a subscriber once
 * (ending_alerts_sent). Without APPLY=true it only prints what it would send.
 * Subscribers are the double-opt-in list the bid alerts use (radar_leads); every email carries
 * that list's one-click unsubscribe link.
 */
import { sql } from "~/db";
import { sendBasicEmail } from "~/lib/email";
import { ENDING_ALERT_DAYS, ENDING_ALERT_LOOKBACK_DAYS, ENDING_ALERT_PER_EMAIL, ENDING_ALERT_RUN_CAP, alertTradeFor, endingAlertEmail, type EndingRow } from "~/lib/ending-alerts";
import { ensureFederalTradeTables } from "~/lib/federal-trade-data.server";
import { STATE_NAMES } from "~/lib/contract-map";

async function main() {
  const apply = process.env.APPLY === "true";
  await ensureFederalTradeTables();
  const s = sql();
  await s`CREATE TABLE IF NOT EXISTS ending_alerts_sent (
    lead_id BIGINT NOT NULL,
    award_key TEXT NOT NULL,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (lead_id, award_key)
  )`;
  const leads = (await s`
    SELECT id, email, radar_profile, unsubscribe_token FROM radar_leads
    WHERE confirmed_at IS NOT NULL AND unsubscribed_at IS NULL AND consent = TRUE AND radar_profile IS NOT NULL
    ORDER BY id ASC`) as { id: number; email: string; radar_profile: { trade?: string | null; state?: string | null } | null; unsubscribe_token: string }[];
  let sent = 0, skipped = 0, nothing = 0;
  for (const lead of leads) {
    if (sent >= ENDING_ALERT_RUN_CAP) break;
    const state = (lead.radar_profile?.state ?? "").toUpperCase();
    const trade = alertTradeFor(lead.radar_profile?.trade);
    if (!trade || !STATE_NAMES[state]) { skipped++; continue; }
    try {
      const rows = (await s`
        SELECT * FROM (
          SELECT DISTINCT ON (c.award_key) c.award_key, c.recipient_name, c.amount::float AS amount,
                 to_char(c.end_date, 'YYYY-MM-DD') AS end_date, COALESCE(c.sub_agency, c.agency) AS agency
          FROM recompete_contracts c
          WHERE c.trade_slug = ${trade} AND c.pop_state = ${state}
            AND c.end_date <= CURRENT_DATE + ${ENDING_ALERT_DAYS}::int
            AND c.end_date > CURRENT_DATE + ${ENDING_ALERT_DAYS - ENDING_ALERT_LOOKBACK_DAYS}::int
            AND NOT EXISTS (SELECT 1 FROM ending_alerts_sent x WHERE x.lead_id = ${lead.id} AND x.award_key = c.award_key)
          ORDER BY c.award_key
        ) d ORDER BY amount DESC LIMIT ${ENDING_ALERT_PER_EMAIL}`) as EndingRow[];
      const mail = endingAlertEmail({
        state, trade, rows,
        unsubscribeUrl: `https://www.contrax.company/api/radar/lead-unsubscribe?token=${encodeURIComponent(lead.unsubscribe_token)}`,
      });
      if (!mail) { nothing++; continue; }
      if (!apply) { console.log(`[dry run] lead ${lead.id}: ${mail.subject}`); sent++; continue; }
      const ok = await sendBasicEmail({ to: lead.email, subject: mail.subject, html: mail.html, text: mail.text });
      if (!ok) { console.error(`lead ${lead.id}: send failed; nothing recorded, so it is retried next run`); continue; }
      for (const r of rows) await s`INSERT INTO ending_alerts_sent (lead_id, award_key) VALUES (${lead.id}, ${r.award_key}) ON CONFLICT DO NOTHING`;
      sent++;
    } catch (e) {
      // Never log the address.
      console.error(`lead ${lead.id}: failed (skipped):`, (e as Error).message);
    }
  }
  console.log(`\n🏁 Ending alerts${apply ? "" : " (dry run)"}: subscribers=${leads.length} emails=${sent} nothing-new=${nothing} no-trade-or-state=${skipped} cap=${ENDING_ALERT_RUN_CAP}`);
}

if (import.meta.main) {
  main()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error("💥 Ending alerts crashed:", e);
      process.exit(1);
    });
}

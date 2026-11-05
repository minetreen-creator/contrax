/**
 * Association weekly bid list — SAMPLES ONLY (owner 2026-11-05: "Do that").
 * Builds each association's ready-to-send list (src/lib/association-digest.ts)
 * from open bids due 3 to 45 days out and emails it to the OWNER, never to an
 * association. ASSOCIATION=<key> builds one; empty builds all.
 */
import { sql } from "~/db";
import { LOW_CONTENT_SQL } from "~/lib/low-content";
import { AWARD_EXCLUSION_SQL } from "~/lib/source-class";
import { ASSOCIATIONS, associationFor, buildSections, renderDigest, type DigestBid } from "~/lib/association-digest";

const OWNER_EMAIL = "minetreen@gmail.com";
const only = (process.env.ASSOCIATION ?? "").trim();
const targets = only ? [associationFor(only)].filter((a) => a != null) : [...ASSOCIATIONS];
if (only && targets.length === 0) throw new Error(`Unknown association "${only}". Known: ${ASSOCIATIONS.map((a) => a.key).join(", ")}`);

const s = sql();
const rows = (await s`
  SELECT id, title, agency, location, normalized_state AS state, category, due_date, estimated_value, set_aside
  FROM bids
  WHERE due_date > NOW() + INTERVAL '3 days' AND due_date < NOW() + INTERVAL '45 days'
    AND ${s.unsafe(LOW_CONTENT_SQL)} AND ${s.unsafe(AWARD_EXCLUSION_SQL)}
`) as any[];
const bids: DigestBid[] = rows.map((r) => ({ ...r, id: Number(r.id), due_date: new Date(r.due_date).toISOString() }));
console.log(`${bids.length} open bids due in 3-45 days`);

const { Resend } = await import("resend");
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
for (const cfg of targets) {
  const sections = buildSections(cfg, bids);
  const mail = renderDigest(cfg, sections, new Date());
  console.log(`${cfg.key}: ${mail.count} bids — ${sections.map((x) => `${x.category} ${x.bids.length}`).join(", ") || "none"}`);
  if (mail.count === 0) continue;
  if (!resend) {
    console.log("  (no RESEND_API_KEY: not sent)");
    continue;
  }
  const r = await resend.emails.send({
    from: "Contrax <hello@contrax.company>",
    to: OWNER_EMAIL,
    subject: `[Sample for ${cfg.name}] ${mail.subject}`,
    html: mail.html,
    text: mail.text,
  });
  console.log(r.error ? `  send failed: ${r.error.message}` : "  sample sent to the owner");
}
process.exit(0);

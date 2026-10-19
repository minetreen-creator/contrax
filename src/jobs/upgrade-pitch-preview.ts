/**
 * Upgrade-page pitch preview — CLI entrypoint (`bun run upgrade-pitch-preview`),
 * run by hand from .github/workflows/upgrade-pitch-preview.yml (owner
 * 2026-10-19). Prints what one account's /upgrade page would show in its
 * "your matches" box. Read-only.
 *
 * EMAIL may be a full address or the part before "@".
 */
import { sql } from "~/db";
import { loadUpgradePitch } from "~/lib/upgrade-pitch.server";
import { formatDollars, shortDate, tradePlace } from "~/lib/upgrade-pitch";

export async function upgradePitchPreview(email: string): Promise<void> {
  const needle = email.trim().toLowerCase();
  const pattern = needle.includes("@") ? needle : `${needle}@%`;
  const users = (await sql()`
    SELECT id, email, created_at FROM users WHERE LOWER(email) LIKE ${pattern} ORDER BY id LIMIT 3
  `) as { id: number; email: string; created_at: Date | string }[];
  if (!users.length) {
    console.log(`No account found for "${needle}".`);
    return;
  }
  for (const u of users) {
    const created = u.created_at instanceof Date ? u.created_at.toISOString() : String(u.created_at);
    const p = await loadUpgradePitch(u.id, created);
    console.log(`👤 ${u.email}`);
    if (!p) {
      console.log("  (pitch failed to load — the page shows plans only)");
      continue;
    }
    console.log(`  Since ${shortDate(p.since)}: ${p.newMatches} new bids matched ${tradePlace(p)}`);
    for (const b of p.examples) console.log(`    · ${b.title} — ${b.agency ?? "-"}${b.dueDate ? `, due ${shortDate(b.dueDate)}` : ""}`);
    console.log(`  Members-only now: ${p.headStart.count}${p.headStart.nextOpens ? ` (next opens ${shortDate(p.headStart.nextOpens)})` : ""}`);
    console.log(
      p.typicalAward
        ? `  Typical award: ${formatDollars(p.typicalAward.median)} over ${p.typicalAward.count} awards (${p.typicalAward.scope})`
        : "  Typical award: not shown (no NAICS codes or too few awards)",
    );
  }
}

if (import.meta.main) {
  try {
    await upgradePitchPreview(process.env.EMAIL ?? "");
    process.exit(0);
  } catch (e) {
    console.error("💥 Upgrade pitch preview crashed:", e);
    process.exit(1);
  }
}

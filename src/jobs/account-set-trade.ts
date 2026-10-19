/**
 * Set one account's trade and states — CLI entrypoint (`bun run account-set-trade`),
 * run by hand from .github/workflows/account-set-trade.yml (owner 2026-10-19:
 * the Denver trucking account skipped the trade questions at onboarding, so its
 * profile had no trade and 48 states; its trucks work across the central US).
 *
 * Updates business_profiles.industry, service_categories, naics_codes and
 * locations for ONE account matched by exact email. Prints the before and after.
 * Dry run unless APPLY=true.
 */
import { sql } from "~/db";

export interface TradeUpdate {
  industry: string;
  services: string[];
  naics: string[];
  states: string[];
}

const list = (v: string) => v.split(",").map((s) => s.trim()).filter(Boolean);

/** Validated update from the workflow inputs; throws on anything malformed. */
export function parseTradeUpdate(env: Record<string, string | undefined>): TradeUpdate {
  const industry = String(env.INDUSTRY ?? "").trim().slice(0, 120);
  const services = list(String(env.SERVICES ?? "")).map((s) => s.slice(0, 120)).slice(0, 10);
  const naics = list(String(env.NAICS ?? ""));
  const states = list(String(env.STATES ?? "")).map((s) => s.toUpperCase());
  if (!industry) throw new Error("INDUSTRY is required");
  if (naics.some((c) => !/^\d{6}$/.test(c))) throw new Error("NAICS must be six-digit codes");
  if (!states.length || states.some((s) => !/^[A-Z]{2}$/.test(s))) throw new Error("STATES must be two-letter codes");
  return { industry, services, naics, states: [...new Set(states)] };
}

export async function accountSetTrade(email: string, update: TradeUpdate, apply: boolean): Promise<void> {
  const users = (await sql()`SELECT id, email FROM users WHERE LOWER(email) = ${email.trim().toLowerCase()}`) as {
    id: number;
    email: string;
  }[];
  if (users.length !== 1) throw new Error(`Expected one account for that email, found ${users.length}`);
  const u = users[0];
  const before = (await sql()`
    SELECT id, industry, service_categories, naics_codes, locations
    FROM business_profiles WHERE user_id = ${u.id} ORDER BY id
  `) as Record<string, unknown>[];
  if (before.length !== 1) throw new Error(`Expected one business profile, found ${before.length}`);
  console.log(`👤 ${u.email}`);
  console.log("Before:", JSON.stringify(before[0]));
  console.log("After: ", JSON.stringify({ id: before[0].id, industry: update.industry, service_categories: update.services, naics_codes: update.naics, locations: update.states }));
  if (!apply) {
    console.log("Dry run. Re-run with apply = true to save.");
    return;
  }
  await sql()`
    UPDATE business_profiles
    SET industry = ${update.industry},
        service_categories = ${JSON.stringify(update.services)}::jsonb,
        naics_codes = ${JSON.stringify(update.naics)}::jsonb,
        locations = ${JSON.stringify(update.states)}::jsonb,
        updated_at = NOW()
    WHERE id = ${before[0].id as number}
  `;
  console.log("✅ Saved.");
}

if (import.meta.main) {
  try {
    const email = String(process.env.EMAIL ?? "").trim();
    if (!email.includes("@")) throw new Error("EMAIL must be a full address");
    await accountSetTrade(email, parseTradeUpdate(process.env), process.env.APPLY === "true");
    process.exit(0);
  } catch (e) {
    console.error("💥 Account set-trade failed:", e);
    process.exit(1);
  }
}

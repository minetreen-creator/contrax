/** Sub Finder storage, listed members, Trade Packages, responses and quote requests (src/lib/sub-finder.ts). */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { sql } from "~/db";
import { profileList } from "~/lib/autopilot";
import { profileStateCodes } from "~/lib/profile-match";
import {
  MAX_QUOTE_REQUESTS_PER_PACKAGE,
  MAX_RESPONSES_PER_PACKAGE_PER_DAY,
  matchListedSubs,
  packageSlug,
  quoteRequestEmail,
  responseEmail,
  toListedSub,
  type ListedSub,
  type PackageInput,
  type ResponseInput,
} from "~/lib/sub-finder";

const BASE = "https://www.contrax.company";

export async function ensureSubFinderTables(): Promise<void> {
  await sql()`ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS listed_for_primes BOOLEAN NOT NULL DEFAULT FALSE`;
  await sql()`
    CREATE TABLE IF NOT EXISTS trade_packages (
      id SERIAL PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      prime_user_id INTEGER NOT NULL,
      bid_id INTEGER,
      mega_slug TEXT,
      title TEXT NOT NULL,
      agency TEXT,
      trade TEXT NOT NULL,
      state TEXT,
      location TEXT,
      scope TEXT NOT NULL,
      quotes_due DATE,
      company TEXT NOT NULL,
      contact_name TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
  await sql()`
    CREATE TABLE IF NOT EXISTS trade_package_responses (
      id SERIAL PRIMARY KEY,
      package_id INTEGER NOT NULL REFERENCES trade_packages(id),
      company TEXT NOT NULL,
      contact_name TEXT,
      email TEXT NOT NULL,
      phone TEXT,
      certifications JSONB NOT NULL DEFAULT '[]'::jsonb,
      message TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
  await sql()`
    CREATE TABLE IF NOT EXISTS trade_package_requests (
      package_id INTEGER NOT NULL REFERENCES trade_packages(id),
      profile_id INTEGER NOT NULL,
      sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (package_id, profile_id)
    )`;
  // Subs Wanted board (owner 2026-11-10): a package is public only when its owner lists it.
  await sql()`ALTER TABLE trade_packages ADD COLUMN IF NOT EXISTS on_board BOOLEAN NOT NULL DEFAULT FALSE`;
}

/** What the package is for: a bid (public record) or a megaproject (public/data/megaprojects.json). */
export async function packageContext(q: { bid?: number | null; mega?: string | null }) {
  if (q.bid) {
    const rows = (await sql()`
      SELECT id, title, agency, location, normalized_state AS state, due_date FROM bids WHERE id = ${q.bid}
    `) as { id: number; title: string; agency: string | null; location: string | null; state: string | null; due_date: string | null }[];
    const b = rows[0];
    if (b) return { kind: "bid" as const, id: b.id, title: b.title, agency: b.agency, location: b.location ?? "", state: b.state, due: b.due_date ? new Date(b.due_date).toISOString().slice(0, 10) : null, href: `/bid/${b.id}` };
  }
  if (q.mega) {
    const { default: list } = (await import("../../public/data/megaprojects.json")) as { default: { slug: string; company: string; project: string; city: string; state: string }[] };
    const m = list.find((x) => x.slug === q.mega);
    if (m) return { kind: "mega" as const, slug: m.slug, title: `${m.company}: ${m.project}`, agency: m.company, location: `${m.city}, ${m.state}`, state: m.state, due: null, href: `/megaprojects/${m.slug}` };
  }
  return null;
}

/** Members who chose "List my business for primes", their first profile each. */
export async function listedSubs(): Promise<ListedSub[]> {
  await ensureSubFinderTables();
  const rows = (await sql()`
    SELECT DISTINCT ON (user_id) id, business_name, industry, service_categories, naics_codes, locations, certifications, years_in_business
    FROM business_profiles WHERE listed_for_primes AND user_id IS NOT NULL ORDER BY user_id, id ASC
  `) as Record<string, any>[];
  return rows.map((r) =>
    toListedSub({
      id: Number(r.id),
      business_name: r.business_name,
      industry: r.industry,
      service_categories: profileList(r.service_categories),
      naics_codes: profileList(r.naics_codes),
      states: profileStateCodes(profileList(r.locations)),
      certifications: profileList(r.certifications),
      years_in_business: r.years_in_business ?? null,
    }),
  );
}

export async function findSubs(q: { trade: string | null; state: string | null; cert: string | null }): Promise<ListedSub[]> {
  return matchListedSubs(await listedSubs(), q).slice(0, 50);
}

/** The signed-in member's listing state (their first profile). */
export async function myListing(userId: number): Promise<{ hasProfile: boolean; listed: boolean }> {
  await ensureSubFinderTables();
  const rows = (await sql()`SELECT listed_for_primes FROM business_profiles WHERE user_id = ${userId} ORDER BY id ASC LIMIT 1`) as { listed_for_primes: boolean }[];
  return { hasProfile: rows.length > 0, listed: Boolean(rows[0]?.listed_for_primes) };
}

export async function setListed(userId: number, listed: boolean): Promise<boolean> {
  await ensureSubFinderTables();
  const rows = (await sql()`
    UPDATE business_profiles SET listed_for_primes = ${listed}
    WHERE id = (SELECT id FROM business_profiles WHERE user_id = ${userId} ORDER BY id ASC LIMIT 1)
    RETURNING id
  `) as { id: number }[];
  return rows.length === 1;
}

function unlistKey(): Buffer {
  const secret = process.env.CRON_SECRET || process.env.RESEND_API_KEY || process.env.OUTREACH_SECRET;
  if (!secret) throw new Error("No secret to sign Sub Finder unlist links");
  return createHmac("sha256", "contrax-sub-finder-unlist").update(secret).digest();
}

export function unlistToken(profileId: number): string {
  return createHmac("sha256", unlistKey()).update(String(profileId)).digest("base64url").slice(0, 32);
}

/** One click from a quote request email: stop being listed. True when the link was valid. */
export async function unlistByToken(profileId: number, token: string): Promise<boolean> {
  const want = Buffer.from(unlistToken(profileId));
  const got = Buffer.from(String(token));
  if (want.length !== got.length || !timingSafeEqual(want, got)) return false;
  await ensureSubFinderTables();
  await sql()`UPDATE business_profiles SET listed_for_primes = FALSE WHERE id = ${profileId}`;
  return true;
}

export async function createPackage(primeUserId: number, ctx: Awaited<ReturnType<typeof packageContext>>, input: PackageInput) {
  await ensureSubFinderTables();
  const slug = packageSlug(randomBytes(10));
  const title = ctx?.title ?? `${input.trade} work${input.location ? ` in ${input.location}` : ""}`;
  await sql()`
    INSERT INTO trade_packages (slug, prime_user_id, bid_id, mega_slug, title, agency, trade, state, location, scope, quotes_due, company, contact_name, on_board)
    VALUES (${slug}, ${primeUserId}, ${ctx?.kind === "bid" ? ctx.id : null}, ${ctx?.kind === "mega" ? ctx.slug : null}, ${title}, ${ctx?.agency ?? null},
            ${input.trade}, ${input.state || ctx?.state || null}, ${input.location || ctx?.location || null}, ${input.scope}, ${input.quotesDue}, ${input.company}, ${input.contactName || null}, ${input.listOnBoard})
  `;
  return { slug, url: `${BASE}/trade-package/${slug}` };
}

export interface TradePackage {
  id: number;
  slug: string;
  primeUserId: number;
  bidId: number | null;
  megaSlug: string | null;
  title: string;
  agency: string | null;
  trade: string;
  state: string | null;
  location: string | null;
  scope: string;
  quotesDue: string | null;
  company: string;
  contactName: string | null;
  createdAt: string;
}

export async function getPackage(slug: string): Promise<TradePackage | null> {
  if (!/^[a-z2-9]{10}$/.test(slug)) return null;
  await ensureSubFinderTables();
  const rows = (await sql()`SELECT * FROM trade_packages WHERE slug = ${slug}`) as Record<string, any>[];
  const r = rows[0];
  if (!r) return null;
  return {
    id: Number(r.id), slug: r.slug, primeUserId: Number(r.prime_user_id), bidId: r.bid_id ?? null, megaSlug: r.mega_slug ?? null,
    title: r.title, agency: r.agency ?? null, trade: r.trade, state: r.state ?? null, location: r.location ?? null, scope: r.scope,
    quotesDue: r.quotes_due ? new Date(r.quotes_due).toISOString().slice(0, 10) : null, company: r.company, contactName: r.contact_name ?? null,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

/** The prime's own view: the responses to one of their packages. */
export async function packageResponses(pkg: TradePackage, viewerId: number | null) {
  if (viewerId == null || viewerId !== pkg.primeUserId) return null;
  return (await sql()`
    SELECT company, contact_name, email, phone, certifications, message, created_at FROM trade_package_responses
    WHERE package_id = ${pkg.id} ORDER BY created_at DESC LIMIT 200
  `) as { company: string; contact_name: string | null; email: string; phone: string | null; certifications: string[]; message: string | null; created_at: string }[];
}

export async function addResponse(pkg: TradePackage, input: ResponseInput): Promise<{ ok: boolean; error?: string }> {
  const today = (await sql()`SELECT COUNT(*)::int AS n FROM trade_package_responses WHERE package_id = ${pkg.id} AND created_at > NOW() - INTERVAL '1 day'`) as { n: number }[];
  if (Number(today[0]?.n ?? 0) >= MAX_RESPONSES_PER_PACKAGE_PER_DAY) return { ok: false, error: "This package has had many responses today. Please try again tomorrow or contact the prime directly." };
  await sql()`
    INSERT INTO trade_package_responses (package_id, company, contact_name, email, phone, certifications, message)
    VALUES (${pkg.id}, ${input.company}, ${input.contactName || null}, ${input.email}, ${input.phone || null}, ${JSON.stringify(input.certifications)}::jsonb, ${input.message || null})
  `;
  // Tell the prime (the member who made the package): transactional, to our own user.
  try {
    const u = (await sql()`SELECT email FROM users WHERE id = ${pkg.primeUserId}`) as { email: string }[];
    if (u[0]?.email) {
      const { sendBasicEmail } = await import("~/lib/email");
      const mail = responseEmail({ title: pkg.title, trade: pkg.trade, url: `${BASE}/trade-package/${pkg.slug}` }, input);
      await sendBasicEmail({ to: u[0].email, replyTo: input.email, ...mail });
    }
  } catch (e) {
    console.warn("[sub-finder] prime notification failed:", (e as Error).message);
  }
  return { ok: true };
}

/** Quote requests to listed members only (they opted in); each email carries the unlist link. */
export async function sendQuoteRequests(pkg: TradePackage, primeUserId: number, profileIds: number[]): Promise<{ sent: number; skipped: number }> {
  if (primeUserId !== pkg.primeUserId) return { sent: 0, skipped: profileIds.length };
  const already = (await sql()`SELECT COUNT(*)::int AS n FROM trade_package_requests WHERE package_id = ${pkg.id}`) as { n: number }[];
  const room = Math.max(0, MAX_QUOTE_REQUESTS_PER_PACKAGE - Number(already[0]?.n ?? 0));
  const wanted = [...new Set(profileIds.filter((n) => Number.isInteger(n) && n > 0))].slice(0, room);
  if (!wanted.length) return { sent: 0, skipped: profileIds.length };
  const rows = (await sql()`
    SELECT p.id, u.email FROM business_profiles p JOIN users u ON u.id = p.user_id
    WHERE p.id = ANY(${wanted}) AND p.listed_for_primes AND p.user_id <> ${primeUserId}
  `) as { id: number; email: string }[];
  const { sendBasicEmail } = await import("~/lib/email");
  let sent = 0;
  for (const r of rows) {
    const claimed = (await sql()`INSERT INTO trade_package_requests (package_id, profile_id) VALUES (${pkg.id}, ${r.id}) ON CONFLICT DO NOTHING RETURNING profile_id`) as unknown[];
    if (!claimed.length) continue;
    const mail = quoteRequestEmail(
      { title: pkg.title, trade: pkg.trade, company: pkg.company, location: pkg.location ?? "", quotesDue: pkg.quotesDue, url: `${BASE}/trade-package/${pkg.slug}` },
      `${BASE}/sub-finder/unlist?p=${r.id}&t=${unlistToken(Number(r.id))}`,
    );
    if (await sendBasicEmail({ to: r.email, ...mail })) sent++;
  }
  return { sent, skipped: profileIds.length - sent };
}

/** The prime's recent packages, for the Sub Finder page. */
export async function myPackages(userId: number) {
  await ensureSubFinderTables();
  return (await sql()`
    SELECT p.slug, p.title, p.trade, p.created_at, p.on_board, p.state, (SELECT COUNT(*)::int FROM trade_package_responses r WHERE r.package_id = p.id) AS responses
    FROM trade_packages p WHERE p.prime_user_id = ${userId} ORDER BY p.created_at DESC LIMIT 10
  `) as { slug: string; title: string; trade: string; created_at: string; on_board: boolean; state: string | null; responses: number }[];
}

/** The package's owner puts it on, or takes it off, the Subs Wanted board. Only the owner can. */
export async function setPackageOnBoard(userId: number, slug: string, on: boolean): Promise<boolean> {
  await ensureSubFinderTables();
  const rows = (await sql()`
    UPDATE trade_packages SET on_board = ${on}
    WHERE slug = ${slug} AND prime_user_id = ${userId} AND (${!on} OR state ~ '^[A-Z]{2}$')
    RETURNING id`) as unknown[];
  return rows.length > 0;
}

export interface BoardJob {
  slug: string;
  title: string;
  trade: string;
  state: string;
  location: string | null;
  scope: string;
  quotesDue: string | null;
  company: string;
  postedAt: string;
}

/**
 * Open jobs on the Subs Wanted board: listed by their owner, quotes not yet due (or no date), posted
 * in the last 90 days. Optionally one trade (its label) and one state. Empty when the table isn't there.
 */
export async function boardJobs(q: { trade?: string | null; state?: string | null; limit?: number }): Promise<BoardJob[]> {
  try {
    await ensureSubFinderTables();
    const s = sql();
    const tradePred = q.trade ? s`AND trade = ${q.trade}` : s``;
    const statePred = q.state ? s`AND state = ${q.state}` : s``;
    const rows = (await s`
      SELECT slug, title, trade, state, location, scope, quotes_due, company, created_at FROM trade_packages
      WHERE on_board AND state IS NOT NULL AND (quotes_due IS NULL OR quotes_due >= CURRENT_DATE)
        AND created_at > NOW() - INTERVAL '90 days' ${tradePred} ${statePred}
      ORDER BY created_at DESC LIMIT ${Math.min(q.limit ?? 100, 200)}
    `) as Record<string, any>[];
    return rows.map((r) => ({
      slug: r.slug,
      title: r.title,
      trade: r.trade,
      state: r.state,
      location: r.location ?? null,
      scope: String(r.scope ?? ""),
      quotesDue: r.quotes_due ? new Date(r.quotes_due).toISOString().slice(0, 10) : null,
      company: r.company,
      postedAt: new Date(r.created_at).toISOString(),
    }));
  } catch {
    return [];
  }
}

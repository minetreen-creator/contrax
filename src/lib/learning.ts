/**
 * Learning Engine — feeds win/loss history back into AI models.
 * Every outcome makes future predictions smarter.
 */
import { sql } from "~/db";

// ── Types ────────────────────────────────────────────────────────────────────────

export interface LearningOutcome {
  id: number;
  user_email: string;
  bid_title: string;
  agency: string;
  naics_code: string;
  estimated_value: string;
  won: boolean;
  notes: string;
  recorded_at: string;
}

export interface UserPatterns {
  total: number;
  wins: number;
  losses: number;
  winRate: number;
  byNaics: { code: string; total: number; wins: number; winRate: number }[];
  byAgency: { agency: string; total: number; wins: number; winRate: number }[];
  byValueRange: { range: string; total: number; wins: number; winRate: number }[];
  recentOutcomes: LearningOutcome[];
}

export interface ImplicitPreference {
  label: string;
  detail: string;
  saved: number;
  dismissed: number;
}

export interface AgencyPattern {
  agency: string;
  outcomes: number;
  wins: number;
  winRate: number;
  topNaics: string;
  topValueRange: string;
  insight: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────────

async function ensureTable() {
  await sql()`CREATE TABLE IF NOT EXISTS learning_outcomes (
    id SERIAL PRIMARY KEY,
    user_email TEXT NOT NULL,
    bid_title TEXT NOT NULL,
    agency TEXT NOT NULL,
    naics_code TEXT DEFAULT '',
    estimated_value TEXT DEFAULT '',
    won BOOLEAN NOT NULL,
    notes TEXT DEFAULT '',
    recorded_at TIMESTAMPTZ DEFAULT NOW()
  )`;
}

function estimateValueRange(value: string): string {
  const cleaned = value.replace(/[^0-9.]/g, "");
  const num = parseFloat(cleaned);
  if (isNaN(num) || num === 0) return "Unknown";
  if (num < 50000) return "Under $50K";
  if (num < 250000) return "$50K–$250K";
  if (num < 1000000) return "$250K–$1M";
  if (num < 5000000) return "$1M–$5M";
  return "Over $5M";
}

function naicsPrefix(code: string): string {
  return (code || "").trim().slice(0, 4);
}

// ── Public API ───────────────────────────────────────────────────────────────────

/** Record a win or loss outcome for the current user. */
export async function recordOutcome(
  userEmail: string,
  bidTitle: string,
  agency: string,
  naics: string,
  won: boolean,
  notes: string,
) {
  await ensureTable();
  await sql()`INSERT INTO learning_outcomes (user_email, bid_title, agency, naics_code, estimated_value, won, notes)
    VALUES (${userEmail}, ${bidTitle}, ${agency}, ${naics || ""}, ${"unknown"}, ${won}, ${notes || ""})`;
}

/** Record a win or loss with an estimated value. */
export async function recordOutcomeWithValue(
  userEmail: string,
  bidTitle: string,
  agency: string,
  naics: string,
  estimatedValue: string,
  won: boolean,
  notes: string,
) {
  await ensureTable();
  await sql()`INSERT INTO learning_outcomes (user_email, bid_title, agency, naics_code, estimated_value, won, notes)
    VALUES (${userEmail}, ${bidTitle}, ${agency}, ${naics || ""}, ${estimatedValue || ""}, ${won}, ${notes || ""})`;
}

/** Get the user's win/loss patterns from the learning engine. */
export async function getUserPatterns(userEmail: string): Promise<UserPatterns> {
  await ensureTable();
  const rows = await sql()`SELECT * FROM learning_outcomes WHERE user_email = ${userEmail} ORDER BY recorded_at DESC`;
  const outcomes: LearningOutcome[] = (rows as any[]).map((r) => ({
    id: Number(r.id),
    user_email: String(r.user_email),
    bid_title: String(r.bid_title),
    agency: String(r.agency),
    naics_code: String(r.naics_code || ""),
    estimated_value: String(r.estimated_value || ""),
    won: Boolean(r.won),
    notes: String(r.notes || ""),
    recorded_at: String(r.recorded_at),
  }));

  const total = outcomes.length;
  const wins = outcomes.filter((o) => o.won).length;
  const losses = total - wins;
  const winRate = total > 0 ? Math.round((wins / total) * 100) : 0;

  // By NAICS (group by first 4 digits)
  const naicsMap = new Map<string, { total: number; wins: number }>();
  for (const o of outcomes) {
    const prefix = naicsPrefix(o.naics_code);
    if (!prefix) continue;
    const entry = naicsMap.get(prefix) || { total: 0, wins: 0 };
    entry.total++;
    if (o.won) entry.wins++;
    naicsMap.set(prefix, entry);
  }
  const byNaics = [...naicsMap.entries()]
    .map(([code, { total: t, wins: w }]) => ({ code, total: t, wins: w, winRate: Math.round((w / t) * 100) }))
    .sort((a, b) => b.total - a.total);

  // By agency
  const agencyMap = new Map<string, { total: number; wins: number }>();
  for (const o of outcomes) {
    const a = o.agency.trim();
    if (!a) continue;
    const entry = agencyMap.get(a) || { total: 0, wins: 0 };
    entry.total++;
    if (o.won) entry.wins++;
    agencyMap.set(a, entry);
  }
  const byAgency = [...agencyMap.entries()]
    .map(([agency, { total: t, wins: w }]) => ({ agency, total: t, wins: w, winRate: Math.round((w / t) * 100) }))
    .sort((a, b) => b.total - a.total);

  // By value range
  const rangeMap = new Map<string, { total: number; wins: number }>();
  for (const o of outcomes) {
    const range = estimateValueRange(o.estimated_value);
    const entry = rangeMap.get(range) || { total: 0, wins: 0 };
    entry.total++;
    if (o.won) entry.wins++;
    rangeMap.set(range, entry);
  }
  const byValueRange = [...rangeMap.entries()]
    .map(([range, { total: t, wins: w }]) => ({ range, total: t, wins: w, winRate: Math.round((w / t) * 100) }))
    .sort((a, b) => b.total - a.total);

  return { total, wins, losses, winRate, byNaics, byAgency, byValueRange, recentOutcomes: outcomes.slice(0, 20) };
}

/** Infer preferences from the user's save/dismiss activity, independent of stated profile. */
export async function getImplicitPreferences(userEmail: string): Promise<ImplicitPreference[]> {
  try {
    const rows = await sql()`
      SELECT b.category, b.agency, b.estimated_value, COUNT(*) FILTER (WHERE sm.status IN ('saved','tracked','interested'))::int AS saved,
             COUNT(*) FILTER (WHERE sm.status IN ('dismissed','rejected','hidden'))::int AS dismissed
      FROM saved_matches sm JOIN users u ON u.id = sm.user_id JOIN bids b ON b.id = sm.bid_id
      WHERE u.email = ${userEmail} GROUP BY b.category, b.agency, b.estimated_value`;
    const categories = new Map<string, { saved: number; dismissed: number }>();
    const ranges = new Map<string, { saved: number; dismissed: number }>();
    for (const row of rows as any[]) {
      const saved = Number(row.saved || 0), dismissed = Number(row.dismissed || 0);
      const category = String(row.category || '').trim();
      if (category) { const x = categories.get(category) || { saved: 0, dismissed: 0 }; x.saved += saved; x.dismissed += dismissed; categories.set(category, x); }
      const range = estimateValueRange(String(row.estimated_value || ''));
      if (range !== 'Unknown') { const x = ranges.get(range) || { saved: 0, dismissed: 0 }; x.saved += saved; x.dismissed += dismissed; ranges.set(range, x); }
    }
    const preferences: ImplicitPreference[] = [];
    const topCategory = [...categories.entries()].sort((a,b) => b[1].saved - a[1].saved)[0];
    if (topCategory && topCategory[1].saved > 0) preferences.push({ label: topCategory[0], detail: `You saved ${topCategory[1].saved} ${topCategory[0]} bids but dismissed ${topCategory[1].dismissed}.`, saved: topCategory[1].saved, dismissed: topCategory[1].dismissed });
    const topRange = [...ranges.entries()].sort((a,b) => b[1].saved - a[1].saved)[0];
    if (topRange && topRange[1].saved > 0) preferences.push({ label: topRange[0], detail: `You saved ${topRange[1].saved} bids in this range (${topRange[1].dismissed} dismissed).`, saved: topRange[1].saved, dismissed: topRange[1].dismissed });
    return preferences;
  } catch { return []; }
}

/** Analyze anonymized, cross-user agency outcomes and market awards. */
export async function analyzeAgencyPatterns(): Promise<AgencyPattern[]> {
  try {
    const rows = await sql()`SELECT agency, naics_code, estimated_value, won FROM learning_outcomes WHERE NULLIF(TRIM(agency),'') IS NOT NULL`;
    const map = new Map<string, { outcomes: number; wins: number; naics: Map<string, number>; ranges: Map<string, number> }>();
    for (const row of rows as any[]) {
      const agency = String(row.agency).trim(); const x = map.get(agency) || { outcomes: 0, wins: 0, naics: new Map(), ranges: new Map() };
      x.outcomes++; if (row.won) x.wins++;
      const n = naicsPrefix(String(row.naics_code || '')); if (n) x.naics.set(n, (x.naics.get(n) || 0) + 1);
      const range = estimateValueRange(String(row.estimated_value || '')); if (range !== 'Unknown') x.ranges.set(range, (x.ranges.get(range) || 0) + 1);
      map.set(agency, x);
    }
    // Awards are intentionally optional: installations without the catalog still get outcomes intelligence.
    try { const awards = await sql()`SELECT agency, naics_code, award_amount FROM awarded_contracts WHERE NULLIF(TRIM(agency),'') IS NOT NULL`;
      for (const row of awards as any[]) { const agency = String(row.agency).trim(); const x = map.get(agency) || { outcomes: 0, wins: 0, naics: new Map(), ranges: new Map() }; const n = naicsPrefix(String(row.naics_code || '')); if (n) x.naics.set(n, (x.naics.get(n) || 0) + 1); const r = estimateValueRange(String(row.award_amount || '')); if (r !== 'Unknown') x.ranges.set(r, (x.ranges.get(r) || 0) + 1); map.set(agency, x); }
    } catch { /* awards catalog may not be installed yet */ }
    return [...map.entries()].map(([agency, x]) => { const top = (m: Map<string, number>) => [...m.entries()].sort((a,b) => b[1]-a[1])[0]?.[0] || '—'; const topNaics = top(x.naics), topValueRange = top(x.ranges); return { agency, outcomes: x.outcomes, wins: x.wins, winRate: x.outcomes ? Math.round(x.wins / x.outcomes * 100) : 0, topNaics, topValueRange, insight: x.outcomes ? `${agency} shows a ${Math.round(x.wins / x.outcomes * 100)}% observed win rate; activity concentrates in NAICS ${topNaics} and ${topValueRange}.` : `${agency} market awards concentrate in NAICS ${topNaics} and ${topValueRange}.` }; }).sort((a,b) => (b.outcomes - a.outcomes) || a.agency.localeCompare(b.agency)).slice(0, 20);
  } catch { return []; }
}

export const getAgencyIntelligence = analyzeAgencyPatterns;

/** Build a text summary of the user's learning history for use in AI prompts. */
export async function getLearningContext(
  userEmail: string,
  bidTitle: string,
  agency: string,
  naics: string,
  estimatedValue: string,
): Promise<string> {
  const [patterns, implicitPreferences, agencyPatterns] = await Promise.all([
    getUserPatterns(userEmail),
    getImplicitPreferences(userEmail),
    analyzeAgencyPatterns(),
  ]);
  if (patterns.total === 0 && implicitPreferences.length === 0 && agencyPatterns.length === 0) return "";

  const parts: string[] = [];
  if (implicitPreferences.length > 0) {
    parts.push(`Implicit preferences inferred from saved versus dismissed bids: ${implicitPreferences.map((p) => `${p.label} (${p.detail})`).join(" ")}`);
  }
  const agencyMatch = agencyPatterns.find((p) => p.agency.toLowerCase() === agency.toLowerCase());
  if (agencyMatch) parts.push(`Cross-user agency intelligence for ${agencyMatch.agency}: ${agencyMatch.insight}`);

  // Overall stats
  parts.push(`User's win/loss history: ${patterns.total} total bids tracked, ${patterns.wins} won (${patterns.winRate}% win rate).`);

  // NAICS match
  const bidNaicsPrefix = naicsPrefix(naics);
  if (bidNaicsPrefix) {
    const matchingNaics = patterns.byNaics.filter((n) => n.code === bidNaicsPrefix);
    if (matchingNaics.length > 0) {
      for (const n of matchingNaics) {
        parts.push(`NAICS ${n.code}: ${n.total} bids, ${n.wins} won (${n.winRate}% win rate).`);
      }
    }
  }

  // Agency match
  const matchingAgency = patterns.byAgency.filter((a) => a.agency.toLowerCase() === agency.toLowerCase());
  if (matchingAgency.length > 0) {
    for (const a of matchingAgency) {
      parts.push(`Agency ${a.agency}: ${a.total} bids, ${a.wins} won (${a.winRate}% win rate).`);
    }
  }

  // Value range match
  const range = estimateValueRange(estimatedValue);
  const matchingRange = patterns.byValueRange.filter((r) => r.range === range);
  if (matchingRange.length > 0) {
    for (const r of matchingRange) {
      parts.push(`Value range ${r.range}: ${r.total} bids, ${r.wins} won (${r.winRate}% win rate).`);
    }
  }

  // Top patterns
  const topNaics = patterns.byNaics.slice(0, 2);
  if (topNaics.length > 0) {
    parts.push(`Best NAICS codes: ${topNaics.map((n) => `${n.code} (${n.winRate}% win rate)`).join(", ")}.`);
  }

  const topAgencies = patterns.byAgency.filter((a) => a.winRate > 50).slice(0, 2);
  if (topAgencies.length > 0) {
    parts.push(`Best agencies: ${topAgencies.map((a) => `${a.agency} (${a.winRate}% win rate)`).join(", ")}.`);
  }

  return parts.join(" ");
}

/** Generate AI insights based on learning patterns. Returns 2-3 actionable recommendations. */
export async function generateInsights(userEmail: string): Promise<string[]> {
  const patterns = await getUserPatterns(userEmail);
  if (patterns.total < 2) return [];

  const prompt = `You are a government contracting strategy advisor. Analyze this small business's bid win/loss patterns and give 2-3 specific, actionable recommendations. Return ONLY a JSON array of strings, no markdown.

Win/loss data:
- Total: ${patterns.total} bids, ${patterns.wins} won (${patterns.winRate}% win rate)
- Best NAICS codes: ${patterns.byNaics.slice(0, 3).map((n) => `${n.code} (${n.winRate}%)`).join(", ") || "none"}
- Best agencies: ${patterns.byAgency.filter((a) => a.winRate > 50).slice(0, 3).map((a) => `${a.agency} (${a.winRate}%)`).join(", ") || "none"}
- Value range performance: ${patterns.byValueRange.map((r) => `${r.range}: ${r.winRate}%`).join(", ") || "no data"}
- Recent outcomes: ${patterns.recentOutcomes.slice(0, 5).map((o) => `${o.won ? "WON" : "LOST"}: ${o.bid_title} (${o.agency})`).join("; ") || "none"}

Each recommendation should be 1-2 sentences, specific and data-driven. Examples: "You win 80% of IT services bids under $100K — focus there" or "Your 0% win rate with DoD suggests avoiding defense contracts until you have past performance."

Return format: ["recommendation 1", "recommendation 2", "recommendation 3"]`;

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return [];

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: prompt }], max_tokens: 400, temperature: 0.5 }),
    });
    if (!response.ok) return [];
    const json = await response.json() as any;
    const content = json.choices?.[0]?.message?.content || "";
    const match = content.match(/\[[\s\S]*\]/);
    if (!match) return [];
    const arr = JSON.parse(match[0]);
    return Array.isArray(arr) ? arr.slice(0, 3).map(String) : [];
  } catch {
    return [];
  }
}

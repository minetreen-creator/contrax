import counties from "./counties.json";
export type County = { fips: string; state: string; name: string };
export const COUNTIES: readonly County[] = counties;
export function countyFor(fips: unknown): County | null {
  return typeof fips === "string"
    ? (COUNTIES.find((c) => c.fips === fips) ?? null)
    : null;
}
export function windowFor(today: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) throw new Error("Invalid day");
  const date = new Date(`${today}T00:00:00Z`);
  const end = new Date(date);
  end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(date);
  start.setUTCFullYear(start.getUTCFullYear() - 1);
  // Clamp leap-day rollover to the last day of February.
  if (start.getUTCMonth() !== date.getUTCMonth()) start.setUTCDate(0);
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}
export function filtersFor(county: County, start: string, end: string) {
  return {
    award_type_codes: ["A", "B", "C", "D"],
    time_period: [{ start_date: start, end_date: end }],
    place_of_performance_locations: [
      { country: "USA", state: county.state, county: county.fips.slice(2) },
    ],
  };
}
export const TRANSACTION_FIELDS = [
  "Award ID",
  "Recipient Name",
  "Recipient UEI",
  "Transaction Amount",
  "Action Date",
  "Mod",
  "NAICS",
  "generated_internal_id",
];
export type Action = {
  award: string;
  awardId: string;
  recipient: string;
  uei: string | null;
  naics: string;
  industry: string;
  cents: number;
};
export type Snapshot = {
  county: County;
  start: string;
  end: string;
  fetchedAt: string;
  actions: Action[];
  categoryCents: number;
};
export function cents(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new Error("Missing or invalid obligation amount");
  const n = Math.round(value * 100);
  if (!Number.isSafeInteger(n))
    throw new Error("Obligation exceeds safe numeric range");
  return n;
}
export function parseAction(
  row: Record<string, any>,
  start: string,
  end: string,
): Action {
  const day = row["Action Date"];
  if (typeof day !== "string" || day < start || day > end)
    throw new Error("Action outside requested window");
  const award = row.generated_internal_id;
  if (typeof award !== "string" || !award.startsWith("CONT_AWD_"))
    throw new Error("Missing contract award identity");
  return {
    award,
    awardId: String(row["Award ID"] || award),
    recipient: String(row["Recipient Name"] || "Recipient not reported"),
    uei:
      typeof row["Recipient UEI"] === "string" && row["Recipient UEI"].trim()
        ? row["Recipient UEI"].trim().toUpperCase()
        : null,
    naics: String(row.NAICS?.code || "unreported"),
    industry: String(row.NAICS?.description || "Industry not reported"),
    cents: cents(row["Transaction Amount"]),
  };
}
export function summarize(snapshot: Snapshot, naics?: string | null) {
  const actions = snapshot.actions.filter((a) => !naics || a.naics === naics);
  const awards = new Map<
    string,
    {
      id: string;
      awardId: string;
      recipient: string;
      cents: number;
      href: string;
    }
  >();
  const recipients = new Map<
    string,
    { uei: string; name: string; cents: number }
  >();
  const industries = new Map<
    string,
    { code: string; name: string; cents: number }
  >();
  for (const a of actions) {
    const award = awards.get(a.award) ?? {
      id: a.award,
      awardId: a.awardId,
      recipient: a.recipient,
      cents: 0,
      href: `https://www.usaspending.gov/award/${encodeURIComponent(a.award)}`,
    };
    award.cents += a.cents;
    awards.set(a.award, award);
    if (a.uei) {
      const r = recipients.get(a.uei) ?? {
        uei: a.uei,
        name: a.recipient,
        cents: 0,
      };
      r.cents += a.cents;
      recipients.set(a.uei, r);
    }
    const i = industries.get(a.naics) ?? {
      code: a.naics,
      name: a.industry,
      cents: 0,
    };
    i.cents += a.cents;
    industries.set(a.naics, i);
  }
  const byAmount = <T extends { cents: number }>(values: T[]) =>
    values.sort((a, b) => b.cents - a.cents);
  const allIndustries = new Map<string, string>();
  for (const a of snapshot.actions) allIndustries.set(a.naics, a.industry);
  return {
    county: snapshot.county,
    start: snapshot.start,
    end: snapshot.end,
    fetchedAt: snapshot.fetchedAt,
    totalCents: actions.reduce((sum, a) => sum + a.cents, 0),
    recipientCount: recipients.size,
    actionCount: actions.length,
    missingUeiActions: actions.filter((a) => !a.uei).length,
    negativeActions: actions.filter((a) => a.cents < 0).length,
    awards: byAmount([...awards.values()]).slice(0, 20),
    recipients: byAmount([...recipients.values()]).slice(0, 50),
    industries: byAmount([...industries.values()]).slice(0, 5),
    choices: [...allIndustries]
      .map(([code, name]) => ({ code, name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    naics: naics || null,
  };
}
export type LocalAwardsResult = ReturnType<typeof summarize>;

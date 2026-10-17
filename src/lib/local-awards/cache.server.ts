import { sql } from "~/db";
import { fetchSnapshot } from "./source.server";
import { windowFor, summarize, type County, type Snapshot } from "./model";
export async function ensureLocalAwards() {
  await sql()`CREATE TABLE IF NOT EXISTS local_award_snapshots (fips TEXT PRIMARY KEY, snapshot JSONB, fetched_at TIMESTAMPTZ, requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), refresh_started_at TIMESTAMPTZ, last_error TEXT)`;
}
export async function refreshCounty(
  county: County,
  signal?: AbortSignal,
): Promise<Snapshot> {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const { start, end } = windowFor(today);
  const snapshot = await fetchSnapshot(county, start, end, signal);
  await sql()`UPDATE local_award_snapshots SET snapshot=${JSON.stringify(snapshot)}::jsonb, fetched_at=NOW(), refresh_started_at=NULL, last_error=NULL WHERE fips=${county.fips}`;
  return snapshot;
}
export async function localAwards(
  county: County,
  naics: string | null,
  allowFetch: boolean,
) {
  await ensureLocalAwards();
  await sql()`INSERT INTO local_award_snapshots(fips) VALUES(${county.fips}) ON CONFLICT(fips) DO UPDATE SET requested_at=NOW()`;
  const rows =
    await sql()`SELECT snapshot, fetched_at FROM local_award_snapshots WHERE fips=${county.fips}`;
  const row = rows[0];
  const age = row?.fetched_at
    ? Date.now() - new Date(row.fetched_at).getTime()
    : Infinity;
  if (row?.snapshot && age < 24 * 3600000)
    return summarize(row.snapshot as Snapshot, naics);
  if (!allowFetch) throw new Error("Figures are not ready for this area.");
  // One cold refresh per county at a time. Stale data is explicitly dated;
  // failure never writes zeros or a partially fetched replacement.
  const lock =
    await sql()`UPDATE local_award_snapshots SET refresh_started_at=NOW() WHERE fips=${county.fips} AND (refresh_started_at IS NULL OR refresh_started_at<NOW()-INTERVAL '5 minutes') RETURNING fips`;
  if (lock.length) {
    try {
      return summarize(
        await refreshCounty(county, AbortSignal.timeout(45000)),
        naics,
      );
    } catch (e) {
      await sql()`UPDATE local_award_snapshots SET refresh_started_at=NULL,last_error=${(e as Error).message.slice(0, 400)} WHERE fips=${county.fips}`;
    }
  }
  if (row?.snapshot && age < 7 * 24 * 3600000)
    return summarize(row.snapshot as Snapshot, naics);
  throw new Error(
    "Figures are being prepared for this area. Please try again later.",
  );
}

import { sql } from "~/db";
import { countyFor, windowFor } from "~/lib/local-awards/model";
import {
  ensureLocalAwards,
  refreshCounty,
} from "~/lib/local-awards/cache.server";
import { fetchSnapshot } from "~/lib/local-awards/source.server";
const dry = process.argv.includes("--dry-run");
const seeds = ["51570", "51760", "51730"];
if (dry) {
  const { start, end } = windowFor(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date()),
  );
  for (const fips of seeds) {
    const data = await fetchSnapshot(countyFor(fips)!, start, end);
    console.log(
      JSON.stringify({
        fips,
        actions: data.actions.length,
        categoryCents: data.categoryCents,
        reconciled: true,
      }),
    );
  }
} else {
  await ensureLocalAwards();
  for (const fips of seeds)
    await sql()`INSERT INTO local_award_snapshots(fips) VALUES(${fips}) ON CONFLICT DO NOTHING`;
  const queue =
    await sql()`SELECT fips FROM local_award_snapshots WHERE (fetched_at IS NULL OR fetched_at<NOW()-INTERVAL '20 hours') AND requested_at>NOW()-INTERVAL '30 days' ORDER BY requested_at DESC LIMIT 20`;
  // USAspending sometimes drops connections for a minute or two (owner
  // 2026-10-22: two red runs in one day, each a burst of "socket connection was
  // closed" a few seconds apart). The per-request retries in source.server.ts
  // span ~1.5 s, so counties that fail get one more pass after a pause; the run
  // only fails when a county still fails then.
  const refresh = async (county: NonNullable<ReturnType<typeof countyFor>>, final: boolean) => {
    try {
      const s = await refreshCounty(county);
      console.log(
        JSON.stringify({
          fips: county.fips,
          actions: s.actions.length,
          obligationsCents: s.categoryCents,
          reconciled: true,
        }),
      );
      return true;
    } catch (e) {
      await sql()`UPDATE local_award_snapshots SET refresh_started_at=NULL,last_error=${(e as Error).message.slice(0, 400)} WHERE fips=${county.fips}`;
      console.error(`[local-awards-sync]${final ? "" : " (will retry)"}`, county.fips, (e as Error).message);
      return false;
    }
  };
  const retry: NonNullable<ReturnType<typeof countyFor>>[] = [];
  for (const row of queue) {
    const county = countyFor(row.fips);
    if (!county) continue;
    if (!(await refresh(county, false))) retry.push(county);
  }
  let failed = 0;
  if (retry.length) {
    await new Promise((resolve) => setTimeout(resolve, 60_000));
    for (const county of retry) if (!(await refresh(county, true))) failed++;
  }
  if (failed) process.exitCode = 1;
}

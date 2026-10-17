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
  let failed = 0;
  for (const row of queue) {
    const county = countyFor(row.fips);
    if (!county) continue;
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
    } catch (e) {
      failed++;
      await sql()`UPDATE local_award_snapshots SET refresh_started_at=NULL,last_error=${(e as Error).message.slice(0, 400)} WHERE fips=${county.fips}`;
      console.error("[local-awards-sync]", county.fips, (e as Error).message);
    }
  }
  if (failed) process.exitCode = 1;
}

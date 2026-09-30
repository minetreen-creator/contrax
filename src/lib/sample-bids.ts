import { createServerFn } from "@tanstack/react-start";
import { setAsidePred } from "~/lib/open-bids";
import { LOW_CONTENT_SQL } from "~/lib/low-content";
import { AWARD_EXCLUSION_SQL } from "~/lib/source-class";

// Live sample of REAL open SDVOSB set-asides, closing soonest but at least two
// days out so each one is still actionable. Used by the homepage hero card and
// the /bid-scout "what a Friday list looks like" example. Never throws: a
// failed query returns [] and callers hide the sample.
export type SampleBid = {
  id: number;
  title: string;
  agency: string | null;
  location: string | null;
  due_date: string | null;
  set_aside: string | null;
  source_url: string | null;
};

export const getSdvosbSample = createServerFn({ method: "GET" }).handler(
  async (): Promise<SampleBid[]> => {
    try {
      const { sql } = await import("~/db");
      const rows = (await sql()`
        SELECT DISTINCT ON (due_date, title, agency) id, title, agency, location, due_date, set_aside, source_url
        FROM bids
        WHERE due_date::date >= (NOW() + INTERVAL '2 days')::date
          ${setAsidePred("sdvosb", sql)}
          AND ${sql().unsafe(LOW_CONTENT_SQL)}
          AND ${sql().unsafe(AWARD_EXCLUSION_SQL)}
        ORDER BY due_date ASC, title, agency, id
        LIMIT 5
      `) as any[];
      return rows.map((r) => ({
        id: Number(r.id),
        title: String(r.title ?? ""),
        agency: r.agency ? String(r.agency) : null,
        location: r.location ? String(r.location) : null,
        due_date: r.due_date ? String(r.due_date) : null,
        set_aside: r.set_aside ? String(r.set_aside) : null,
        source_url: r.source_url ? String(r.source_url) : null,
      }));
    } catch {
      return [];
    }
  },
);

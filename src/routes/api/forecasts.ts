import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";

/** A Georgia DOT planned letting (source ga_gdot_lettings) as a forecast card. */
function dotLettingForecast(row: any, p: any) {
  return {
    id: `${row.source}:${row.external_id}`, title: String(row.title), description: String(row.description),
    fiscalYear: Number(row.fiscal_year), fiscalQuarter: String(row.fiscal_quarter ?? ""),
    agency: String(p.agency ?? ""), naics: "", city: p.county ? `${p.county} County` : "", state: String(p.state ?? ""), country: "",
    valueRange: typeof p.estimatedCost === "number" ? `About $${p.estimatedCost.toLocaleString("en-US")} (GDOT estimate)` : "",
    setAside: "", strategy: "", dateFlags: [] as string[],
    kind: "dot-letting" as const, letLabel: String(p.letLabel ?? ""), workType: String(p.workType ?? ""), letBy: String(p.letBy ?? ""),
    projectId: String(row.external_id), sourceUrl: String(p.sourceUrl ?? ""), processedOn: String(p.processedOn ?? ""),
  };
}

async function handler() {
  try {
    const rows = await sql()`SELECT source, external_id, title, description, fiscal_year, fiscal_quarter, payload
      FROM procurement_forecasts WHERE source IN ('commerce_faaps', 'dhs_apfs', 'ga_gdot_lettings')
      ORDER BY fiscal_year, fiscal_quarter, title`;
    const forecasts = rows.map((row: any) => {
      const p = row.payload ?? {};
      // Georgia DOT planned lettings (owner 2026-11-08): a state DOT forecast, shaped for the same cards.
      if (p.kind === "dot-letting") return dotLettingForecast(row, p);
      return {
        id: `${row.source}:${row.external_id}`, title: String(row.title), description: String(row.description),
        fiscalYear: Number(row.fiscal_year), fiscalQuarter: String(row.fiscal_quarter ?? ""),
        agency: String(p.Organization ?? ""), naics: String(p["Naics Code"] ?? ""),
        city: String(p["Place Of Performance City"] ?? ""), state: String(p["Place Of Performance State"] ?? ""),
        country: String(p["Place Of Performance Country"] ?? ""),
        valueRange: String(p["Estimated Value Range"] ?? ""),
        setAside: String(p["Anticipated Set Aside And Type"] ?? p["Type Of Awardee"] ?? ""),
        strategy: String(p["Competition Strategy"] ?? ""),
        dateFlags: Array.isArray(p.date_quality_flags) ? p.date_quality_flags : [],
      };
    });
    return Response.json({ forecasts, total: forecasts.length, snapshotDate: "2026-09-30" });
  } catch (error) {
    console.error("[forecasts] database read failed", { code: (error as { code?: string }).code, name: (error as Error).name });
    return Response.json({ error: "Procurement forecasts are temporarily unavailable." }, { status: 503 });
  }
}
export const Route = createFileRoute("/api/forecasts")({ server: { handlers: { GET: handler } } });

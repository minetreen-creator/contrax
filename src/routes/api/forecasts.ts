import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";

async function handler() {
  try {
    const rows = await sql()`SELECT external_id, title, description, fiscal_year, fiscal_quarter, payload
      FROM procurement_forecasts WHERE source = 'commerce_faaps'
      ORDER BY fiscal_year, fiscal_quarter, title`;
    const forecasts = rows.map((row: any) => {
      const p = row.payload ?? {};
      return {
        id: String(row.external_id), title: String(row.title), description: String(row.description),
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

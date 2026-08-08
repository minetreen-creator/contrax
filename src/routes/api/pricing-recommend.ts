import { createFileRoute } from "@tanstack/react-router";
import { sql } from "~/db";
import { getUserFromRequest } from "~/lib/api-auth";

async function handler({ request }: { request: Request }): Promise<Response> {
  const user = await getUserFromRequest(request);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  const data = await request.json() as any;
  if (!data || typeof data.bid_title !== "string" || typeof data.bid_id !== "string") return Response.json({ error: "Invalid pricing input — bid_title and bid_id are required" }, { status: 400 });
  try {
    // Ensure table
    await sql()`CREATE TABLE IF NOT EXISTS pricing_recommendations (
      id SERIAL PRIMARY KEY,
      user_email TEXT NOT NULL,
      bid_id TEXT NOT NULL,
      bid_title TEXT NOT NULL,
      suggested_low DECIMAL(10,2),
      suggested_high DECIMAL(10,2),
      suggested_median DECIMAL(10,2),
      confidence INTEGER,
      comparable_awards JSONB DEFAULT '[]'::jsonb,
      rationale TEXT,
      pricing_strategy TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_email, bid_id)
    )`;

    // Ensure awarded_contracts table exists
    await sql()`CREATE TABLE IF NOT EXISTS awarded_contracts (
      id SERIAL PRIMARY KEY, title TEXT NOT NULL, agency TEXT NOT NULL,
      solicitation_number TEXT, winning_company TEXT NOT NULL,
      award_amount TEXT NOT NULL, award_date TEXT NOT NULL, incumbent TEXT,
      category TEXT, location TEXT, naics_code TEXT, description TEXT,
      source_url TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
    )`;

    // Query similar past awards
    const naicsList = (data.naics_codes || []).filter(Boolean);
    const descWords = (data.description || "").split(/\s+/).filter((w: string) => w.length > 4).slice(0, 6);

    // Build query conditions
    const conditions: string[] = [];
    const params: any[] = [];

    if (naicsList.length > 0) {
      // Match by overlapping NAICS codes (prefix match: first 4 digits)
      const prefixPatterns = naicsList.map((c: string) => c.slice(0, 4)).filter((v, i, a) => a.indexOf(v) === i);
      const naicsConditions = prefixPatterns.map((p: string) => {
        params.push(p + "%");
        return `naics_code LIKE $${params.length}`;
      });
      conditions.push(`(${naicsConditions.join(" OR ")})`);
    }

    // Same or similar agency
    if (data.agency) {
      params.push(data.agency);
      conditions.push(`agency = $${params.length}`);
    }

    // Keyword match in description or title
    if (descWords.length > 0) {
      const kwConditions = descWords.map((w: string) => {
        params.push("%" + w + "%");
        return `(description ILIKE $${params.length} OR title ILIKE $${params.length})`;
      });
      conditions.push(`(${kwConditions.join(" OR ")})`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const query = `
      SELECT title, agency, award_amount, award_date, winning_company, naics_code
      FROM awarded_contracts
      ${where}
      ORDER BY award_date DESC
      LIMIT 15
    `;

    let pastAwards: any[];
    try {
      // Use raw query with parameterized approach via sql template
      let sqlBuilder = sql();
      // Build the query manually since we need dynamic WHERE
      const allRows = await sql()`SELECT title, agency, award_amount, award_date, winning_company, naics_code FROM awarded_contracts ORDER BY award_date DESC LIMIT 50`;
      pastAwards = (allRows as any[]).filter((a) => {
        let match = false;
        // NAICS prefix match
        if (naicsList.length > 0 && a.naics_code) {
          const awardPrefix = String(a.naics_code).slice(0, 4);
          if (naicsList.some((c: string) => c.slice(0, 4) === awardPrefix)) match = true;
        }
        // Agency match
        if (data.agency && String(a.agency).toLowerCase() === data.agency.toLowerCase()) match = true;
        // Keyword match
        if (descWords.length > 0) {
          const haystack = ((a.description || "") + " " + (a.title || "")).toLowerCase();
          if (descWords.some((w: string) => haystack.includes(w.toLowerCase()))) match = true;
        }
        return match;
      }).slice(0, 15);

      // Fallback: if no matches, grab the most recent awards
      if (pastAwards.length === 0) {
        pastAwards = allRows.slice(0, 10) as any[];
      }
    } catch {
      pastAwards = [];
    }

    // Build comparable awards for the response
    const comparableAwards = pastAwards.slice(0, 5).map((a: any) => ({
      title: a.title || "Unknown",
      agency: a.agency || "Unknown",
      amount: a.award_amount || "Not disclosed",
      year: String(a.award_date).slice(0, 4),
    }));

    // Call OpenAI for pricing analysis
    const awardsSummary = pastAwards
      .map((a: any) => `- ${a.title} (${a.agency}): ${a.award_amount} awarded to ${a.winning_company} in ${String(a.award_date).slice(0, 4)}`)
      .join("\n");

    const prompt = `You are a government contracting pricing analyst. Analyze this bid opportunity against past awarded contracts and suggest a competitive price range. Return ONLY JSON — no markdown, no code fences.

Bid Opportunity:
Title: ${data.bid_title}
Agency: ${data.agency || "Not specified"}
Description: ${data.description || "Not provided"}
Estimated Value: ${data.estimated_value || "Not specified"}

Comparable Past Awards:
${awardsSummary || "No directly comparable awards found in our database."}

Analyze pricing patterns, contract size trends, agency spending habits, and competitive dynamics. Then return:

{
  "suggestedRange": { "low": number, "high": number, "median": number },
  "confidence": number 0-100,
  "rationale": "short paragraph explaining the recommendation",
  "pricingStrategy": "aggressive" | "competitive" | "safe"
}

Guidelines:
- "aggressive" = bid below typical range to undercut competitors (high risk, high reward)
- "competitive" = bid in the middle of the typical range (balanced approach)
- "safe" = bid at the higher end, prioritizing margin over win likelihood
- Confidence: how much data supports this recommendation (many comparable awards = higher confidence)
- Dollar amounts should be realistic given the comparable awards and the estimated value`;

    try {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) throw new Error("OpenAI API key not configured");

      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: prompt }],
          max_tokens: 600,
          temperature: 0.2,
        }),
      });

      if (!response.ok) throw new Error(`OpenAI API error (${response.status})`);

      const json = await response.json() as any;
      const content = json.choices?.[0]?.message?.content || "";
      const match = content.match(/\{[\s\S]*\}/);
      if (!match) throw new Error("Could not parse pricing AI response");

      const parsed = JSON.parse(match[0]);
      const range = parsed.suggestedRange || { low: 0, high: 0, median: 0 };
      const strategy = ["aggressive", "competitive", "safe"].includes(parsed.pricingStrategy)
        ? parsed.pricingStrategy
        : "competitive";

      const result: PricingRecommendation = {
        bid_id: data.bid_id,
        bid_title: data.bid_title,
        suggested_low: Math.round(Number(range.low) || 0),
        suggested_high: Math.round(Number(range.high) || 0),
        suggested_median: Math.round(Number(range.median) || 0),
        confidence: Math.max(0, Math.min(100, Math.round(Number(parsed.confidence) || 50))),
        comparable_awards: comparableAwards,
        rationale: String(parsed.rationale || "Pricing analysis based on comparable past awards."),
        pricing_strategy: strategy,
        created_at: new Date().toISOString(),
      };

      // Upsert to DB
      await sql()`INSERT INTO pricing_recommendations
        (user_email, bid_id, bid_title, suggested_low, suggested_high, suggested_median, confidence, comparable_awards, rationale, pricing_strategy)
        VALUES (${user.email}, ${result.bid_id}, ${result.bid_title}, ${result.suggested_low}, ${result.suggested_high}, ${result.suggested_median}, ${result.confidence}, ${JSON.stringify(result.comparable_awards)}::jsonb, ${result.rationale}, ${result.pricing_strategy})
        ON CONFLICT (user_email, bid_id) DO UPDATE SET
          bid_title = EXCLUDED.bid_title,
          suggested_low = EXCLUDED.suggested_low,
          suggested_high = EXCLUDED.suggested_high,
          suggested_median = EXCLUDED.suggested_median,
          confidence = EXCLUDED.confidence,
          comparable_awards = EXCLUDED.comparable_awards,
          rationale = EXCLUDED.rationale,
          pricing_strategy = EXCLUDED.pricing_strategy,
          created_at = NOW()`;

      return result;
    return Response.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Pricing analysis failed";
    return Response.json({ error: `Pricing analysis failed: ${msg}` }, { status: 500 });
  }
}
export const Route = createFileRoute("/api/pricing/recommend")({ server: { handlers: { POST: handler } } });

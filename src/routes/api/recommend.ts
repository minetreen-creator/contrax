import { createFileRoute } from "@tanstack/react-router";
import { getUserFromRequest } from "~/lib/api-auth";
import { getLearningContext } from "~/lib/learning";
import { sql } from "~/db";

interface RecommendationInput {
  bid_title: string;
  bid_id: string;
  agency: string;
  description?: string;
  estimated_value?: string;
  naics_codes?: string[];
  user_profile?: unknown;
  win_probability?: number | null;
}

interface BidRecommendation {
  bid_id: string;
  bid_title: string;
  win_probability: number | null;
  effort_level: string;
  competition_level: string;
  strategic_fit: string;
  recommendation: "GO" | "NO_GO" | "CAUTIOUS";
  summary: string;
  factors: { factor: string; impact: string }[];
  created_at: string;
}

async function handler({ request }: { request: Request }) {
  try {
    const body = (await request.json().catch(() => null)) as RecommendationInput | null;
    if (
      !body ||
      typeof body.bid_title !== "string" ||
      typeof body.bid_id !== "string" ||
      typeof body.agency !== "string"
    ) {
      return Response.json({ error: "Invalid recommendation input" }, { status: 400 });
    }
    const user = await getUserFromRequest(request);
    if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
    await sql()`CREATE TABLE IF NOT EXISTS bid_recommendations (id SERIAL PRIMARY KEY, user_email TEXT NOT NULL, bid_id TEXT NOT NULL, bid_title TEXT NOT NULL, win_probability INTEGER, effort_level TEXT DEFAULT 'medium', competition_level TEXT DEFAULT 'medium', strategic_fit TEXT DEFAULT 'moderate', recommendation TEXT DEFAULT 'CAUTIOUS', summary TEXT DEFAULT '', factors JSONB DEFAULT '[]'::jsonb, created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(user_email, bid_id))`;
    const learningCtx = await getLearningContext(user.email, body.bid_title, body.agency, body.naics_codes?.[0] || "", body.estimated_value || "");
    const prompt = `You are an expert government contracting bid/no-bid advisor. Return ONLY JSON. Evaluate effort (RFP complexity/page count/specialized requirements), competition (agency type, contract size, set-aside hints), and strategic fit (NAICS, past awards, capabilities). Use exact enums: effort_level low|medium|high|extreme; competition_level low|medium|high; strategic_fit strong|moderate|weak; recommendation GO|NO_GO|CAUTIOUS. Return {recommendation, effort_level, competition_level, strategic_fit, summary, factors:[{factor,impact}]}.\nOpportunity: ${JSON.stringify(body)}\nProfile: ${JSON.stringify(body.user_profile || {})}\n\nLearned patterns from past wins/losses (use this to refine your recommendation):\n${learningCtx}`;
    const response = await fetch("https://api.openai.com/v1/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: prompt }], max_tokens: 700, temperature: 0.2 }) });
    if (!response.ok) throw new Error(`OpenAI API error (${response.status})`);
    const content = (await response.json() as any).choices?.[0]?.message?.content || ""; const match = content.match(/\{[\s\S]*\}/); if (!match) throw new Error("Could not parse recommendation");
    const p = JSON.parse(match[0]); const recommendation = ["GO", "NO_GO", "CAUTIOUS"].includes(p.recommendation) ? p.recommendation : "CAUTIOUS";
    const result: BidRecommendation = { bid_id: String(body.bid_id), bid_title: body.bid_title, win_probability: body.win_probability == null ? null : Number(body.win_probability), effort_level: ["low","medium","high","extreme"].includes(p.effort_level) ? p.effort_level : "medium", competition_level: ["low","medium","high"].includes(p.competition_level) ? p.competition_level : "medium", strategic_fit: ["strong","moderate","weak"].includes(p.strategic_fit) ? p.strategic_fit : "moderate", recommendation, summary: String(p.summary || "Review the opportunity details before deciding."), factors: Array.isArray(p.factors) ? p.factors.slice(0, 8).map((f: any) => ({ factor: String(f.factor || "Factor"), impact: String(f.impact || "neutral") })) : [], created_at: new Date().toISOString() };
    await sql()`INSERT INTO bid_recommendations (user_email,bid_id,bid_title,win_probability,effort_level,competition_level,strategic_fit,recommendation,summary,factors) VALUES (${user.email},${result.bid_id},${result.bid_title},${result.win_probability},${result.effort_level},${result.competition_level},${result.strategic_fit},${result.recommendation},${result.summary},${JSON.stringify(result.factors)}::jsonb) ON CONFLICT (user_email,bid_id) DO UPDATE SET bid_title=EXCLUDED.bid_title,win_probability=EXCLUDED.win_probability,effort_level=EXCLUDED.effort_level,competition_level=EXCLUDED.competition_level,strategic_fit=EXCLUDED.strategic_fit,recommendation=EXCLUDED.recommendation,summary=EXCLUDED.summary,factors=EXCLUDED.factors,created_at=NOW()`;
    return Response.json(result);
  } catch (err) {
    console.error("[api/recommend] error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to generate recommendation" },
      { status: 500 },
    );
  }
}

export const Route = createFileRoute("/api/recommend")({
  server: { handlers: { POST: handler } },
});

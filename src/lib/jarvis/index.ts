/**
 * Contrax Jarvis — ORCHESTRATOR (intent router + grounding prompt).
 *
 * Flow per request:
 *   1. `route()` deterministically maps the question to one READER (retrieval
 *      tool) based on its wording.
 *   2. The reader runs real, exclusions-applied SQL and returns a compact
 *      context bundle (`lines`) + `sources`.
 *   3. If the reader retrieved nothing (`empty`), we answer HONESTLY with no AI
 *      call — "I don't have data on that" — never fabricating.
 *   4. Otherwise we build a GROUNDING prompt whose only facts are the retrieved
 *      lines, call `callAI` (gpt-4o-mini) to compose a natural answer, and tag
 *      the response `grounded: true`.
 *
 * Read-only, admin-only, keys stay server-side (callAI reads OPENAI_API_KEY
 * from the server process; nothing here touches the client bundle).
 */
import { callAI, type AIMessage } from "~/lib/ai";
import {
  todayReader,
  signupReader,
  topVisitorsReader,
  closingBidsReader,
  outreachReader,
  problemReader,
  focusReader,
  type Reader,
  type ReaderResult,
} from "~/lib/jarvis/readers";

export interface JarvisResponse {
  answer: string;
  sources: string[];
  grounded: boolean;
}

const WINDOW_DEFAULT = 30;
const WINDOW_MAX = 90;

/** Parse a "N days" / "today" window hint from the question (clamped). */
function parseWindow(question: string, days: number): number {
  if (/today|\bhappened\b|\bsince (this )?morning\b|\b24 ?h/.test(question)) return 1;
  const m = question.match(/(\d{1,2})\s*(days?|d)\b/i);
  if (m) {
    const n = parseInt(m[1], 10);
    if (Number.isFinite(n) && n > 0) return Math.min(n, WINDOW_MAX);
  }
  return Math.min(Math.max(days, 1), WINDOW_MAX);
}

const RE = {
  focus: /\bshould\s+i\s+(focus|do|work|priorit|start)\b|prioriti|recommend|what\s+should|today\s+should|next\s+step/i,
  problem: /biggest\s+problem|problem\b|what('| i)?s?\s+wrong|biggest|top\s+risk|risk\b/i,
  closingBids: /closing\s+soon|opportunit|hvac|due\s+(soon|date)|closing|bid\b/i,
  signup: /sign\s*up|signing\s+up|signup|conversion|convert|why\s+aren|funnel/i,
  outreach: /outreach|source|attribut|lead\b|marketing|referr|paid\s+traffic|campaign|facebook/i,
  topVisitors: /visitor|high.?intent|who\s+(is|are)|top\s+(visitors|users|people|\d)|intent/i,
  today: /today|\bhappened\b|activity|recap|update/i,
};

/** Deterministic intent router → reader (or null when unrecognized). */
function route(question: string): Reader | null {
  const q = question.toLowerCase();
  if (RE.focus.test(q)) return focusReader;
  if (RE.problem.test(q)) return problemReader;
  if (RE.closingBids.test(q)) return closingBidsReader;
  if (RE.signup.test(q)) return signupReader;
  if (RE.outreach.test(q)) return outreachReader;
  if (RE.topVisitors.test(q)) return topVisitorsReader;
  if (RE.today.test(q)) return todayReader;
  return null;
}

const SYSTEM_PROMPT = `You are JARVIS, a READ-ONLY executive operating assistant for the Contrax CEO (a US government set-aside contract intelligence platform).

You answer ONLY from the RETRIEVED DATA provided below. CRITICAL GROUNDING RULES:
- Every number, count, percentage or proper noun you state MUST come verbatim from the retrieved data. NEVER invent a number, metric, bid, source, or fact.
- If the question asks for something the retrieved data does not contain, say plainly that you don't have that data rather than guessing.
- Distinguish FACTS from RECOMMENDATIONS: anything that is advice, a suggestion, or an opinion must be clearly labeled as a recommendation (e.g. "I'd recommend…", "A suggested focus would be…"). Never present a recommendation as an observed fact.
- Lean analysis and recommendations toward conversion, activation and revenue themes.
- If the data shows a suspicious signal (a traffic or activity spike, a 0% conversion, an obvious data gap), explicitly FLAG it — do not smooth it over.
- Keep it concise and plain-spoken; a few short paragraphs or bullets is ideal. Where a bid appears, include its agency and due date.`;

function buildGroundingPrompt(result: ReaderResult, question: string, days: number): AIMessage[] {
  const facts = result.lines.map((l) => `  • ${l}`).join("\n");
  const userContent = `Retrieved data for the last ${days} day(s) (${result.label}):
${facts}

Answer this question using ONLY the data above, applying the grounding rules:
QUESTION: ${question}`;
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userContent },
  ];
}

/**
 * Core entry point used by POST /api/jarvis. Returns { answer, sources, grounded }.
 * Perform a single, deterministic retrieval + grounded LLM composition.
 */
export async function askJarvis(question: string): Promise<JarvisResponse> {
  const clean = question.trim().slice(0, 500);
  if (!clean) {
    return { answer: "I didn't catch a question. Try the mic or type one below.", sources: [], grounded: false };
  }
  const now = new Date();
  const days = parseWindow(clean, WINDOW_DEFAULT);
  const fromIso = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();

  const reader = route(clean);
  if (!reader) {
    return {
      answer:
        "I don't have data on that yet. I can read your activity, signups, visitors, bids, and outreach only (V1 is read-only). Try one of these:\n• “What happened today?”\n• “Why aren't people signing up?”\n• “Show me the highest-intent visitors.”\n• “What HVAC opportunities are closing soon?”\n• “How is outreach performing?”\n• “What is the biggest problem right now?”\n• “What should I focus on today?”",
      sources: [],
      grounded: false,
    };
  }

  const result = await reader({ question: clean, fromIso, days, now });

  if (result.empty) {
    return {
      answer: `I don't have data on that for the last ${days} day(s) — ${result.sources.join("; ")} returned nothing, so I won't guess. Try a different question or a wider window.`,
      sources: result.sources,
      grounded: false,
    };
  }

  const answer = await callAI(buildGroundingPrompt(result, clean, days), {
    max_tokens: 600,
    temperature: 0.3,
  });
  return { answer, sources: result.sources, grounded: true };
}

/**
 * Shared AI helper — the single call path to OpenAI for every Contrax feature.
 *
 * Historically each AI call site (scoring, proposals, compliance, pricing,
 * loss analysis, insights, digest…) duplicated the same fetch/parse/validate
 * boilerplate against the chat completions endpoint. This module centralizes
 * that boilerplate so callers just supply messages and options.
 *
 * Deliberately thin and dependency-free: returns the raw content string so
 * each caller keeps its own JSON parsing / validation logic. Migration of the
 * existing call sites onto this helper happens incrementally.
 */

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const MODEL = "gpt-4o-mini";

export interface AIMessage {
  role: string;
  content: string;
}

export interface AIOptions {
  max_tokens?: number;
  temperature?: number;
  /** When true, asks the API for a strict JSON object via response_format. */
  jsonMode?: boolean;
}

/**
 * Calls the OpenAI chat completions endpoint and returns the raw assistant
 * content string. Throws a wrapped, human-readable error on any failure
 * (missing key, HTTP error, empty response) so callers can catch once.
 */
export async function callAI(
  messages: AIMessage[],
  opts: AIOptions = {},
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set");
  }

  const body: Record<string, unknown> = {
    model: MODEL,
    messages,
    max_tokens: opts.max_tokens ?? 800,
    temperature: opts.temperature ?? 0.5,
  };
  if (opts.jsonMode) {
    body.response_format = { type: "json_object" };
  }

  let response: Response;
  try {
    response = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new Error(`OpenAI request failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!response.ok) {
    const errBody = await response.text().catch(() => "");
    throw new Error(
      `OpenAI API error (${response.status}): ${errBody.substring(0, 300)}`,
    );
  }

  const json = (await response.json()) as {
    choices?: { message?: { content?: unknown } }[];
  };
  const content = json.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.trim().length === 0) {
    throw new Error("OpenAI returned an empty response");
  }
  return content;
}

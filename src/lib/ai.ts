/**
 * Shared AI helper — the single call path to OpenAI for every Contrax feature.
 */

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const MODEL = "gpt-4o-mini";
const EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";
const EMBEDDING_MODEL = "text-embedding-3-small";

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

export async function callAI(messages: AIMessage[], opts: AIOptions = {}): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
  const body: Record<string, unknown> = {
    model: MODEL,
    messages,
    max_tokens: opts.max_tokens ?? 800,
    temperature: opts.temperature ?? 0.5,
  };
  if (opts.jsonMode) body.response_format = { type: "json_object" };
  let response: Response;
  try {
    response = await fetch(OPENAI_URL, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` }, body: JSON.stringify(body),
    });
  } catch (err) {
    throw new Error(`OpenAI request failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!response.ok) throw new Error(`OpenAI API error (${response.status}): ${(await response.text().catch(() => "")).substring(0, 300)}`);
  const json = (await response.json()) as { choices?: { message?: { content?: unknown } }[] };
  const content = json.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw new Error("OpenAI returned an empty response");
  return content;
}

/** Generate a 1536-dimensional semantic embedding for text. */
export async function getEmbedding(text: string): Promise<number[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
  let response: Response;
  try {
    response = await fetch(EMBEDDINGS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: text }),
    });
  } catch (err) {
    throw new Error(`OpenAI embedding request failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!response.ok) throw new Error(`OpenAI embedding API error (${response.status}): ${(await response.text().catch(() => "")).substring(0, 300)}`);
  const json = (await response.json()) as { data?: { embedding?: unknown }[] };
  const embedding = json.data?.[0]?.embedding;
  if (!Array.isArray(embedding) || embedding.length !== 1536 || !embedding.every((n) => typeof n === "number")) {
    throw new Error("OpenAI returned an invalid embedding");
  }
  return embedding as number[];
}

/** Split long documents into overlapping chunks suitable for embedding input. */
export function chunkText(text: string, maxChars = 8000): string[] {
  if (maxChars < 2) throw new Error("maxChars must be at least 2");
  if (text.length <= maxChars) return text ? [text] : [];
  const overlap = Math.min(500, Math.floor(maxChars / 4));
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(text.length, start + maxChars);
    chunks.push(text.slice(start, end));
    if (end === text.length) break;
    start = end - overlap;
  }
  return chunks;
}

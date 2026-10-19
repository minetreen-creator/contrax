/**
 * Vercel Cron → GitHub workflow dispatch (owner 2026-10-12).
 *
 * WHY: GitHub's own `schedule:` triggers ran hours late or not at all
 * (2026-10-12: no Daily Emails run all day), while workflow_dispatch runs start
 * at once. Vercel Cron calls our route on time; the route asks GitHub to run the
 * workflow. The workflow keeps its own once-a-day gate, so a Vercel start and a
 * late GitHub schedule start can never both send.
 *
 * PURE except `dispatchWorkflow`, which takes an injectable fetch. No node
 * builtins (client-bundle protection, same as sync-far.ts).
 */

/** Constant-time string comparison (length is not secret). */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * True only for `Authorization: Bearer <CRON_SECRET>` (what Vercel Cron sends).
 * No query-string token and no fallback: an unset or empty secret rejects all.
 */
export function isAuthorizedCron(request: Request, secret: string | undefined): boolean {
  if (!secret) return false;
  const auth = request.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return false;
  return safeEqual(auth.slice("Bearer ".length).trim(), secret);
}

export interface DispatchOptions {
  token: string;
  /** "owner/repo" */
  repo: string;
  /** Workflow file name, e.g. "daily-emails.yml". */
  workflow: string;
  ref?: string;
  inputs?: Record<string, string>;
  fetchImpl?: typeof fetch;
}

/** Ask GitHub to run a workflow. GitHub answers 204 on success. */
export async function dispatchWorkflow(o: DispatchOptions): Promise<{ ok: boolean; status: number; detail: string }> {
  const f = o.fetchImpl ?? fetch;
  const url = `https://api.github.com/repos/${o.repo}/actions/workflows/${encodeURIComponent(o.workflow)}/dispatches`;
  try {
    const resp = await f(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${o.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
        "User-Agent": "contrax-cron",
      },
      body: JSON.stringify({ ref: o.ref ?? "main", inputs: o.inputs ?? {} }),
      signal: AbortSignal.timeout(20000),
    });
    if (resp.status === 204) return { ok: true, status: 204, detail: "dispatched" };
    const text = (await resp.text().catch(() => "")).slice(0, 300);
    return { ok: false, status: resp.status, detail: text || `HTTP ${resp.status}` };
  } catch (e) {
    return { ok: false, status: 0, detail: e instanceof Error ? e.message : String(e) };
  }
}

export const DAILY_EMAILS_REPO = "minetreen-creator/contrax";
export const DAILY_EMAILS_WORKFLOW = "daily-emails.yml";
export const SYNC_BIDS_WORKFLOW = "sync-bids.yml";
export const SAM_CSV_WORKFLOW = "sync-sam-csv.yml";

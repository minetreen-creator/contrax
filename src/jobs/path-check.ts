/**
 * Daily money-path check — CLI entrypoint (`bun run path-check`), run by
 * .github/workflows/path-check.yml every morning and by hand (owner
 * 2026-10-20). Fetches each page in PATH_CHECKS from production, stores the
 * results for /admin, prints them, and exits 1 when any check fails so the
 * workflow run turns red too.
 */
import { judge, PATH_CHECKS, type PathCheckResult } from "~/lib/path-checks";
import { saveRun } from "~/lib/path-checks.server";

const BASE = (process.env.BASE_URL || "https://www.contrax.company").replace(/\/$/, "");
const TIMEOUT_MS = 20_000;

export async function runPathChecks(): Promise<PathCheckResult[]> {
  const results: PathCheckResult[] = [];
  for (const c of PATH_CHECKS) {
    const t0 = Date.now();
    try {
      const res = await fetch(BASE + c.path, {
        method: c.method ?? "GET",
        body: c.body,
        headers: { "user-agent": "ContraxPathCheck/1.0 (+daily site check)", ...(c.body ? { "content-type": "application/json" } : {}) },
        redirect: "follow",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      results.push(judge(c, res.status, await res.text(), Date.now() - t0));
    } catch (e) {
      results.push(judge(c, null, "", null, e instanceof Error ? e.message : String(e)));
    }
  }
  return results;
}

if (import.meta.main) {
  try {
    const runAt = new Date().toISOString();
    const results = await runPathChecks();
    for (const r of results) console.log(`${r.ok ? "✅" : "❌"} ${r.name} (${r.path}) ${r.status ?? "-"} ${r.ms ?? "-"}ms${r.detail ? ` — ${r.detail}` : ""}`);
    if (process.env.DATABASE_URL) await saveRun(runAt, results);
    const failed = results.filter((r) => !r.ok).length;
    console.log(failed ? `\n${failed} of ${results.length} checks failed.` : `\nAll ${results.length} checks passed.`);
    process.exit(failed ? 1 : 0);
  } catch (e) {
    console.error("💥 Path check crashed:", e);
    process.exit(1);
  }
}

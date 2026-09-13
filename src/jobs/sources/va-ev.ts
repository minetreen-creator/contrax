/**
 * Virginia eVirginia Procurement Source — REPAIRED (owner 09-13).
 *
 * History: va-ev.ts was deleted and replaced by the generic per-state keyword
 * source (q=Virginia, 1 page). That replacement silently degraded VA coverage:
 *   - the generic source stops at 25 items and labels rows "Unknown"/scattered
 *     states (a VA-POP janitorial contract like "Custodial Services - Salem,
 *     VA" never surfaced as VA-local);
 *   - the old va_evirginia rows stopped updating 2026-08-29 (CRITICAL stale).
 *
 * Repair (verified live 2026-09-13): this source performs two SAM.gov passes
 * and REQUIRES a real VA place-of-performance from the authoritative v2 detail
 * endpoint before a row is accepted — it never labels with the query state:
 *   1. q=Virginia pass: keep items whose detail placeOfPerformance.state == VA
 *      (genuine Virginia-local federal work).
 *   2. q=janitorial pass: keep items whose detail POP == VA AND primary NAICS
 *      == 561720 (the owner-verified VA janitorial case; currently yields
 *      "Custodial Services - Salem, VA", setAside=SBA, due 2026-09-14).
 * Rows carry source='va_evirginia' (source_label passthrough = none), so the
 * older 231-row source identity is preserved and the staleness tier resets on
 * the next sync. NAICS + set-aside ride through from detail (honest
 * provenance), and location is the detail's own city/state — never a guess.
 */

import type { RawBid } from "./sam-gov";
import type { FetchResult } from "../runner";

const SAM_API = "https://sam.gov/api/prod/sgs/v1/search/";
const DETAIL_API = "https://sam.gov/api/prod/opps/v2/opportunities/";
const PAGE_SIZE = 25;
const DELAY_MS = 120;

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

type SamDetail = {
  data2?: {
    placeOfPerformance?: {
      city?: { name?: string };
      state?: { code?: string; name?: string };
    } | null;
    naics?: Array<{ code?: string | string[]; type?: string }>;
    solicitation?: { setAside?: string | null; naicsCode?: string | null };
  };
};

async function fetchDetail(noticeId: string): Promise<SamDetail | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const resp = await fetch(`${DETAIL_API}${noticeId}`, {
      headers: HEADERS,
      signal: controller.signal,
    });
    if (!resp.ok) return null;
    return (await resp.json()) as SamDetail;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function popState(d: SamDetail | null): string | null {
  return d?.data2?.placeOfPerformance?.state?.code ?? null;
}

function popCityState(d: SamDetail | null): string | null {
  const p = d?.data2?.placeOfPerformance;
  if (!p) return null;
  if (p.city?.name && p.state?.code) return `${p.city.name}, ${p.state.code}`;
  if (p.state?.code) return p.state.code;
  if (p.state?.name) return p.state.name;
  return null;
}

function primaryNaics(d: SamDetail | null): string | null {
  const a = d?.data2?.naics;
  if (!Array.isArray(a) || a.length === 0) return null;
  const rec = a.find((n) => n?.type === "primary") ?? a[0];
  const c = Array.isArray(rec?.code) ? rec.code[0] : rec?.code;
  const s = String(c ?? "").trim();
  return /^\d{6}$/.test(s) ? s : null;
}

function normalizeSetAside(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  if (!s || /false/i.test(s)) return null;
  return s;
}

function mapCategory(title: string, description: string): string {
  const full = (title + " " + description).toLowerCase();
  if (full.includes("janitor") || full.includes("custodial") || full.includes("housekeeping")) return "Janitorial";
  if (full.includes("clean") || full.includes("sanitat")) return "Cleaning";
  if (full.includes("construct") || full.includes("renovat") || full.includes("demolit")) return "Construction";
  return "Other";
}

/**
 * Cross-pass accounting context (owner 09-13 run-record). Each raw item is
 * examined exactly once (first pass that sees it wins, keyed by noticeId /
 * _id / solicitationNumber) so fetched = kept + skipped holds across the two
 * SAM.gov passes. kept is keyed by external_id (existing cross-pass dedupe);
 * skipped rows carry a diagnostic id + reason for the runner to print.
 */
interface PassCtx {
  examined: Map<string, boolean>;
  kept: Map<string, RawBid>;
  skipped: Record<string, number>;
  skippedRows: { id: string; reason: string }[];
}

async function queryPass(
  q: string,
  keep: (state: string | null, naics: string | null) => boolean,
  ctx: PassCtx,
): Promise<void> {
  for (let page = 0; page < 2; page++) {
    const url = `${SAM_API}?page=${page}&size=${PAGE_SIZE}&sort=-modifiedDate&mode=opportunities&q=${encodeURIComponent(q)}&is_active=true`;
    const resp = await fetch(url, { headers: HEADERS });
    if (!resp.ok) {
      console.error(`  va_evirginia: ${q} page ${page} -> HTTP ${resp.status}`);
      if (page > 0) break;
      continue;
    }
    const data = await resp.json();
    const items: any[] = data?._embedded?.results ?? [];
    if (items.length === 0) break;

    for (const [idx, item] of items.entries()) {
      const key = String(
        item.parentNoticeId || item._id || item.solicitationNumber || `page${page}-${idx}`,
      );
      // Count each raw item once across both passes (dedupe the overlap).
      if (ctx.examined.has(key)) continue;
      ctx.examined.set(key, true);
      try {
        const noticeId = item.parentNoticeId || item._id || "";
        const detail = noticeId ? await fetchDetail(noticeId) : null;
        await new Promise((r) => setTimeout(r, DELAY_MS));
        const state = popState(detail);
        const naics = primaryNaics(detail);
        // DATA HONESTY: a row is accepted ONLY on a REAL VA place-of-performance
        // (plus, for the janitorial pass, the 561720 code). Detail-fetch failures
        // (no POP) are counted as not_va_pop skips — location is never guessed
        // from the query. (not_va_pop is informational — NOT quality-gated.)
        if (!keep(state, naics)) {
          ctx.skipped["not_va_pop"] = (ctx.skipped["not_va_pop"] ?? 0) + 1;
          ctx.skippedRows.push({ id: key, reason: "not_va_pop" });
          continue;
        }

        const description = stripHtml(item.descriptions?.[0]?.content || "").substring(0, 2000);
        const orgs = item.organizationHierarchy || [];
        const deepest = orgs[orgs.length - 1];
        const agency = deepest?.name || orgs[0]?.name || "Virginia Agency";

        const externalId = `va-${item._id || item.solicitationNumber || key}`;
        ctx.kept.set(externalId, {
          external_id: externalId,
          title: item.title || "Untitled Opportunity",
          agency,
          description,
          location: popCityState(detail) ?? "Virginia",
          category: mapCategory(item.title || "", description),
          due_date: item.responseDate || item.responseDateActual || null,
          estimated_value: item.award?.amount ? `${Number(item.award.amount).toLocaleString()}` : "Not specified",
          source_url: noticeId ? `https://sam.gov/opp/${noticeId}/view` : "https://sam.gov/search/",
          set_aside: normalizeSetAside(detail?.data2?.solicitation?.setAside),
          naics_code: naics,
        });
      } catch (e) {
        console.error(`  va_evirginia: item parse error:`, (e as Error).message);
        ctx.skipped["parse_error"] = (ctx.skipped["parse_error"] ?? 0) + 1;
        ctx.skippedRows.push({ id: key, reason: "parse_error" });
      }
    }
    console.log(
      `  va_evirginia: ${q} page ${page + 1}: ${items.length} items, cumulative kept ${ctx.kept.size}`,
    );
    if (items.length < PAGE_SIZE) break;
  }
}

/** Restored + repaired eVirginia source: VA-POP federal opportunities,
 *  including real VA-place 561720 janitorial work. */
export async function fetchVaEvirginia(): Promise<FetchResult> {
  const ctx: PassCtx = {
    examined: new Map(),
    kept: new Map(),
    skipped: {},
    skippedRows: [],
  };
  // Pass 1: Virginia-keyword — genuine VA place-of-performance only.
  await queryPass("Virginia", (state) => state === "VA", ctx);
  // Pass 2: janitorial — VA place AND 561720 (the owner-verified VA case).
  await queryPass(
    "janitorial",
    (state, naics) => state === "VA" && naics === "561720",
    ctx,
  );
  const rows = [...ctx.kept.values()];
  console.log(
    `  va_evirginia: ${rows.length} unique VA-place rows (examined ${ctx.examined.size}; skips: ${Object.entries(ctx.skipped)
      .map(([r, n]) => `${r}=${n}`)
      .join(", ") || "none"})`,
  );
  return { rows, skipped: ctx.skipped, skippedRows: ctx.skippedRows };
}
/**
 * SHAREABLE RADAR RESULTS (owner 2026-10-03).
 *
 * A Radar search can be shared as a short link, /r/<trade>/<state> (e.g.
 * /r/janitorial/nc). When Facebook, iMessage or a group chat previews that
 * link, it reads this page's Open Graph tags: a title with the LIVE number of
 * open matches ("23 open janitorial contracts in North Carolina"), the closest
 * deadline, and a trade picture from public/og/. People who click are sent
 * straight to /radar with the same search (tagged utm_source=share).
 *
 * The count comes from the same default-match pipeline the scan uses
 * (~/lib/radar-candidates), capped like the Radar list itself, so the preview
 * never promises more than the visitor will see. With no count available the
 * title carries no number (never a made-up one).
 *
 * PURE (no DB); unit-tested in radar-share.test.ts.
 */
import { STATE_CODE_TO_NAME, normalizeStateInput } from "~/lib/location-state";

export const SHARE_BASE_URL = "https://www.contrax.company";
const MAX_TRADE_LEN = 40;

/** "Security Guard" -> "security-guard". */
export function tradeSlug(trade: string): string {
  return String(trade ?? "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_TRADE_LEN);
}

/** The short share link for a search, or null when trade or state is missing/invalid. */
export function radarShareUrl(trade: string, state: string): string | null {
  const slug = tradeSlug(trade);
  const code = normalizeStateInput(state);
  if (!slug || !code) return null;
  return `${SHARE_BASE_URL}/r/${slug}/${code.toLowerCase()}`;
}

/** Path params back to a search: { trade: "security guard", state: "NC" }, or null. */
export function parseShareParams(tradeParam: string, stateParam: string): { trade: string; state: string } | null {
  let raw = "";
  try {
    raw = decodeURIComponent(String(tradeParam ?? ""));
  } catch {
    return null;
  }
  const trade = raw.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, MAX_TRADE_LEN);
  const state = normalizeStateInput(String(stateParam ?? ""));
  if (!trade || !state) return null;
  return { trade, state };
}

/** Where a click lands: the same Radar search, tagged as a share visit. */
export function radarSearchUrl(trade: string, state: string): string {
  const q = new URLSearchParams({ trade, state, utm_source: "share", utm_medium: "social", utm_campaign: "radar_share" });
  return `/radar?${q.toString()}`;
}

/** Trade picture in public/og/ for the preview card. */
export function shareImageFor(trade: string): string {
  const t = trade.toLowerCase();
  const slug = /janitor|custodial|clean/.test(t)
    ? "janitorial"
    : /landscap|lawn|grounds|mowing|tree/.test(t)
      ? "landscaping"
      : /truck|haul|freight|dump/.test(t)
        ? "trucking"
        : /construct|roof|paving|concrete|renovat|carpent|electric|plumb|hvac/.test(t)
          ? "construction"
          : /security|guard|patrol/.test(t)
            ? "security"
            : /\bit\b|software|cyber|computer|network/.test(t)
              ? "it"
              : "general";
  return `${SHARE_BASE_URL}/og/${slug}.png`;
}

export interface ShareCardInput {
  trade: string;
  state: string;
  /** Default matches found, null when the count could not be read. */
  count: number | null;
  /** The Radar list cap (RADAR_MATCH_CAP): a count at or above it reads "25+". */
  cap: number;
  /** Closest open deadline (ISO), if any. */
  closestDue: string | null;
  /** "Updated" date shown in the description (ISO). */
  now: string;
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
}

export function shareTitle(i: ShareCardInput): string {
  const where = STATE_CODE_TO_NAME[i.state] ?? i.state;
  if (i.count == null) return `Open ${i.trade} contracts in ${where} | Contrax`;
  if (i.count === 0) return `${capitalize(i.trade)} contracts in ${where}: get alerted when one posts | Contrax`;
  const n = i.count >= i.cap ? `${i.cap}+` : String(i.count);
  return `${n} open ${i.trade} contract${i.count === 1 ? "" : "s"} in ${where} | Contrax`;
}

export function shareDescription(i: ShareCardInput): string {
  const parts: string[] = [];
  if (i.closestDue && i.count) parts.push(`Closest deadline ${shortDate(i.closestDue)}.`);
  parts.push(`Updated ${shortDate(i.now)}.`);
  parts.push("Federal, state and local bids for small businesses. Free to search, no signup needed.");
  return parts.join(" ");
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/**
 * The share page: Open Graph + Twitter tags for link previews, then a script
 * redirect for people (crawlers don't run scripts, so they read the tags).
 */
export function shareHtml(i: ShareCardInput): string {
  const title = shareTitle(i);
  const description = shareDescription(i);
  const image = shareImageFor(i.trade);
  const pageUrl = radarShareUrl(i.trade, i.state) ?? SHARE_BASE_URL;
  const target = radarSearchUrl(i.trade, i.state);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="robots" content="noindex">
<link rel="canonical" href="${esc(SHARE_BASE_URL + target)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Contrax">
<meta property="og:url" content="${esc(pageUrl)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${esc(image)}">
<script>location.replace(${JSON.stringify(target).replace(/</g, "\\u003c")});</script>
</head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;padding:32px;">
<p><a href="${esc(target)}">${esc(title.replace(/ \| Contrax$/, ""))}: see them on Contrax →</a></p>
</body>
</html>`;
}

/**
 * Prospect finder (owner 2026-10-21, outreach option 3): for an open bid, look
 * up local businesses in that trade with Google Places and keep only the email
 * addresses each business publishes on its own website. Nothing is guessed:
 * an address that is not written on the site is never produced.
 *
 * PURE and client-safe. The Places calls and page fetches live in
 * src/jobs/prospect-finder.ts.
 */

/** Places "Text Search (New)" query for one bid, e.g. "janitorial company near Raleigh, NC". */
export function placesQuery(trade: string, place: string): string {
  return `${trade.trim()} company near ${place.trim()}`;
}

/**
 * Where to search around for a bid: its location text when it has one, else
 * the buyer's name ("City of Raleigh") with the state appended.
 */
export function bidPlace(location: string | null, agency: string | null, state: string): string {
  const loc = (location ?? "").trim();
  if (loc && !/^(us|usa|united states|nationwide|various|multiple|n\/?a|tbd)$/i.test(loc)) return loc;
  const a = (agency ?? "").trim();
  return a ? `${a}, ${state}` : state;
}

/** "acme.com" from "https://www.acme.com/contact"; null for a bad URL. */
export function siteHost(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const FILE_TLDS = /\.(png|jpe?g|gif|svg|webp|css|js|ico|bmp|tiff?)$/i;
const JUNK_DOMAINS = /(^|\.)(example\.(com|org)|domain\.com|(your)?company\.com|website\.com|email\.com|yourdomain\.com|yoursite\.com|sentry\.io|sentry-next\.wixpress\.com|wixpress\.com|wix\.com|godaddy\.com|squarespace\.com|mysite\.com|test\.com)$/i;
const JUNK_LOCALS = /^(name|user|username|your\.?name|yourname|your\.?email|email|example|sample|test|first\.?last|john\.?doe|jane\.?doe|someone|noreply|no-reply|donotreply|do-not-reply)$/i;

/**
 * Email addresses written on one page: mailto links and plain text, with the
 * common HTML/URL encodings of "@" undone. Drops image file names
 * ("logo@2x.png"), placeholders and no-reply addresses. Lowercased, de-duplicated,
 * and addresses on the business's own domain listed first.
 */
export function extractEmails(html: string, host: string | null = null): string[] {
  const text = html
    .replace(/&#0*64;|&#x0*40;|&commat;/gi, "@")
    .replace(/%40/g, "@")
    // A URL-encoded space glued to an address ("mailto:%20info@…") is not part of it.
    .replace(/%20/gi, " ")
    .replace(/&#0*46;|&#x0*2e;/gi, ".");
  const seen = new Set<string>();
  for (const m of text.match(EMAIL_RE) ?? []) {
    const e = m.toLowerCase().replace(/^\.+|\.+$/g, "");
    const [local, domain] = e.split("@");
    if (!local || !domain || FILE_TLDS.test(e) || JUNK_DOMAINS.test(domain) || JUNK_LOCALS.test(local)) continue;
    seen.add(e);
  }
  const own = (e: string) => !!host && (e.endsWith(`@${host}`) || e.endsWith(`.${host}`));
  return [...seen].sort((a, b) => Number(own(b)) - Number(own(a)));
}

/**
 * Up to `max` links on the same site that likely list contact details
 * ("Contact us", "About"), as absolute URLs.
 */
export function contactLinks(html: string, pageUrl: string, max = 2): string[] {
  const host = siteHost(pageUrl);
  const out: string[] = [];
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const [, href, label] = m;
    if (!/contact|about|reach|get-in-touch/i.test(`${href} ${label}`)) continue;
    let abs: string;
    try {
      abs = new URL(href, pageUrl).toString();
    } catch {
      continue;
    }
    if (!/^https?:/i.test(abs) || siteHost(abs) !== host || out.includes(abs) || abs === pageUrl) continue;
    out.push(abs);
    if (out.length >= max) break;
  }
  return out;
}

/** One CSV cell, quoted when needed. */
export function csvCell(v: string | number | null | undefined): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

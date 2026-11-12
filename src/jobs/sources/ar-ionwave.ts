/**
 * Arkansas IonWave boards (owner 2026-11-07: "Add Arkansas city and county boards").
 *
 *   `ar_ionwave_central`: https://arkansas.ionwave.net — one public "Current Bid Opportunities" board shared
 *     by several central-Arkansas buyers (Pulaski County, City of Conway, City of Hot Springs, Central
 *     Arkansas Water, Little Rock Water Reclamation Authority, Little Rock Advertising and Promotion
 *     Commission). Each row names its buyer in the Organization column; that becomes the row's agency and
 *     place. Hot Springs' own CivicEngage page lists the same bids, so it is not read separately.
 *   `ar_fayetteville_ionwave`: the City of Fayetteville's own public IonWave board.
 *
 *   `sc_columbia_ionwave` (owner 2026-11-08): the City of Columbia, SC's public IonWave board. The
 *     city is moving to Cobblestone, but says to keep using IonWave for bids until that launches.
 *
 * Same portal type as `ne_omaha_ionwave` and `fl_lee_county`. Close times are printed with their zone
 * ("(CT)"). Sole/single-source notices are not open competitions and are skipped (`not_competitive`),
 * and "Event" rows (Columbia's "Register for Our New e-Procurement Platform") are not solicitations
 * (`not_a_solicitation`).
 * Detail pages are never requested; the row links to IonWave's public detail page for people to open.
 */
import { mapCategory } from "~/lib/trade-classification";
import type { FetchResult } from "../runner";
import { SourceUnreachableError } from "../fetch-failure";
import type { RawBid } from "./sam-gov";
import { zonedIso } from "./revize-bids";
import { ionwaveTurn } from "./ionwave-throttle";

const UA = "Mozilla/5.0 (compatible; ContraxBot/1.0; +https://www.contrax.company)";

export interface IonwaveBoard {
  source: string;
  origin: string;
  /** Fixed buyer for a single-agency board; null = read each row's Organization column. */
  agency: string | null;
  location: string | null;
  /** Known Organization names on a shared board → place. Unknown buyers fall back to `fallbackLocation`. */
  orgLocations?: Record<string, string>;
  fallbackLocation: string;
  idPrefix: string;
}

export const AR_IONWAVE_BOARDS: readonly IonwaveBoard[] = [
  {
    source: "ar_ionwave_central",
    origin: "https://arkansas.ionwave.net",
    agency: null,
    location: null,
    orgLocations: {
      "pulaski county": "Pulaski County, Arkansas",
      "city of conway": "Conway, AR",
      "city of hot springs": "Hot Springs, AR",
      "central arkansas water": "Little Rock, AR",
      "little rock water reclamation authority": "Little Rock, AR",
      "little rock advertising and promotion commission": "Little Rock, AR",
    },
    fallbackLocation: "Arkansas",
    idPrefix: "arionwave",
  },
  {
    source: "ar_fayetteville_ionwave",
    origin: "https://fayetteville-ar.ionwave.net",
    agency: "City of Fayetteville",
    location: "Fayetteville, AR",
    fallbackLocation: "Fayetteville, AR",
    idPrefix: "fayettevillearionwave",
  },
];

const decode = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
const text = (s: string) => decode(s.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();

export interface IonwaveItem { id: string; number: string; title: string; type: string; org: string; close: string }

/** One page of a public IonWave current-bid board. PURE. */
export function readIonwavePage(source: string, html: string): { items: IonwaveItem[]; total: number; pages: number } {
  const fail = (s: string): never => { throw new SourceUnreachableError(source, [s]); };
  if (!html.includes("Current Bid Opportunities")) fail("Current bid board missing (page changed)");
  const count = /<strong>(\d+)<\/strong>\s*items in\s*<strong>(\d+)<\/strong>\s*pages/i.exec(html);
  if (!count) fail("Bid count missing (page changed)");
  let keys: Record<string, { BidID?: string }> = {};
  const raw = /"_clientKeyValues":(\{.*?\}),"_controlToFocus"/s.exec(html)?.[1];
  if (raw) { try { keys = JSON.parse(raw); } catch { fail("Bid identities unreadable"); } }
  const items: IonwaveItem[] = [];
  for (const m of html.matchAll(/<tr class="rg(?:Alt)?Row"[^>]*id="ctl00_mainContent_rgBidList_ctl00__(\d+)"[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cells = [...m[2].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map((c) => text(c[1]));
    const id = keys[m[1]]?.BidID ?? "";
    if (cells.length !== 7 || !/^\d+$/.test(id)) fail("Bid row shape changed");
    items.push({ id, number: cells[1], title: cells[2], type: cells[3], org: cells[4], close: cells[6] });
  }
  const total = +count![1], pages = +count![2];
  if ((total > 0 && !items.length) || items.length > total) fail("Incomplete bid list");
  return { items, total, pages };
}

const ZONES: Record<string, "America/New_York" | "America/Chicago" | "America/Denver" | "America/Los_Angeles"> = {
  ET: "America/New_York", CT: "America/Chicago", MT: "America/Denver", PT: "America/Los_Angeles",
};

/** "11/23/2026 02:00:00 PM (CT)" → ISO. PURE. */
export function ionwaveClose(v: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{1,2}):(\d{2}):\d{2} ([AP])M \((ET|CT|MT|PT)\)$/.exec(v.trim());
  if (!m || +m[4] < 1 || +m[4] > 12) return null;
  return zonedIso(ZONES[m[7]], +m[3], +m[1], +m[2], (+m[4] % 12) + (m[6] === "P" ? 12 : 0), +m[5]);
}

export function mapIonwaveBoard(board: IonwaveBoard, items: IonwaveItem[], now: number = Date.now()): FetchResult & { rows: RawBid[]; skipped: Record<string, number> } {
  const rows: RawBid[] = [];
  const skipped: Record<string, number> = {};
  const skippedRows: { id: string; reason: string }[] = [];
  const skip = (id: string, reason: string) => { skipped[reason] = (skipped[reason] ?? 0) + 1; skippedRows.push({ id, reason }); };
  const seen = new Set<string>();
  for (const it of items) {
    if (seen.has(it.id)) { skip(it.id, "duplicate"); continue; }
    seen.add(it.id);
    if (!it.title || !it.number) { skip(it.id, "missing_fields"); continue; }
    if (/sole source|single source/i.test(it.type)) { skip(it.id, "not_competitive"); continue; }
    if (/^event$/i.test(it.type.trim())) { skip(it.id, "not_a_solicitation"); continue; }
    const due = ionwaveClose(it.close);
    if (!due) { skip(it.id, "bad_date"); continue; }
    if (Date.parse(due) <= now) { skip(it.id, "closed"); continue; }
    const agency = board.agency ?? (it.org || "Arkansas public buyer");
    const location = board.location ?? board.orgLocations?.[it.org.toLowerCase()] ?? board.fallbackLocation;
    const number = it.number.replace(/\s+Addendum\s+\d+$/i, "");
    const addendum = /Addendum\s+(\d+)$/i.exec(it.number)?.[1];
    const zone = /\((\w+)\)$/.exec(it.close)?.[1];
    rows.push({
      external_id: `${board.idPrefix}-${it.id}`,
      title: it.title,
      agency,
      location,
      description: `${agency} ${number} (${it.type}): ${it.title}. Closes ${it.close.replace(/\s*\(\w+\)$/, "")}${zone === "CT" ? " Central" : zone === "ET" ? " Eastern" : ""}.${addendum ? ` Addendum ${addendum} has been issued.` : ""} Documents are on the public IonWave bid site.`,
      category: mapCategory("", it.title, ""),
      due_date: due,
      estimated_value: "",
      source_url: `${board.origin}/PublicDetail.aspx?bidID=${it.id}&SourceType=1`,
      set_aside: null,
      naics_code: null,
      psc: null,
      solicitation_number: number,
      notice_type: /^(?:ITB|IFB|Informal Bid)/i.test(it.type) ? "ITB" : /RFP/i.test(it.type) ? "RFP" : /RFQ|Statement of Qualifications|Architect\/Engineer/i.test(it.type) ? "RFQ" : it.type || null,
    });
  }
  return { rows, skipped, skippedRows };
}

/** The ASP.NET form that asks a board for its next page. PURE. */
export function ionwaveNextPageForm(source: string, html: string): URLSearchParams {
  const params = new URLSearchParams();
  for (const m of html.matchAll(/<input\b[^>]*>/gi)) {
    const name = /\bname="([^"]+)"/i.exec(m[0])?.[1];
    if (name && /\btype="hidden"/i.test(m[0])) params.set(decode(name), decode(/\bvalue="([^"]*)"/i.exec(m[0])?.[1] ?? ""));
  }
  const next = [...html.matchAll(/<input\b[^>]*>/gi)].find((m) => /title="Next Page"/.test(m[0]))?.[0];
  const name = next && /name="([^"]+)"/.exec(next)?.[1];
  if (!name || !params.has("__VIEWSTATE") || /onclick="return false;"/.test(next!)) throw new SourceUnreachableError(source, ["Next-page control missing"]);
  params.set(decode(name), " ");
  return params;
}

export const arIonwaveDeps = { fetch: (url: string, init: RequestInit) => fetch(url, init) };

export async function fetchIonwaveBoard(board: IonwaveBoard, now: number = Date.now()): Promise<FetchResult> {
  const url = `${board.origin}/SourcingEvents.aspx?SourceType=1`;
  const get = async (init: RequestInit = {}) => {
    await ionwaveTurn();
    const res = await arIonwaveDeps.fetch(url, { redirect: "follow", signal: AbortSignal.timeout(30000), ...init, headers: { "user-agent": UA, accept: "text/html", ...(init.headers as Record<string, string>) } });
    if (!res.ok) throw new SourceUnreachableError(board.source, [`HTTP ${res.status}`]);
    return res;
  };
  try {
    const first = await get();
    const cookie = (first.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
    let html = await first.text();
    let page = readIonwavePage(board.source, html);
    const { total, pages } = page;
    if (pages > 20) throw new SourceUnreachableError(board.source, ["Too many pages"]);
    const items = [...page.items];
    for (let p = 1; p < pages; p++) {
      html = await (await get({ method: "POST", body: ionwaveNextPageForm(board.source, html), headers: { "content-type": "application/x-www-form-urlencoded", cookie } })).text();
      page = readIonwavePage(board.source, html);
      if (page.total !== total || page.items.some((i) => items.some((o) => o.id === i.id))) throw new SourceUnreachableError(board.source, ["Pagination changed or repeated a page"]);
      items.push(...page.items);
    }
    if (items.length !== total) throw new SourceUnreachableError(board.source, [`Only ${items.length} of ${total} bids read`]);
    return mapIonwaveBoard(board, items, now);
  } catch (e) {
    if (e instanceof SourceUnreachableError) throw e;
    throw new SourceUnreachableError(board.source, [e instanceof Error ? e.message : String(e)]);
  }
}

export const SC_IONWAVE_BOARDS: readonly IonwaveBoard[] = [
  {
    source: "sc_columbia_ionwave",
    origin: "https://columbiasc.ionwave.net",
    agency: "City of Columbia",
    location: "Columbia, SC",
    fallbackLocation: "Columbia, SC",
    idPrefix: "columbiascionwave",
  },
];

export const SC_IONWAVE_SOURCES: { name: string; fetchFn: () => Promise<FetchResult> }[] = SC_IONWAVE_BOARDS.map((b) => ({
  name: b.source,
  fetchFn: () => fetchIonwaveBoard(b),
}));

/**
 * Texas city IonWave boards (owner 2026-11-09: "resume the texas cities work"). Captured as
 * ContraxBot on 2026-11-09: Plano (7 bids), Irving (9) and Georgetown (7), close times in Central
 * time. Pearland, Garland and Allen answered with a bot challenge ("Just a moment…") and are not
 * read (no circumvention); Carrollton has no IonWave board under any name tried.
 */
export const TX_IONWAVE_BOARDS: readonly IonwaveBoard[] = [
  { source: "tx_plano_ionwave", origin: "https://planotx.ionwave.net", agency: "City of Plano", location: "Plano, TX", fallbackLocation: "Plano, TX", idPrefix: "planotxionwave" },
  { source: "tx_irving_ionwave", origin: "https://cityofirving.ionwave.net", agency: "City of Irving", location: "Irving, TX", fallbackLocation: "Irving, TX", idPrefix: "irvingtxionwave" },
  { source: "tx_georgetown_ionwave", origin: "https://gtowntx.ionwave.net", agency: "City of Georgetown", location: "Georgetown, TX", fallbackLocation: "Georgetown, TX", idPrefix: "georgetowntxionwave" },
];

export const TX_IONWAVE_SOURCES: { name: string; fetchFn: () => Promise<FetchResult> }[] = TX_IONWAVE_BOARDS.map((b) => ({
  name: b.source,
  fetchFn: () => fetchIonwaveBoard(b),
}));

/**
 * City of Dubuque, Iowa (owner 2026-11-12: "add Dubuque"). The city took down its own bid list
 * (/bids.aspx, read by the CivicEngage reader until then) and posts on IonWave. Captured as
 * ContraxBot on 2026-11-12: 6 bids, close times in Central time. The source keeps its name,
 * `ia_dubuque`, so its page and history carry on. This board's robots.txt disallows crawlers like
 * every IonWave board; the owner chose to read it (see ROBOTS_PAUSED_SOURCES in src/jobs/runner.ts).
 */
export const IA_IONWAVE_BOARDS: readonly IonwaveBoard[] = [
  { source: "ia_dubuque", origin: "https://cityofdubuque.ionwave.net", agency: "City of Dubuque", location: "Dubuque, IA", fallbackLocation: "Dubuque, IA", idPrefix: "dubuqueiaionwave" },
];

export const IA_IONWAVE_SOURCES: { name: string; fetchFn: () => Promise<FetchResult> }[] = IA_IONWAVE_BOARDS.map((b) => ({
  name: b.source,
  fetchFn: () => fetchIonwaveBoard(b),
}));

export const AR_IONWAVE_SOURCES: { name: string; fetchFn: () => Promise<FetchResult> }[] = AR_IONWAVE_BOARDS.map((b) => ({
  name: b.source,
  fetchFn: () => fetchIonwaveBoard(b),
}));

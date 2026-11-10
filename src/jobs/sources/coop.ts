/**
 * Purchasing co-op solicitations (owner 2026-11-10: "yes build it"): the open calls for vendors that
 * Sourcewell and BuyBoard post on their own public pages (robots.txt allows both; checked 2026-11-10).
 * Winning one puts a business on a contract that member agencies buy from without their own bid.
 *
 *   Sourcewell: sourcewell-mn.gov/solicitations lists open solicitations by date; each one's own page
 *     gives the time ("Proposals are due no later than December 22, 2026 at 03:30 PM CT").
 *   BuyBoard: buyboard.com/vendor/proposal-invitations lists current invitations with a due date and
 *     time (Austin, so Central) and links each one's proposal PDF; "Upcoming" names come without dates.
 *
 * TIPS (robots.txt disallows everything) and HGACBuy (bot check) are not read. PURE parsers plus one
 * fetcher that sends a handful of requests a day, two seconds apart, as ContraxBot.
 */
import { coopTrades, type CoopSolicitation } from "~/lib/coop-contracts";
import { zonedIso } from "./revize-bids";

const UA = "Mozilla/5.0 (compatible; ContraxBot/1.0; +https://www.contrax.company)";
export const SOURCEWELL_LIST_URL = "https://www.sourcewell-mn.gov/solicitations";
export const BUYBOARD_URL = "https://www.buyboard.com/vendor/proposal-invitations?rname=proposals";

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const ZONES = { CT: "America/Chicago", ET: "America/New_York", MT: "America/Denver", PT: "America/Los_Angeles" } as const;
const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, " ").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
const text = (s: string) => decode(s.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();

/** "December 22, 2026" + "03:30 PM" + "CT" → ISO instant. PURE. */
export function coopDue(date: string, time: string | null, zone: keyof typeof ZONES = "CT"): string | null {
  const d = /^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/.exec(date.trim());
  if (!d) return null;
  const mo = MONTHS.indexOf(d[1].toLowerCase()) + 1;
  if (!mo) return null;
  let h = 23, mi = 59;
  if (time) {
    const t = /^(\d{1,2}):(\d{2})\s*([ap])\.?m\.?$/i.exec(time.trim());
    if (!t || +t[1] < 1 || +t[1] > 12) return null;
    h = (+t[1] % 12) + (t[3].toLowerCase() === "p" ? 12 : 0);
    mi = +t[2];
  }
  return zonedIso(ZONES[zone], +d[3], mo, +d[2], h, mi);
}

export interface SourcewellRow { id: string; title: string; date: string; construction: boolean }

/** The Open section of Sourcewell's solicitations page. Throws when the page shape changed. PURE. */
export function readSourcewellList(html: string): SourcewellRow[] {
  const a = html.indexOf('id="OpenSols"');
  const b = html.indexOf('id="PendingSols"', a);
  if (a < 0 || b < 0) throw new Error("Sourcewell: open section missing (page changed)");
  const open = html.slice(a, b);
  const iq = open.search(/Indefinite quantity construction\s+contracting/i);
  const out: SourcewellRow[] = [];
  for (const m of open.matchAll(/<a href="https:\/\/www\.sourcewell-mn\.gov\/solicitations\/(\d+)">([\s\S]*?)<\/a>[\s\S]*?<span[^>]*>\s*([A-Za-z]+ \d{1,2}, \d{4})\s*<\/span>/g)) {
    out.push({ id: m[1], title: text(m[2]), date: m[3], construction: iq >= 0 && (m.index ?? 0) > iq });
  }
  if (!out.length && !/There are no results/i.test(open)) throw new Error("Sourcewell: no rows and no 'no results' (page changed)");
  return out;
}

/** The due time on one Sourcewell solicitation page, e.g. "03:30 PM" CT, or null. PURE. */
export function readSourcewellDueTime(html: string): { time: string; zone: keyof typeof ZONES } | null {
  const m = /Proposals are due no later than [A-Za-z]+ \d{1,2}, \d{4} at (\d{1,2}:\d{2} [AP]M) (CT|ET|MT|PT)/.exec(text(html));
  return m ? { time: m[1], zone: m[2] as keyof typeof ZONES } : null;
}

/** Sourcewell rows (with their due times when known) → stored solicitations. PURE. */
export function mapSourcewell(rows: SourcewellRow[], times: Record<string, { time: string; zone: keyof typeof ZONES } | null>): CoopSolicitation[] {
  return rows.map((r) => {
    const t = times[r.id] ?? null;
    return {
      key: `sourcewell:${r.id}`,
      coop: "sourcewell",
      number: null,
      title: r.title,
      dueAt: coopDue(r.date, t?.time ?? null, t?.zone ?? "CT"),
      url: `https://www.sourcewell-mn.gov/solicitations/${r.id}`,
      trades: r.construction ? [...new Set(["construction", ...coopTrades(r.title)])] : coopTrades(r.title),
      construction: r.construction,
    };
  });
}

/** BuyBoard's current proposal invitations and its "Upcoming" names. Throws when the page changed. PURE. */
export function readBuyBoard(html: string): CoopSolicitation[] {
  const c0 = html.indexOf("Current Proposal Invitations");
  const t0 = html.indexOf("<table", c0);
  const t1 = html.indexOf("</table>", t0);
  if (c0 < 0 || t0 < 0 || t1 < 0) throw new Error("BuyBoard: proposal table missing (page changed)");
  const rows = [...html.slice(t0, t1).matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((m) => [...m[1].matchAll(/<td>([\s\S]*?)<\/td>/g)].map((c) => c[1]));
  const head = rows.shift()?.map(text) ?? [];
  if (head[0] !== "Proposal No." || head[2] !== "Proposal Name" || !/Due/.test(head[3] ?? "")) throw new Error("BuyBoard: table columns changed");
  const out: CoopSolicitation[] = [];
  for (const cells of rows) {
    if (cells.length !== 4) throw new Error("BuyBoard: row shape changed");
    const number = text(cells[0]);
    const pdf = /href="([^"]+)"/.exec(cells[0])?.[1] ?? "";
    const title = text(cells[2]);
    const due = /^([A-Za-z]+ \d{1,2}, \d{4})\s+at\s+(\d{1,2}:\d{2}\s*[ap]\.m\.)$/i.exec(text(cells[3]));
    if (!/^\d{3}-\d{2}$/.test(number) || !title) throw new Error("BuyBoard: proposal number or name missing");
    out.push({
      key: `buyboard:${number}`,
      coop: "buyboard",
      number,
      title,
      dueAt: due ? coopDue(due[1], due[2], "CT") : null,
      url: /^https:\/\//.test(pdf) ? decode(pdf) : "https://www.buyboard.com/vendor/proposal-invitations",
      trades: coopTrades(title),
      construction: false,
    });
  }
  const up = html.indexOf('id="upcoming-proposal-invitations"');
  if (up > 0) {
    const ul = html.slice(up, html.indexOf("</ul>", up));
    for (const m of ul.matchAll(/<li>([\s\S]*?)<\/li>/g)) {
      const title = text(m[1]);
      if (!title) continue;
      out.push({
        key: `buyboard:upcoming:${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80)}`,
        coop: "buyboard",
        number: null,
        title,
        dueAt: null,
        url: "https://www.buyboard.com/vendor/proposal-invitations",
        trades: coopTrades(title),
        construction: false,
      });
    }
  }
  return out;
}

export const coopDeps = {
  fetch: (url: string, init: RequestInit) => fetch(url, init),
  sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
};

async function page(url: string): Promise<string> {
  const res = await coopDeps.fetch(url, { headers: { "user-agent": UA, accept: "text/html" }, redirect: "follow", signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`${new URL(url).host} HTTP ${res.status}`);
  const html = await res.text();
  if (/<title>\s*just a moment|cf-chl-|challenge-platform/i.test(html.slice(0, 8000))) throw new Error(`${new URL(url).host} answered with a bot check (not read)`);
  return html;
}

/** Read both co-ops. Each result is null when that co-op could not be read (the other still counts). */
export async function fetchCoopSolicitations(): Promise<{ sourcewell: CoopSolicitation[] | null; buyboard: CoopSolicitation[] | null; errors: string[] }> {
  const errors: string[] = [];
  let sourcewell: CoopSolicitation[] | null = null;
  let buyboard: CoopSolicitation[] | null = null;
  try {
    const rows = readSourcewellList(await page(SOURCEWELL_LIST_URL));
    const times: Record<string, { time: string; zone: keyof typeof ZONES } | null> = {};
    for (const r of rows.slice(0, 40)) {
      await coopDeps.sleep(2000);
      try {
        times[r.id] = readSourcewellDueTime(await page(`https://www.sourcewell-mn.gov/solicitations/${r.id}`));
      } catch (e) {
        times[r.id] = null;
        errors.push(`Sourcewell ${r.id}: ${(e as Error).message}`);
      }
    }
    sourcewell = mapSourcewell(rows, times);
  } catch (e) {
    errors.push((e as Error).message);
  }
  await coopDeps.sleep(2000);
  try {
    buyboard = readBuyBoard(await page(BUYBOARD_URL));
  } catch (e) {
    errors.push((e as Error).message);
  }
  return { sourcewell, buyboard, errors };
}

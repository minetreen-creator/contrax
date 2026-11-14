/**
 * Signals probe — CLI entrypoint (`bun run signals-probe`), run by hand from
 * .github/workflows/signals-probe.yml (owner 2026-11-14). Reads recent and
 * upcoming meeting agendas for a list of Legistar clients (cities and counties
 * that publish through Legistar's public Web API) and prints the agenda items
 * that look like buying signals: renewals, awards, planned solicitations and
 * budget items.
 *
 * READ-ONLY: it touches no database and sends nothing. It exists to learn which
 * governments answer and what their signals look like before a feed is built.
 */
import { agendaSignal, legistarEventsUrl, legistarItemsUrl } from "~/lib/signals";

/** Virginia cities and counties to try. A client that does not exist or needs a token is reported and skipped. */
const DEFAULT_CLIENTS = "alexandria,norfolk,richmondva,hampton,chesapeake,newportnews,roanokeva,lynchburg,charlottesville,fairfaxcounty,pwcgov,henrico,chesterfield,suffolkva,portsmouthva,harrisonburg,danville,arlington,loudoun,virginiabeach";
const DAYS_BACK = 30;
const DAYS_AHEAD = 45;
const MAX_EVENTS_PER_CLIENT = 12;
const TIMEOUT_MS = 20_000;

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

async function getJson(url: string): Promise<{ ok: true; data: unknown } | { ok: false; why: string }> {
  try {
    const res = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return { ok: false, why: `HTTP ${res.status}` };
    return { ok: true, data: await res.json() };
  } catch (e) {
    return { ok: false, why: e instanceof Error ? e.message : String(e) };
  }
}

interface LegistarEvent { EventId: number; EventBodyName?: string; EventDate?: string; EventInSiteURL?: string }
interface LegistarItem { EventItemTitle?: string | null; EventItemMatterName?: string | null; EventItemMatterFile?: string | null; EventItemMatterType?: string | null }

async function main() {
  const clients = (process.env.CLIENTS ?? DEFAULT_CLIENTS).split(",").map((c) => c.trim().toLowerCase()).filter((c) => /^[a-z0-9-]{2,40}$/.test(c));
  const from = day(-DAYS_BACK);
  const to = day(DAYS_AHEAD);
  console.log(`Agendas from ${from} to ${to} for ${clients.length} Legistar client(s).\n`);
  const totals = { answered: 0, events: 0, items: 0, signals: 0 };
  const byKind: Record<string, number> = {};
  for (const client of clients) {
    const ev = await getJson(legistarEventsUrl(client, from, to));
    if (!ev.ok || !Array.isArray(ev.data)) {
      console.log(`✗ ${client}: ${ev.ok ? "unexpected reply" : ev.why}`);
      continue;
    }
    totals.answered++;
    const events = (ev.data as LegistarEvent[]).slice(0, MAX_EVENTS_PER_CLIENT);
    let items = 0;
    const found: string[] = [];
    for (const e of events) {
      const it = await getJson(legistarItemsUrl(client, e.EventId));
      if (!it.ok || !Array.isArray(it.data)) continue;
      for (const row of it.data as LegistarItem[]) {
        const text = [row.EventItemTitle, row.EventItemMatterName].filter(Boolean).join(" — ");
        if (!text) continue;
        items++;
        const s = agendaSignal(text);
        if (!s) continue;
        byKind[s.kind] = (byKind[s.kind] ?? 0) + 1;
        const amount = s.amount ? ` · $${Math.round(s.amount).toLocaleString("en-US")}` : "";
        found.push(`   [${s.kind}] ${(e.EventDate ?? "").slice(0, 10)} ${e.EventBodyName ?? ""}${amount}\n      ${text.replace(/\s+/g, " ").slice(0, 260)}`);
      }
    }
    totals.events += events.length;
    totals.items += items;
    totals.signals += found.length;
    console.log(`✓ ${client}: ${events.length} meeting(s), ${items} agenda item(s), ${found.length} signal(s)`);
    for (const line of found.slice(0, 8)) console.log(line);
    if (found.length > 8) console.log(`   … and ${found.length - 8} more`);
    console.log("");
  }
  console.log(`Answered: ${totals.answered} of ${clients.length} clients. Meetings: ${totals.events}. Agenda items: ${totals.items}. Signals: ${totals.signals}.`);
  console.log(`By kind: ${Object.entries(byKind).map(([k, n]) => `${k} ${n}`).join(", ") || "none"}`);
}

if (import.meta.main) {
  main()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error("💥 Signals probe crashed:", e);
      process.exit(1);
    });
}

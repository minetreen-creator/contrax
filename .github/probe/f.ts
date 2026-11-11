// Read-only probe: does fundinglandscape.com carry Contrax's hidden bid-page watermark, our wording or our
// labels? One polite GET per page as ContraxBot; robots.txt honored; a refusal or bot check ends it.
// Prints page titles, short public excerpts, counts and Contrax bid ids only.
import { sql } from "~/db";
import { decodeWatermarks } from "~/lib/bid-watermark";
const UA = "Mozilla/5.0 (compatible; ContraxBot/1.0; +https://www.contrax.company)";
const BASE = "https://fundinglandscape.com";
const IDS = ["4e62d871-9814-4598-be54-c3482536258e", "85600b84-e6a5-4ab4-8277-1c13e13fe3d2", "bc4d0399-2108-4460-87ee-8fec5065c80b", "ca1411b3-ad6c-4cab-9459-ef0947774265", "56b8654d-1ad4-4847-a440-1304ba5e6ea5", "d4d58c6e-838d-46b5-8bd2-9f489a951fb3", "464d356f-c13f-4a8b-a5e7-a754fce0d27b", "95e6cd34-aa21-4be8-9a54-035dc5ecb03a"];
const get = (url: string) => fetch(url, { headers: { "user-agent": UA, accept: "text/html" }, redirect: "follow", signal: AbortSignal.timeout(25000) });
const s = sql();
let robots = "";
try { const r = await get(`${BASE}/robots.txt`); console.log(`robots.txt HTTP ${r.status}`); if (r.ok) robots = await r.text(); } catch (e) { console.log("robots.txt no answer"); }
console.log("ROBOTS " + robots.replace(/\s+/g, " ").slice(0, 400));
const disallowed = (() => { let on = false, bad = false; for (const l of robots.split(/\r?\n/)) { const m = /^(user-agent|disallow)\s*:\s*(.*)$/i.exec(l.replace(/#.*/, "").trim()); if (!m) continue; if (m[1].toLowerCase() === "user-agent") on = m[2] === "*" || /contraxbot/i.test(m[2]); else if (on && m[2] && "/opportunity/x".startsWith(m[2])) bad = true; } return bad; })();
if (disallowed) { console.log("robots.txt disallows /opportunity/ for us; not read"); process.exit(0); }
const text = (h: string) => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, " ").trim();
for (const id of IDS) {
  await new Promise((r) => setTimeout(r, 2500));
  let res: Response;
  try { res = await get(`${BASE}/opportunity/${id}`); } catch (e) { console.log(`${id}: no answer`); continue; }
  const raw = await res.text();
  if (!res.ok || /just a moment|cf-chl|captcha/i.test(raw.slice(0, 5000))) { console.log(`${id}: HTTP ${res.status}${res.ok ? " bot check" : ""} (stopping)`); break; }
  const t = text(raw);
  const title = (/<title>([^<]*)<\/title>/i.exec(raw)?.[1] ?? "").replace(/&amp;/g, "&").trim();
  const h1 = text(/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(raw)?.[1] ?? "");
  const tokens = decodeWatermarks(raw);
  const cues = {
    wordJoiners: (raw.match(/⁠/g) ?? []).length,
    zeroWidth: (raw.match(/[​‌]/g) ?? []).length,
    watermarkTokens: tokens.length,
    saysContrax: /contrax/i.test(raw),
    ourAgencyLabel: /Purchasing Group \(BidNet Direct\)/.test(t),
    ourSentenceThirdParty: /a private third-party bid service/i.test(t),
    ourSentenceDeadline: /stores the deadline at 11:59 PM Eastern/i.test(t),
    ourSentenceMembers: /registered members only/i.test(t),
    has1159: /11:59/.test(t),
    hasSourceLinkToUs: /contrax\.company/i.test(raw),
  };
  console.log(`PAGE ${id} | HTTP ${res.status} ${raw.length}B | title: ${title.slice(0, 110)} | h1: ${h1.slice(0, 110)}`);
  console.log(`  cues ${JSON.stringify(cues)}`);
  const i = t.search(/BidNet/i);
  console.log(`  excerpt: ${i >= 0 ? t.slice(Math.max(0, i - 260), i + 420) : t.slice(0, 500)}`);
  const name = h1 || title.split("|")[0].trim();
  if (name.length >= 12) {
    const rows = (await s`SELECT id, source, agency, due_date, created_at FROM bids WHERE lower(title) = lower(${name}) ORDER BY created_at LIMIT 3`) as { id: number; source: string; agency: string | null; due_date: Date | null; created_at: Date }[];
    console.log(`  same title in Contrax: ${rows.length ? rows.map((r) => `bid ${r.id} (${r.source}, first stored ${new Date(r.created_at).toISOString().slice(0, 10)}, due ${r.due_date ? new Date(r.due_date).toISOString() : "?"})`).join("; ") : "none"}`);
  }
  if (tokens.length) {
    const rows = (await s`SELECT w.token, w.bid_id, w.created_at FROM bid_watermarks w WHERE w.token = ANY(${tokens})`) as { token: string; bid_id: number; created_at: Date }[];
    for (const r of rows) console.log(`  !! watermark token matches Contrax bid ${r.bid_id}, served ${new Date(r.created_at).toISOString()}`);
  }
}
process.exit(0);

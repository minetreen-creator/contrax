// TEMP read-only: is the City of Dubuque's public IonWave board readable as ContraxBot? Robots first; a 403 or bot check stops it.
import { gzipSync } from "node:zlib";
import { readIonwavePage } from "~/jobs/sources/ar-ionwave";
const UA = "Mozilla/5.0 (compatible; ContraxBot/1.0; +https://www.contrax.company)";
const origin = "https://cityofdubuque.ionwave.net";
const rb = await fetch(`${origin}/robots.txt`, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(30_000) });
const robots = rb.ok ? await rb.text() : "";
console.log(`DBQ3 robots ${rb.status}: ${robots.replace(/\s+/g, " ").slice(0, 300)}`);
if (rb.status === 403) { console.log("DBQ3 stopped: robots 403"); process.exit(0); }
if (/disallow:\s*\/(\s|$)|disallow:\s*\/SourcingEvents/i.test(robots)) { console.log("DBQ3 stopped: robots disallows the board"); process.exit(0); }
const res = await fetch(`${origin}/SourcingEvents.aspx?SourceType=1`, { headers: { "user-agent": UA, accept: "text/html" }, redirect: "follow", signal: AbortSignal.timeout(30_000) });
const html = await res.text();
console.log(`DBQ3 board ${res.status} final=${res.url} bytes=${html.length}`);
if (res.status === 403 || /Just a moment|captcha|cf-challenge/i.test(html.slice(0, 4000))) { console.log("DBQ3 stopped: blocked"); process.exit(0); }
try {
  const page = readIonwavePage("ia_dubuque", html);
  console.log(`DBQ3 total=${page.total} pages=${page.pages} items=${page.items.length}`);
  for (const it of page.items.slice(0, 12)) console.log(`DBQ3 item ${JSON.stringify({ type: it.type, title: it.title.slice(0, 70), close: it.close, org: it.org })}`);
} catch (e) { console.log("DBQ3 parse failed: " + (e as Error).message); }
const b64 = gzipSync(Buffer.from(html)).toString("base64");
console.log(`DBQ3 gz ${b64.length}`);
for (let i = 0; i < b64.length; i += 900) console.log("DBQ3B64 " + b64.slice(i, i + 900));
process.exit(0);

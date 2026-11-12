// TEMP read-only: read the City of Dubuque's public IonWave bid board once as ContraxBot (owner 2026-11-12:
// "add Dubuque"). A 403 or a bot check stops it; nothing is submitted.
import { gzipSync } from "node:zlib";
import { readIonwavePage } from "~/jobs/sources/ar-ionwave";
const UA = "Mozilla/5.0 (compatible; ContraxBot/1.0; +https://www.contrax.company)";
const res = await fetch("https://cityofdubuque.ionwave.net/SourcingEvents.aspx?SourceType=1", { headers: { "user-agent": UA, accept: "text/html" }, redirect: "follow", signal: AbortSignal.timeout(30_000) });
const html = await res.text();
console.log(`DBQ4 board ${res.status} final=${res.url} bytes=${html.length}`);
if (res.status === 403 || /Just a moment|captcha|cf-challenge/i.test(html.slice(0, 4000))) { console.log("DBQ4 stopped: blocked"); process.exit(0); }
try {
  const page = readIonwavePage("ia_dubuque", html);
  console.log(`DBQ4 total=${page.total} pages=${page.pages} items=${page.items.length}`);
  for (const it of page.items.slice(0, 15)) console.log(`DBQ4 item ${JSON.stringify({ type: it.type, number: it.number, title: it.title.slice(0, 70), close: it.close, org: it.org })}`);
} catch (e) { console.log("DBQ4 parse failed: " + (e as Error).message); }
const b64 = gzipSync(Buffer.from(html)).toString("base64");
console.log(`DBQ4 gz ${b64.length}`);
for (let i = 0; i < b64.length; i += 900) console.log("DBQ4B64 " + b64.slice(i, i + 900));
process.exit(0);

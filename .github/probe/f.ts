// Read-only: capture Choice Partners and OMNIA solicitation pages as test fixtures (gzip+base64). Removed after.
import { gzipSync } from "node:zlib";
const UA = "Mozilla/5.0 (compatible; ContraxBot/1.0; +https://www.contrax.company)";
const get = async (u: string) => (await fetch(u, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20000) })).text();
const dump = (name: string, s: string) => { const b = gzipSync(Buffer.from(s)).toString("base64"); console.log(`BEGIN ${name} ${s.length}`); for (let i = 0; i < b.length; i += 4000) console.log("L " + b.slice(i, i + 4000)); console.log(`END ${name}`); };
dump("choice-current", await get("https://www.choicepartners.org/current-rfps"));
await new Promise((r) => setTimeout(r, 2000));
dump("choice-upcoming", await get("https://www.choicepartners.org/upcoming-contracts"));
await new Promise((r) => setTimeout(r, 2000));
const o = await get("https://www.omniapartners.com/for-suppliers/solicitations");
const i = o.indexOf("<h2"), a = o.lastIndexOf("<h2", o.indexOf("Current Solicitations")), b = o.indexOf("</section>", o.indexOf("Solicitations in Evaluation"));
console.log("omnia idx", i, a, b, o.length);
dump("omnia", `<!-- trimmed: OMNIA solicitations page, Current Solicitations through Solicitations in Evaluation -->\n${o.slice(a, b + 10)}`);

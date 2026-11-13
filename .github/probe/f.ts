// Read-only: page structure of candidate co-op boards. Removed after.
const UA = "Mozilla/5.0 (compatible; ContraxBot/1.0; +https://www.contrax.company)";
const get = async (u: string) => { const r = await fetch(u, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20000) }); return { s: r.status, u: r.url, h: await r.text() }; };
const wait = () => new Promise((r) => setTimeout(r, 2000));
try { const r = await get("https://tips.ionwave.net/robots.txt"); console.log(`== tips ionwave robots ${r.s}\n${r.h.slice(0, 600)}`); } catch (e) { console.log("tips robots ERR", (e as Error).message); }
await wait();
try {
  const r = await get("https://tips.ionwave.net/SourcingEvents.aspx?SourceType=1");
  console.log(`== tips board ${r.s} ${r.u} len=${r.h.length} current=${r.h.includes("Current Bid Opportunities")}`);
  const c = r.h.match(/<strong>(\d+)<\/strong>\s*items in/i); console.log("count", c?.[1]);
  for (const m of [...r.h.matchAll(/<tr class="rg(?:Alt)?Row"[^>]*>([\s\S]*?)<\/tr>/g)].slice(0, 30)) console.log("  ROW " + m[1].replace(/<[^>]+>/g, " | ").replace(/\s+/g, " ").slice(0, 300));
} catch (e) { console.log("tips board ERR", (e as Error).message); }
await wait();
try {
  const r = await get("https://www.omniapartners.com/for-suppliers/solicitations");
  const i = r.h.indexOf("Current Solicitations"); const j = r.h.indexOf("Solicitations in Evaluation");
  console.log(`== omnia current section raw:\n${r.h.slice(i, Math.min(j, i + 3000))}`);
} catch (e) { console.log("omnia ERR", (e as Error).message); }
await wait();
try {
  const r = await get("https://1gpa.org/solicitations/");
  console.log("== 1gpa iframes", [...r.h.matchAll(/<iframe[^>]*src="([^"]+)"/g)].map((m) => m[1]));
  const k = r.h.indexOf("currently issued solicitations"); console.log(r.h.slice(k, k + 2500));
} catch (e) { console.log("1gpa ERR", (e as Error).message); }
await wait();
try {
  const r = await get("https://www.choicepartners.org/current-rfps");
  const i = r.h.indexOf("Due Date"); console.log(`== choice current raw:\n${r.h.slice(i - 600, i + 2000)}`);
  await wait();
  const u = await get("https://www.choicepartners.org/upcoming-contracts");
  const k = u.h.indexOf("Est. Advertise"); console.log(`== choice upcoming raw:\n${u.h.slice(k - 400, k + 1800)}`);
} catch (e) { console.log("choice ERR", (e as Error).message); }

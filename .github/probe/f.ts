// Temp probe: does Funding Landscape's public Sources page name BidNet? One polite GET per page as
// ContraxBot (robots.txt allows /sources). Prints public source names and counts only.
const UA = "Mozilla/5.0 (compatible; ContraxBot/1.0; +https://www.contrax.company)";
const get = (u: string) => fetch(u, { headers: { "user-agent": UA, accept: "text/html" }, redirect: "follow", signal: AbortSignal.timeout(25000) });
const strip = (h: string) => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
for (const path of ["/sources", "/sources?category=state", "/sources?category=other"]) {
  const res = await get("https://fundinglandscape.com" + path);
  const raw = await res.text();
  if (!res.ok || /just a moment|cf-chl|captcha/i.test(raw.slice(0, 5000))) { console.log(`SRC ${path}: HTTP ${res.status} (not read)`); break; }
  const visible = strip(raw);
  const all = raw.replace(/\\u0026/g, "&");
  const hits = [...all.matchAll(/bid\s?net/gi)].length;
  console.log(`SRC ${path}: HTTP ${res.status}, ${raw.length} bytes | "bidnet" in visible text: ${/bid\s?net/i.test(visible)} | anywhere in page code: ${hits} time(s)`);
  for (const m of [...all.matchAll(/.{0,140}bid\s?net.{0,160}/gi)].slice(0, 5)) console.log("   near: " + m[0].replace(/\s+/g, " "));
  const links = [...new Set([...raw.matchAll(/href="(\/sources\/[^"#?]+)"/g)].map((m) => m[1]))];
  console.log(`   source links on page: ${links.length}; with bid/procure/purchas in the name: ${links.filter((l) => /bid|procure|purchas|tender|rfp/i.test(l)).slice(0, 25).join(", ") || "none"}`);
  console.log(`   sample of links: ${links.slice(0, 30).join(", ")}`);
  const i = visible.search(/State & Local/);
  console.log(`   text after "State & Local": ${visible.slice(i, i + 700)}`);
  await new Promise((r) => setTimeout(r, 2500));
}

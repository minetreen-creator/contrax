/** Branch-only read-only probe, part 4: Builders Exchange of Washington's public "Posted Projects" pages. */
const UA = "Mozilla/5.0 (compatible; ContraxBot/1.0; +https://www.contrax.company)";
const strip = (h: string) => h.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const get = async (u: string) => { try { const r = await fetch(u, { headers: { "User-Agent": UA }, redirect: "follow", signal: AbortSignal.timeout(25000) }); return { status: r.status, url: r.url, body: await r.text() }; } catch (e) { return { status: 0, url: u, body: `ERR ${(e as Error).message}` }; } };
const show = async (u: string, n = 1200, maxLinks = 120) => {
  const p = await get(u);
  const links = [...p.body.matchAll(/<a[^>]*href="([^"#]+)"[^>]*>([\s\S]*?)<\/a>/gi)].map((m) => `${m[1]} «${strip(m[2]).slice(0, 50)}»`);
  console.log(`PAGE ${u} ${p.status} -> ${p.url} len=${p.body.length} title=${(p.body.match(/<title>([^<]*)/i)?.[1] ?? "").trim().slice(0, 70)}`);
  console.log(`TEXT ${strip(p.body).slice(0, n)}`);
  console.log(`LINKS(${links.length}) ${links.slice(0, maxLinks).join("  ").slice(0, 5000)}`);
  return { p, links };
};
const post = await show("https://www.bxwa.com/bxwa_toc/postings.html", 1500);
await new Promise((r) => setTimeout(r, 1500));
await show("https://www.bxwa.com/plan_center.html", 900, 60);
const next = post.links.map((l) => l.split(" «")[0]).filter((l) => /pub|agenc|public|toc/i.test(l) && !/\.(pdf|jpg|png)$/i.test(l)).slice(0, 4);
for (const l of next) { await new Promise((r) => setTimeout(r, 1500)); await show(new URL(l, "https://www.bxwa.com/bxwa_toc/postings.html").href, 1500); }

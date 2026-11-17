/**
 * Branch-only, read-only probe (owner 2026-11-16: "School", Florida school districts). Reads
 * robots.txt and the public front pages of VendorLink as ContraxBot to learn whether its public
 * solicitation list may be read and what it looks like. No login, no forms with credentials.
 */
const UA = "Mozilla/5.0 (compatible; ContraxBot/1.0; +https://www.contrax.company)";
const get = async (u: string, init: RequestInit = {}) => {
  try {
    const r = await fetch(u, { ...init, headers: { "User-Agent": UA, Accept: "text/html,application/json,*/*", ...(init.headers ?? {}) }, redirect: "follow", signal: AbortSignal.timeout(25000) });
    return { status: r.status, url: r.url, type: r.headers.get("content-type") ?? "", server: r.headers.get("server") ?? "", body: await r.text() };
  } catch (e) { return { status: 0, url: u, type: "", server: "", body: `ERR ${(e as Error).message}` }; }
};
const strip = (h: string) => h.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
for (const host of ["https://www.myvendorlink.com", "https://vendorlink.ocps.net"]) {
  const rb = await get(`${host}/robots.txt`);
  console.log(`ROBOTS ${host} ${rb.status} ${rb.type} :: ${rb.body.slice(0, 600).replace(/\n/g, " | ")}`);
  const home = await get(`${host}/`);
  console.log(`HOME ${host} ${home.status} -> ${home.url} server=${home.server} len=${home.body.length} title=${(home.body.match(/<title>([^<]*)/i)?.[1] ?? "").trim()}`);
  console.log(`TEXT ${strip(home.body).slice(0, 700)}`);
  const links = [...new Set([...home.body.matchAll(/(?:href|action|src)="([^"#]+)"/gi)].map((m) => m[1]).filter((l) => !/\.(css|png|jpg|gif|ico|woff2?|svg)(\?|$)/i.test(l)))];
  console.log(`LINKS ${links.slice(0, 80).join("  ")}`);
  for (const path of ["/external/bids", "/common/search.aspx", "/external/search.aspx", "/common/bidsearch.aspx", "/external/solicitations", "/common/solicitations.aspx", "/common/default.aspx", "/external/default.aspx"]) {
    const p = await get(`${host}${path}`);
    console.log(`TRY ${host}${path} ${p.status} -> ${p.url} len=${p.body.length} title=${(p.body.match(/<title>([^<]*)/i)?.[1] ?? "").trim().slice(0, 60)} :: ${strip(p.body).slice(0, 260)}`);
  }
}

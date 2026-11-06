// Read-only: fetch the City of Destin bid page the way the sync does and describe it. No files written.
import { CIVICENGAGE_HEADERS } from "../../src/jobs/sources/civicengage-bids";
for (const u of ["https://www.cityofdestin.com/bids.aspx", "https://www.cityofdestin.com/"]) {
  try {
    const r = await fetch(u, { headers: CIVICENGAGE_HEADERS, signal: AbortSignal.timeout(20000) });
    const b = await r.text();
    const title = (/<title>([^<]*)<\/title>/i.exec(b)?.[1] ?? "").trim();
    console.log(`${u} -> ${r.status} final=${r.url} bytes=${b.length} title="${title}"`);
    console.log(`  bidItems=${b.includes('<div class="bidItems listItems">')} bidTitle=${(b.match(/class="bidTitle"/g) ?? []).length} bidID=${(b.match(/bids\.aspx\?bidID=/gi) ?? []).length}`);
    const hints = [...new Set((b.match(/https?:\/\/[^"' )]*(?:bonfire|opengov|demandstar|bidnet|procure|vendorregistry|periscope|ionwave|negometrix|questcdn|bidsync|planetbids)[^"' )]*/gi) ?? []))].slice(0, 10);
    console.log(`  portal links: ${hints.join(" | ") || "none"}`);
    const m = /bid|procure|purchas/i;
    const links = [...b.matchAll(/<a[^>]+href="([^"]+)"[^>]*>([^<]{0,80})<\/a>/gi)].filter((x) => m.test(x[1] + x[2])).slice(0, 15).map((x) => `${x[2].trim()} => ${x[1]}`);
    console.log(`  bid-ish links:\n    ${links.join("\n    ")}`);
    if (u.endsWith("bids.aspx")) console.log("  snippet:", b.replace(/\s+/g, " ").replace(/.*?<body/i, "<body").slice(0, 600));
  } catch (e) { console.log(u, "ERR", String(e).slice(0, 150)); }
}
process.exit(0);

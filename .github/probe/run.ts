// Temporary diagnostic (owner 2026-11-03: fixing dead sources). One request per
// refusing site with our honest bot name instead of a browser-style one. If a
// site still refuses, that is a block we respect.
const HONEST = "Mozilla/5.0 (compatible; ContraxBot/1.0; +https://www.contrax.company)";
const urls = [
  "https://www.ms.gov/dfa/contract_bid_search/Bid?autoloadGrid=False",
  "https://www.chicago.gov/content/dam/city/depts/dps/WeeklyBidOpportunities/2026WeeklyBidOpportunities/102626.pdf",
  "https://www.wallnj.gov/bids.aspx",
  "https://www.cityofpensacola.com/bids.aspx",
  "https://www.tn.gov/generalservices/procurement/central-procurement-office--cpo-/supplier-information/request-for-proposals--rfp--opportunities1.html",
];
for (const u of urls) {
  try {
    const r = await fetch(u, { headers: { "User-Agent": HONEST, Accept: "text/html,application/pdf,*/*" }, signal: AbortSignal.timeout(25000) });
    const b = await r.arrayBuffer();
    console.log(`${r.status} ${b.byteLength}B server=${r.headers.get("server")} cf=${r.headers.get("cf-ray") ? "yes" : "no"} akamai=${r.headers.get("x-akamai-transformed") || r.headers.get("akamai-grn") ? "yes" : "no"} ${u}`);
  } catch (e) { console.log(`ERR ${String(e).slice(0, 160)} ${u}`); }
  await new Promise((r) => setTimeout(r, 2000));
}

// Read-only: QuestCDN robots, and open-posting counts for public posting groups found by web search. Removed after.
const UA = "Mozilla/5.0 (compatible; ContraxBot/1.0; +https://www.contrax.company)";
const H = "https://qcpi.questcdn.com";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rb = await fetch(`${H}/robots.txt`, { headers: { "User-Agent": UA } });
const rtxt = await rb.text();
console.log("robots", rb.status, rtxt.slice(0, 800).replace(/\n/g, " | "));
const star = rtxt.split(/\n(?=\s*user-agent:)/i).filter((g) => /user-agent:\s*\*\s*$/im.test(g));
const dis = star.flatMap((g) => [...g.matchAll(/^\s*disallow:\s*(\S*)/gim)].map((m) => m[1])).filter(Boolean);
if (rb.status === 200 && dis.some((d) => "/cdn/posting/".startsWith(d.replace(/\*.*$/, "")) || "/cdn/browse_posting/".startsWith(d.replace(/\*.*$/, "")))) { console.log("STOP: robots disallows", dis); process.exit(0); }
const G: [string, string, string][] = [
  ["all", "", ""], ["MN Admin", "6506969", "6506969"],
  ["Farnsworth", "7453865", "7453865"], ["Apex", "1444888", "1444888"], ["MSA", "84", "73347"], ["DGR", "1009", "9342"], ["Olsson", "503874", "503874"],
  ["McClure", "19", "1042295"], ["Town&Country", "39683", "39683"], ["Coleman MI", "6605942", "6605942"], ["Pacific Eng", "4787305", "4787305"], ["Great West", "1469503", "1469503"],
  ["Stahly?", "8019768", "8019768"], ["CBBurke", "2894319", "2894319"], ["Houston Eng", "12", "5492"], ["Hutchison", "1054", "3852214"], ["NV SPWD", "1903611", "1903611"],
  ["Williston", "2542134", "2542134"], ["Denver", "842700", "842700"], ["Cumberland Auth", "4150910", "4150910"], ["Janesville", "73958", "73958"],
  ["EEI Sugar Grove", "6153585", "6153585"], ["Edina", "7223", "7223"], ["Owatonna", "7535", "7535"], ["Laramie", "859921", "859921"], ["Monroe LA", "6595685", "6595685"],
  ["Carthage MO", "8005984", "8005984"], ["Crystal Lake", "8012882", "8012882"], ["Racine", "455428", "455428"], ["NKY Water", "5748519", "5748519"],
  ["Chippewa Hwy", "346333", "346333"], ["Eau Claire Hwy", "6587035", "6587035"], ["Boulder County", "814582", "814582"], ["Omaha/Douglas", "2814495", "2814495"],
  ["Engineering Assoc", "2273024", "2273024"], ["McClelland", "6279755", "6279755"], ["1053/3778128", "1053", "3778128"], ["Baxter Woodman", "332740", "332740"], ["McMahon", "73571", "73571"],
];
for (const [name, group, provider] of G) {
  const page = `${H}/cdn/posting/?projType=all&provider=${provider}&group=${group}`;
  try {
    const p = await fetch(page, { headers: { "User-Agent": UA, Accept: "text/html" }, signal: AbortSignal.timeout(30000) });
    const set: string[] = (p.headers as any).getSetCookie?.() ?? [];
    const cookie = set.map((c) => c.split(";")[0]).join("; ");
    const html = await p.text();
    const title = html.match(/<title>([^<]*)/i)?.[1]?.trim();
    await sleep(1500);
    const r = await fetch(`${H}/cdn/browse_posting/?search_id=&postings_since_last_login=&draw=1&start=0&length=500`, {
      headers: { "User-Agent": UA, Accept: "application/json", "X-Requested-With": "XMLHttpRequest", Referer: page, ...(cookie ? { Cookie: cookie } : {}) }, signal: AbortSignal.timeout(30000),
    });
    const j: any = await r.json().catch(() => null);
    const data: any[] = j?.data ?? [];
    const strip = (s: any) => String(s ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const keys = data[0] ? Object.keys(data[0]).join(",") : "";
    const open = data.filter((d) => { const c = strip(d.render_bid_closing_date ?? d.bid_closing_date); const t = Date.parse(c.replace(/ (CDT|CST|EDT|EST|MDT|MST|PDT|PST)$/, "")); return Number.isFinite(t) && t > Date.now(); });
    const states = [...new Set(data.map((d) => strip(d.render_state ?? d.state)))].slice(0, 8).join("/");
    console.log(`${name} [${group}/${provider}] status=${p.status}/${r.status} title=${title} total=${j?.recordsTotal} rows=${data.length} open=${open.length} states=${states}${name === "all" ? " keys=" + keys : ""}`);
  } catch (e) { console.log(`${name} ERR ${(e as Error).message}`); }
  await sleep(2000);
}

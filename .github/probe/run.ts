// Temporary capture, North Carolina (owner 2026-11-05: a commercial cleaning customer,
// Elite Labor, "We may need to pull more bids for this in NC").
// 1) Aggregate counts only (no PII): open NC bids by source, Janitorial share, NC janitorial
//    titles (public bid titles), cleaning-sounding titles still filed Other.
// 2) Bonfire tenants' public open-opportunities endpoint and CivicEngage bids.aspx boards.
// Kept only when it is a live board; a second fetch 6 s later confirms it.
// No login, detail pages or documents. A page behind a bot check is only noted.
import { mkdirSync, writeFileSync } from "node:fs";
import { sql } from "~/db";
import { LOW_CONTENT_SQL } from "~/lib/low-content";
import { AWARD_EXCLUSION_SQL } from "~/lib/source-class";
import { mapCategory } from "~/lib/trade-classification";
const H = { "user-agent": "Mozilla/5.0 (compatible; ContraxBot/1.0; +https://www.contrax.company)", accept: "application/json, text/html", "x-requested-with": "XMLHttpRequest" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const D = "2026-11-05";
const OUT = "src/jobs/sources/fixtures/nc-capture";
mkdirSync(OUT, { recursive: true });

// 1) aggregates
const s = sql();
const bySource = (await s`
  SELECT source, COUNT(*)::int AS open, COUNT(*) FILTER (WHERE category = 'Janitorial')::int AS janitorial,
         COUNT(*) FILTER (WHERE category = 'Construction')::int AS construction
  FROM bids WHERE due_date > NOW() AND normalized_state = 'NC' AND ${s.unsafe(LOW_CONTENT_SQL)} AND ${s.unsafe(AWARD_EXCLUSION_SQL)}
  GROUP BY source ORDER BY open DESC
`) as any[];
const others = (await s`
  SELECT title, left(coalesce(description,''), 600) AS d FROM bids
  WHERE due_date > NOW() AND normalized_state = 'NC' AND COALESCE(NULLIF(category,''),'Other') = 'Other'
    AND ${s.unsafe(LOW_CONTENT_SQL)} AND ${s.unsafe(AWARD_EXCLUSION_SQL)}
`) as any[];
const refile: Record<string, number> = {};
const cleanTitles: string[] = [];
for (const r of others) {
  const k = mapCategory("", r.title ?? "", r.d ?? "");
  refile[k] = (refile[k] ?? 0) + 1;
  if (k === "Other" && /clean|custod|janitor|porter|sanitiz|floor (care|wax|strip)|window wash|pressure wash|carpet/i.test(String(r.title))) cleanTitles.push(String(r.title).slice(0, 100));
}
const agg = [
  "source | open | janitorial | construction",
  ...bySource.map((r) => `${r.source} | ${r.open} | ${r.janitorial} | ${r.construction}`),
  "",
  `NC Other ${others.length} re-filed: ` + Object.entries(refile).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(" | "),
  `cleaning-sounding titles still Other (${cleanTitles.length}):`,
  ...cleanTitles.slice(0, 40).map((t) => "  " + t),
].join("\n");
const jan = (await s`
  SELECT source, title FROM bids WHERE due_date > NOW() AND normalized_state = 'NC' AND category = 'Janitorial'
    AND ${s.unsafe(LOW_CONTENT_SQL)} AND ${s.unsafe(AWARD_EXCLUSION_SQL)} ORDER BY due_date
`) as any[];
const agg2 = agg + `\n\nNC Janitorial open (${jan.length}):\n` + jan.map((r) => `  ${r.source} | ${String(r.title).slice(0, 110)}`).join("\n");
writeFileSync(`${OUT}/aggregates-${D}.txt`, agg2 + "\n");
console.log(agg2);

// 3a) Bonfire
const tenants = [
  "durham","durhamnc","cityofdurham","dconc","durhamcounty","greensboro","greensboronc","cityofgreensboro","guilfordcounty","guilfordcountync","fayetteville","fayettevillenc","cityoffayetteville","cumberlandcounty","cumberlandcountync","cary","townofcary","carync","mecklenburgcounty","mecknc","asheville","ashevillenc","buncombecounty","buncombecountync","wilmington","wilmingtonnc","concord","concordnc","cabarruscounty","cabarrus","chapelhill","townofchapelhill","orangecountync","hickory","hickorync","catawbacounty","catawbacountync","greenville","greenvillenc","rockymount","rockymountnc","mooresville","huntersville","kannapolis","goldsboro","salisbury","salisburync","sanford","sanfordnc","hollysprings","wakeforest","fuquayvarina","garner","matthews","mintill","cornelius","morrisville","unioncounty","unioncountync","johnstoncounty","johnstonnc","harnettcounty","harnett","onslowcounty","onslow","alamancecounty","alamance","chathamcounty","chathamnc","hendersoncounty","hendersoncountync","davidsoncounty","davidsoncountync","randolphcounty","randolphcountync","lincolncounty","lincolncountync","moorecounty","moorecountync","nashcounty","cravencounty","carteretcounty","forsythcounty","forsyth","wakecounty","wake","newbern","burke","burkecounty","rutherfordcounty","clevelandcounty","surrycounty","stokescounty","wilkescounty","caldwellcounty","haywoodcounty","jacksoncountync","wilsoncounty","wilson","wilsonnc","lenoircounty","kinston","edgecombe","robesoncounty","lumberton","sampsoncounty","dupplin","columbuscounty","pendercounty",
  "cms","cmsk12","wcpss","gcsnc","wsfcs","durhamps","dpsnc","ccs","ccsnc","ocs","chccs","bcsemail","acs","ashevillecityschools","nhcs","ucps","ucpsnc","ics","iss","cabarrusschools","rss","pitt","pittschools","jcsnc","hcs","onslowschools","ocsnc","gcsk12","gaston","gcs",
  "uncc","charlotte","unc","unch","uncg","uncw","ncsu","ncstate","ecu","appstate","wcu","ncat","nccu","fsu","uncfsu","uncp","unca","wssu","ecsu","uncsa","ncssm","cpcc","wtcc","gtcc","fayettevilletech","faytechcc","durhamtech","forsythtech","abtech","cfcc","rccc","gtcc","wakemed","novant","ncdot","ncdps","ncdoa","nc","northcarolina","raleighdurhamairport","rdu","cltairport","gsoairport","ncports","gotriangle","cats","gotransit","ncsea","ncha","charlottehousing","inlivian","rha","raleighhousing","dha","durhamhousing","greensborohousing","ghanc","owasa","cfpua","charlottewater","wsacc",
];
// 3b) CivicEngage
const hosts = [
  "www.durhamnc.gov","www.dconc.gov","www.greensboro-nc.gov","www.guilfordcountync.gov","www.fayettevillenc.gov","www.cumberlandcountync.gov","www.carync.gov","www.mecknc.gov","www.ashevillenc.gov","www.buncombecounty.org","www.wilmingtonnc.gov","www.concordnc.gov","www.cabarruscounty.us","www.townofchapelhill.org","www.orangecountync.gov","www.hickorync.gov","www.catawbacountync.gov","www.greenvillenc.gov","www.rockymountnc.gov","www.mooresvillenc.gov","www.huntersville.org","www.kannapolisnc.gov","www.goldsboronc.gov","www.salisburync.gov","www.sanfordnc.net","www.hollyspringsnc.gov","www.wakeforestnc.gov","www.fuquay-varina.org","www.garnernc.gov","www.matthewsnc.gov","www.minthill.com","www.cornelius.org","www.townofmorrisville.org","www.unioncountync.gov","www.johnstonnc.com","www.harnett.org","www.onslowcountync.gov","www.alamance-nc.com","www.chathamcountync.gov","www.hendersoncountync.gov","www.co.davidson.nc.us","www.randolphcountync.gov","www.lincolncounty.org","www.moorecountync.gov","www.nashcountync.gov","www.cravencountync.gov","www.carteretcountync.gov","www.forsyth.cc","www.wake.gov","www.newbernnc.gov","www.burkenc.org","www.rutherfordcountync.gov","www.clevelandcounty.com","www.co.surry.nc.us","www.wilkescounty.net","www.caldwellcountync.org","www.haywoodcountync.gov","www.jacksonnc.org","www.wilsoncountync.gov","www.wilsonnc.org","www.lenoircountync.gov","www.ci.kinston.nc.us","www.edgecombecountync.gov","www.co.robeson.nc.us","www.lumbertonnc.gov","www.sampsonnc.com","www.columbusco.org","www.pendercountync.gov","www.statesvillenc.net","www.thomasvillenc.gov","www.lexingtonnc.gov","www.asheboronc.gov","www.monroenc.org","www.elizabethcitync.org","www.morgantonnc.gov","www.shelbync.gov","www.havelocknc.us","www.boonenc.gov","www.henderson-nc.gov","www.reidsvillenc.gov","www.clemmons.org","www.kernersville.com","www.indiantrail.org","www.waxhaw.com","www.mebanenc.gov","www.graham-nc.org","www.hillsboroughnc.gov","www.townofknightdale.org","www.wendellnc.gov","www.zebulon.nc.gov","www.clayton-nc.gov","www.smithfield-nc.com","www.townofapexnc.org","www.leland.nc.gov","www.carolinabeach.org","www.emeraldisle-nc.org","www.dunn-nc.org","www.oxfordnc.org","www.roxboronc.com","www.tarboro-nc.com","www.washingtonnc.gov","www.albemarlenc.gov","www.lincolntonnc.org","www.belmontnc.gov","www.mounthollync.gov","www.cherryvillenc.gov","www.kingsmountainnc.com","www.forestcity.net","www.brevardnc.gov","www.hendersonvillenc.gov","www.waynesvillenc.gov","www.blackmountainnc.gov","www.wakeforestnc.gov",
];
const bl: string[] = [];
async function bonfire() {
  for (const t of tenants) {
    const host = `https://${t}.bonfirehub.com`;
    try {
      const r1 = await fetch(`${host}/PublicPortal/getOpenPublicOpportunitiesSectionData`, { headers: H, signal: AbortSignal.timeout(20000) });
      const b1 = r1.ok ? await r1.text() : `HTTP ${r1.status}`;
      let open = -1;
      try { open = Object.keys(JSON.parse(b1).payload.projects).length; } catch {}
      if (open < 0) { bl.push(`${t} | open=-1 | ${b1.slice(0, 40).replace(/\s+/g, " ")}`); await sleep(500); continue; }
      const page = await (await fetch(`${host}/portal/?tab=openOpportunities`, { headers: H, signal: AbortSignal.timeout(20000) })).text();
      const title = (/<title>([^<]*)<\/title>/i.exec(page)?.[1] ?? "").trim();
      await sleep(6000);
      const r2 = await fetch(`${host}/PublicPortal/getOpenPublicOpportunitiesSectionData`, { headers: H, signal: AbortSignal.timeout(20000) });
      const b2 = r2.ok ? await r2.text() : `HTTP ${r2.status}`;
      bl.push(`${t} | title=${title} | open=${open} | same=${b1 === b2}`);
      if (open > 0) {
        const dir = `src/jobs/sources/fixtures/county-bonfire/${t}`;
        mkdirSync(dir, { recursive: true });
        writeFileSync(`${dir}/open-${D}-fetch1.json`, b1);
        writeFileSync(`${dir}/open-${D}-fetch2.json`, b2);
      }
    } catch (e) { bl.push(`${t} | ERR ${String(e).slice(0, 100)}`); }
    await sleep(1000);
  }
}
const cl: string[] = [];
async function civic() {
  for (const h of [...new Set(hosts)]) {
    try {
      const r = await fetch(`https://${h}/bids.aspx`, { headers: { "user-agent": H["user-agent"], accept: "text/html" }, redirect: "follow", signal: AbortSignal.timeout(20000) });
      const b1 = await r.text();
      const isCivic = b1.includes('<div class="bidItems listItems">');
      const items = (b1.match(/class="bidTitle"|BidDetail\.aspx|bids\.aspx\?bidID=/gi) ?? []).length;
      cl.push(`${h} | status=${r.status} | final=${r.url} | civicengage=${isCivic} | itemsLinks=${items}`);
      if (isCivic) {
        await sleep(6000);
        const b2 = await (await fetch(`https://${h}/bids.aspx`, { headers: { "user-agent": H["user-agent"], accept: "text/html" }, redirect: "follow", signal: AbortSignal.timeout(20000) })).text();
        const dir = `src/jobs/sources/fixtures/county-civicengage/${h.replace(/^www\./, "").replace(/\./g, "-")}`;
        mkdirSync(dir, { recursive: true });
        writeFileSync(`${dir}/open-${D}-fetch1.html`, b1);
        writeFileSync(`${dir}/open-${D}-fetch2.html`, b2);
      }
    } catch (e) { cl.push(`${h} | ERR ${String(e).slice(0, 100)}`); }
    await sleep(1200);
  }
}
await Promise.all([bonfire(), civic()]);
writeFileSync(`${OUT}/bonfire-${D}.txt`, bl.join("\n") + "\n");
writeFileSync(`${OUT}/civicengage-${D}.txt`, cl.join("\n") + "\n");
console.log(bl.filter((l) => !l.includes("open=-1")).join("\n"));
console.log(cl.filter((l) => l.includes("civicengage=true")).join("\n"));
process.exit(0);

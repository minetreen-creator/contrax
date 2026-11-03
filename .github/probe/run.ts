// Temporary capture, Texas (owner 2026-11-03: "we need more construction bids in
// TX" → "lets address those new sources"). Each Bonfire tenant's public
// open-opportunities endpoint and each city/county CivicEngage bids.aspx page.
// Kept only when it is a live board; a second fetch 6 s later confirms it.
// No login, detail pages or documents.
import { mkdirSync, writeFileSync } from "node:fs";
const H = { "user-agent": "Mozilla/5.0 (compatible; ContraxBot/1.0; +https://www.contrax.company)", accept: "application/json, text/html", "x-requested-with": "XMLHttpRequest" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const D = "2026-11-03";
const tenants = [
  "fortworthtexas","fortworth","cityoffortworth","arlingtontx","arlington-tx","plano","cityofplano","plano-tx","friscotexas","friscotx","mckinneytexas","mckinneytx","garlandtx","cityofgarland","cityofirving","irvingtx","gptx","grandprairietx","cityofmesquite","mesquitetx","cityofcarrollton","carrolltontx","cor","richardsontx","cityofallen","allentx","cityofdenton","dentontx","roundrocktexas","roundrocktx","georgetowntx","georgetown-tx","sanmarcostx","pflugervilletx","cedarparktexas","leandertx","killeentexas","templetx","wacotexas","cityofwaco","cityoftyler","tylertexas","beaumonttexas","cctexas","corpuschristi","cityoflaredo","laredotexas","cob","brownsvilletx","mcallen","edinburgtexas","harlingentx","amarillo","amarillotx","abilenetx","cosatx","sanangelotx","wichitafallstx","bryantx","cstx","collegestationtx","cityofconroe","sugarlandtx","pearlandtx","missouricitytx","baytown","pasadenatx","leaguecitytx","friendswood","katytx","texascity","cityoflakejackson","victoriatx","ndrtx","newbraunfels","seguintexas","kyletx","buda","boerne","schertz","cibolo","universalcitytx","converse","leonvalley","kerrvilletx","fredericksburgtx","burleson","mansfieldtexas","cedarhilltx","desototexas","duncanville","lancastertx","rowletttx","rockwall","wylietexas","sachse","murphytx","prosper","prospertx","celina","littleelm","thecolony","flowermound","lewisvilletx","coppelltx","grapevinetexas","southlake","keller","northrichlandhills","hurst","euless","bedford","haltomcity","watauga","saginaw","azle","weatherford","granbury","cleburne","midlothian","waxahachie","ennis","corsicana","sherman","denison","greenville","paris","texarkana","longview","marshall","lufkin","nacogdoches","huntsville","navasota","brenham","temple","belton","harkerheights","copperascove","georgetown","hutto","taylortx","manor","lakeway","bastrop","lockhart","sanmarcos","dripping","elpaso","elpasotexas","elpasocounty","epcounty","midlandtx","odessa","bigspring","lubbocktx","ci-lubbock","plainview","pampa","borger","dumas","canyon","hereford",
  "fortbendcountytx","fbctx","mctx","montgomerycountytx","wilco","williamsoncountytx","traviscountytx","traviscounty","bexarcounty","bexar","tarrantcountytx","tarrantcounty","dallascounty","dallascountytx","collincountytx","collincounty","hayscountytx","hayscounty","brazoriacountytx","brazoria","bellcountytx","smithcountytx","mclennancountytx","nuecescountytx","nueces","hidalgocountytx","cameroncountytx","webbcountytx","jeffersoncountytx","ellis","elliscountytx","johnsoncountytx","kaufmancountytx","rockwallcountytx","guadalupecountytx","comalcounty","comalcountytx","bastropcountytx","caldwellcountytx","brazoscountytx","grayson","graysoncountytx","wichitacountytx","taylorcountytx","tomgreencountytx","randallcounty","pottercounty","midlandcountytx","ectorcountytx","victoriacountytx","waller","wallercountytx","libertycountytx","chamberscountytx","orangecountytx","angelinacountytx","gregg","greggcountytx","harrisoncountytx","bowiecountytx",
  "austinisd","dallasisd","houstonisd","fortworthisd","nisd","saisd","northsideisd","katyisd","cfisd","fortbendisd","conroeisd","friscoisd","planoisd","garlandisd","risd","lisd","kleinisd","humbleisd","springisd","aldineisd","pisd","pearlandisd","cisd","roundrockisd","leanderisd","georgetownisd","hayscisd","elpasoisd","episd","ysletaisd","sisd","lubbockisd","amarilloisd","ccisd","mcallenisd","bisd","ectorcountyisd","midlandisd","wacoisd","killeenisd","tylerisd","beaumontisd",
  "austintexas","austin","sanantonio","houstontx","houston","dallas","dfwairport","flydfw","sanantonioairport","fly2houston","portofhouston","porthouston","portofcorpuschristi","lcra","sara-tx","trinityra","brazosra","gbra","ntmwd","trwd","harriscountyflood","hcfcd","dart","capmetro","viainfo","metrohouston","tmobility","nctcog","hgac","capcog","aacog","texasstate","txstate","unt","untsystem","utsystem","utexas","utdallas","uta","utep","utrgv","utmb","uthscsa","uthealth","utsouthwestern","mdanderson","tamucc","tamuk","tarleton","pvamu","tsu","shsu","sfasu","lamar","msutexas","angelo","wtamu","tamu-commerce","twu","ttuhsc","tccd","dcccd","dallascollege","acc","austincc","alamo","hccs","lonestar","sanjac","collin","tstc","blinn","delmar","elpasocc","stc"
];
const lines: string[] = [];
for (const t of tenants) {
  const host = `https://${t}.bonfirehub.com`;
  try {
    const r1 = await fetch(`${host}/PublicPortal/getOpenPublicOpportunitiesSectionData`, { headers: H, signal: AbortSignal.timeout(20000) });
    const b1 = r1.ok ? await r1.text() : `HTTP ${r1.status}`;
    let open = -1;
    try { open = Object.keys(JSON.parse(b1).payload.projects).length; } catch {}
    if (open < 0) { lines.push(`${t} | open=-1 | ${b1.slice(0, 40).replace(/\s+/g, " ")}`); await sleep(800); continue; }
    const page = await (await fetch(`${host}/portal/?tab=openOpportunities`, { headers: H, signal: AbortSignal.timeout(20000) })).text();
    const title = (/<title>([^<]*)<\/title>/i.exec(page)?.[1] ?? "").trim();
    await sleep(6000);
    const r2 = await fetch(`${host}/PublicPortal/getOpenPublicOpportunitiesSectionData`, { headers: H, signal: AbortSignal.timeout(20000) });
    const b2 = r2.ok ? await r2.text() : `HTTP ${r2.status}`;
    lines.push(`${t} | title=${title} | open=${open} | same=${b1 === b2}`);
    if (open > 0) {
      const dir = `src/jobs/sources/fixtures/county-bonfire/${t}`;
      mkdirSync(dir, { recursive: true });
      writeFileSync(`${dir}/open-${D}-fetch1.json`, b1);
      writeFileSync(`${dir}/open-${D}-fetch2.json`, b2);
    }
  } catch (e) { lines.push(`${t} | ERR ${String(e).slice(0, 100)}`); }
  await sleep(1500);
}
mkdirSync("src/jobs/sources/fixtures/county-bonfire", { recursive: true });
writeFileSync(`src/jobs/sources/fixtures/county-bonfire/capture-tx-${D}.txt`, lines.join("\n") + "\n");
console.log(lines.join("\n"));

const hosts = [
  "www.fortworthtexas.gov","www.arlingtontx.gov","www.plano.gov","www.friscotexas.gov","www.mckinneytexas.org","www.garlandtx.gov","www.cityofirving.org","www.gptx.org","www.cityofmesquite.com","www.cityofcarrollton.com","www.cor.net","www.cityofallen.org","www.cityofdenton.com","www.roundrocktexas.gov","georgetowntexas.gov","www.sanmarcostx.gov","www.pflugervilletx.gov","www.cedarparktexas.gov","www.leandertx.gov","www.killeentexas.gov","www.templetx.gov","www.waco-texas.com","www.cityoftyler.org","www.beaumonttexas.gov","www.cctexas.com","www.cityoflaredo.com","www.brownsvilletx.gov","www.mcallen.net","www.cityofedinburg.com","www.myharlingen.us","www.amarillo.gov","www.abilenetx.gov","www.cosatx.us","www.wichitafallstx.gov","www.bryantx.gov","www.cstx.gov","www.cityofconroe.org","www.sugarlandtx.gov","www.pearlandtx.gov","www.missouricitytx.gov","www.baytown.org","www.pasadenatx.gov","www.ci.friendswood.tx.us","www.katytx.gov","www.texascitytx.gov","www.lakejacksontx.gov","www.victoriatx.gov","www.nbtexas.org","www.seguintexas.gov","www.cityofkyle.com","www.ci.buda.tx.us","www.ci.boerne.tx.us","www.schertz.com","www.cibolotx.gov","www.universalcitytexas.com","www.conversetx.net","www.leonvalleytexas.gov","www.kerrvilletx.gov","www.fbgtx.org","www.burlesontx.com","www.mansfieldtexas.gov","www.cedarhilltx.com","www.desototexas.gov","www.duncanvilletx.gov","www.lancaster-tx.com","www.rowletttx.gov","www.rockwall.com","www.wylietexas.gov","www.cityofsachse.com","www.murphytx.org","www.prospertx.gov","www.celina-tx.gov","www.littleelm.org","www.thecolonytx.gov","www.flower-mound.com","www.cityoflewisville.com","www.coppelltx.gov","www.grapevinetexas.gov","www.cityofsouthlake.com","www.cityofkeller.com","www.nrhtx.com","www.hursttx.gov","www.eulesstx.gov","www.bedfordtx.gov","www.haltomcitytx.com","www.cowtx.org","www.saginawtx.org","www.cityofazle.org","www.weatherfordtx.gov","www.granbury.org","www.cleburne.net","www.midlothian.tx.us","www.waxahachie.com","www.ennistx.gov","www.cityofcorsicana.com","www.ci.sherman.tx.us","www.cityofdenison.com","www.ci.greenville.tx.us","www.paristexas.gov","www.texarkanatexas.gov","www.longviewtexas.gov","www.marshalltexas.net","www.cityoflufkin.com","www.ci.nacogdoches.tx.us","www.huntsvilletx.gov","www.navasotatx.gov","www.cityofbrenham.org","www.beltontexas.gov","www.harkerheights.gov","www.copperascovetx.gov","www.huttotx.gov","www.taylortx.gov","www.cityofmanor.org","www.lakeway-tx.gov","www.cityofbastrop.org","www.lockhart-tx.org","www.elpasotexas.gov","www.midlandtexas.gov","www.odessa-tx.gov","www.mybigspring.com","www.ci.lubbock.tx.us","www.mylubbock.us","www.plainviewtx.org","www.cityofpampa.org","www.borgertx.gov","www.dumastx.gov","www.canyontx.com","www.hereford-tx.gov","www.portlavaca.org","www.portarthurtx.gov","www.cityoforange.org","www.nederlandtx.com","www.pflugervilletx.gov","www.alvin-tx.gov","www.angleton.tx.us","www.freeport.tx.us","www.cityofdeerpark.com","www.laportetx.gov","www.seabrooktx.gov","www.webstertx.gov","www.cityofdickinson-tx.gov","www.humbletx.gov","www.tomballtx.gov","www.cityofrosenberg.com","www.richmondtx.gov","www.fulsheartexas.gov","www.stafford-tx.gov","www.bellairetx.gov","www.westu.org","www.cityofwillispoint.com","www.kingsville.texas.gov","www.portaransas-tx.gov","www.rockporttx.gov","www.alicetx.org","www.beevilletx.com","www.delriotx.gov","www.eaglepasstx.us","www.uvaldetx.com","www.mission.gov","www.pharr-tx.gov","www.weslacotx.gov","www.cityofdonna.org","www.cityofsanbenito.com","www.riograndecitytx.gov","www.cityofalamo.org","www.sanjuantexas.com","www.cityofmercedes.com","www.cityofsweetwatertx.gov","www.snydertx.gov","www.brownwoodtexas.gov","www.stephenvilletx.gov","www.mineralwellstx.gov","www.decaturtx.org","www.gainesvilletx.gov","www.bonhamtexas.net","www.sulphurspringstx.org","www.mtpleasanttx.com","www.cityofathenstx.org","www.jacksonvilletx.org","www.palestine-tx.org","www.cityofkilgore.com","www.henderson-tx.gov",
  "www.fortbendcountytx.gov","www.mctx.org","www.wilcotx.gov","www.traviscountytx.gov","www.bexar.org","www.tarrantcountytx.gov","www.dallascounty.org","www.collincountytx.gov","hayscountytx.gov","www.brazoriacountytx.gov","www.bellcountytx.com","www.smith-county.com","www.mclennan.gov","www.nuecesco.com","www.hidalgocounty.us","www.cameroncountytx.gov","www.webbcountytx.gov","www.co.jefferson.tx.us","www.co.ellis.tx.us","www.johnsoncountytx.org","www.kaufmancounty.net","www.rockwallcountytexas.com","www.guadalupetx.gov","www.co.comal.tx.us","www.co.bastrop.tx.us","www.co.caldwell.tx.us","www.brazoscountytx.gov","www.co.grayson.tx.us","www.co.wichita.tx.us","www.taylorcountytexas.org","www.co.tom-green.tx.us","www.randallcounty.com","www.co.potter.tx.us","www.co.midland.tx.us","www.co.ector.tx.us","www.victoriacountytx.org","www.co.waller.tx.us","www.co.liberty.tx.us","www.co.chambers.tx.us","www.co.orange.tx.us","www.angelinacounty.net","www.co.gregg.tx.us","www.co.harrison.tx.us","www.co.bowie.tx.us","www.co.hunt.tx.us","www.co.van-zandt.tx.us","www.henderson-county.com","www.co.wise.tx.us","www.co.kerr.tx.us","www.co.kendall.tx.us","www.co.medina.tx.us","www.co.wilson.tx.us","www.co.atascosa.tx.us","www.co.walker.tx.us","www.co.san-patricio.tx.us","www.co.matagorda.tx.us","www.co.wharton.tx.us","www.co.burnet.tx.us","www.co.llano.tx.us","www.co.erath.tx.us","www.co.hood.tx.us","www.co.parker.tx.us","www.co.palo-pinto.tx.us","www.co.navarro.tx.us"
];
const out: string[] = [];
for (const h of hosts) {
  try {
    const r = await fetch(`https://${h}/bids.aspx`, { headers: { "user-agent": H["user-agent"], accept: "text/html" }, redirect: "follow", signal: AbortSignal.timeout(20000) });
    const b1 = await r.text();
    const civic = b1.includes('<div class="bidItems listItems">');
    const items = (b1.match(/class="bidTitle"|BidDetail\.aspx|bids\.aspx\?bidID=/gi) ?? []).length;
    out.push(`${h} | status=${r.status} | final=${r.url} | civicengage=${civic} | itemsLinks=${items}`);
    if (civic) {
      await sleep(6000);
      const b2 = await (await fetch(`https://${h}/bids.aspx`, { headers: { "user-agent": H["user-agent"], accept: "text/html" }, redirect: "follow", signal: AbortSignal.timeout(20000) })).text();
      const dir = `src/jobs/sources/fixtures/county-civicengage/${h.replace(/^www\./, "").replace(/\./g, "-")}`;
      mkdirSync(dir, { recursive: true });
      writeFileSync(`${dir}/open-${D}-fetch1.html`, b1);
      writeFileSync(`${dir}/open-${D}-fetch2.html`, b2);
    }
  } catch (e) { out.push(`${h} | ERR ${String(e).slice(0, 100)}`); }
  await sleep(1500);
}
mkdirSync("src/jobs/sources/fixtures/county-civicengage", { recursive: true });
writeFileSync(`src/jobs/sources/fixtures/county-civicengage/tx-capture-${D}.txt`, out.join("\n") + "\n");
console.log(out.join("\n"));

// TEMP read-only: what does Dubuque's purchasing page point to now? ContraxBot UA; robots allows this path.
const UA = "Mozilla/5.0 (compatible; ContraxBot/1.0; +https://www.contrax.company)";
const r = await fetch("https://www.cityofdubuque.org/432/Purchasing-Services-Bid-Opportunities", { headers: { "User-Agent": UA, Accept: "text/html,*/*" }, signal: AbortSignal.timeout(30_000) });
const html = await r.text();
console.log("DBQ2 status", r.status, html.length);
const main = html.slice(Math.max(0, html.search(/id="page"|id="moduleContent"|class="fr-view"|<main/i)));
const text = main.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
const i = text.search(/bid opportunit|current bids|request for proposal|solicitation/i);
console.log("DBQ2 text: " + text.slice(Math.max(0, i - 200), i + 1500));
const links = [...html.matchAll(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]{0,160}?)<\/a>/gi)].map((m) => [m[1].replace(/&amp;/g, "&"), m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 70)]);
const keep = links.filter(([h, t]) => /^https?:\/\/(?!www\.cityofdubuque\.org)/i.test(h) ? /bid|rfp|procure|purchas|solicit|vendor|quest|bonfire|ionwave|opengov|demandstar|planroom|public ?purchase|beacon/i.test(h + " " + t) : /bid|rfp|solicit|DocumentCenter|planroom/i.test(h + " " + t));
console.log("DBQ2 links: " + JSON.stringify([...new Map(keep.map((l) => [l[0], l])).values()].slice(0, 40)));
process.exit(0);

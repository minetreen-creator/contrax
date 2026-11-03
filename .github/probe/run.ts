// Temporary look at Beacon, pass 3 (owner 2026-11-03: Houston). Sends the public
// page's own ListSolicitations / ListAgencies queries, with no login, to see
// whether the open list answers anonymously. Nothing else.
import { mkdirSync, writeFileSync } from "node:fs";
const UA = "Mozilla/5.0 (compatible; ContraxBot/1.0; +https://www.contrax.company)";
const dir = "src/jobs/sources/fixtures/beacon";
mkdirSync(dir, { recursive: true });
const log: string[] = [];
const gql = async (name: string, query: string, variables: Record<string, unknown>) => {
  try {
    const r = await fetch("https://www.beaconbid.com/api/gql", {
      method: "POST",
      headers: { "user-agent": UA, "content-type": "application/json", accept: "application/json", referer: "https://www.beaconbid.com/solicitations/city-of-houston/open" },
      body: JSON.stringify({ operationName: query.match(/query (\w+)/)![1], query, variables }),
      signal: AbortSignal.timeout(25000),
    });
    const b = await r.text();
    log.push(`${name} | ${r.status} | ${b.length} | ${b.slice(0, 300).replace(/\s+/g, " ")}`);
    writeFileSync(`${dir}/${name}.json`, b);
  } catch (e) { log.push(`${name} | ERR ${String(e).slice(0, 120)}`); }
  await new Promise((r) => setTimeout(r, 1500));
};
const LIST = `query ListSolicitations($agencyTag: String, $status: String, $start: Int, $pageSize: Int) {
  solicitations(agencyTag: $agencyTag, status: $status, start: $start, pageSize: $pageSize) {
    total
    data { id title refnum dueDate type status }
  }
}`;
await gql("houston-open-min", LIST, { agencyTag: "city-of-houston", status: "open", start: 0, pageSize: 100 });
const LIST2 = `query ListSolicitations($agencyTag: String, $status: String, $start: Int, $pageSize: Int) {
  solicitations(agencyTag: $agencyTag, status: $status, start: $start, pageSize: $pageSize) {
    total
    data { id title refnum dueDate type status description department agency { id name tag location } }
  }
}`;
await gql("houston-open-more", LIST2, { agencyTag: "city-of-houston", status: "open", start: 0, pageSize: 100 });
const AG = `query ListAgencies($filter: String, $status: String, $start: Int, $pageSize: Int) {
  agencies(filter: $filter, status: $status, start: $start, pageSize: $pageSize) {
    total
    data { id name tag location openSolicitationsTotal }
  }
}`;
await gql("agencies-tx", AG, { filter: "TX", start: 0, pageSize: 200 });
await gql("agencies-texas", AG, { filter: "Texas", start: 0, pageSize: 200 });
writeFileSync(`${dir}/look3.txt`, log.join("\n") + "\n");
console.log(log.join("\n"));

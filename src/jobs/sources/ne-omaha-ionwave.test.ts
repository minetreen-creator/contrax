import { expect,test } from "bun:test";
import { readFileSync } from "node:fs";
import { readOmahaPage,mapOmahaDetails,omahaClose,omahaNextPageForm } from "./ne-omaha-ionwave";
import { SOURCE_HOME_JURISDICTIONS } from "~/lib/location-state";
import { TAIL_SOURCES } from "../runner";
const fixture=(name:string)=>readFileSync(new URL(`./fixtures/ne-omaha/${name}`,import.meta.url),"utf8");
const list=fixture("current-2026-10-08.html"),detail=fixture("detail1267-2026-10-08.html");
const items=readOmahaPage(list).items;
const before=Date.parse("2026-10-08T18:00:00Z");
test("captured board has eight identities and published closing times",()=>{
 const p=readOmahaPage(list);expect(p.total).toBe(8);expect(p.pages).toBe(1);expect(p.items.length).toBe(8);
 expect(new Set(p.items.map(i=>i.id)).size).toBe(8);expect(p.items.filter(i=>i.number.startsWith("CI-")).length).toBe(7);
 expect(p.items[0].id).toBe("1267");expect(p.items[0].close).toBe("10/21/2026 11:00:00 AM (CT)");
});
test("city detail is authoritative; county notice stays excluded",()=>{
 const r=mapOmahaDetails([items[0],items[4]],new Map([["1267",detail]]),before);
 expect(r.rows.length).toBe(1);expect(r.skipped.outside_city_scope).toBe(1);
 const row=r.rows[0];expect(row.agency).toBe("City of Omaha");expect(row.due_date).toBe("2026-10-21T16:00:00.000Z");
 expect(row.source_url).toBe("https://douglascountypurchasing.ionwave.net/PublicDetail.aspx?bidID=1267&SourceType=1");
 expect(row.description).toContain("City of Omaha is requesting bids");expect(row.naics_code).toBeNull();expect(row.psc).toBeNull();expect(row.set_aside).toBeNull();
});
test("CT deadline conversion includes summer, winter, midnight and invalid times",()=>{
 expect(omahaClose("12/21/2026 11:00:00 AM (CT)")).toBe("2026-12-21T17:00:00.000Z");
 expect(omahaClose("10/21/2026 12:00:00 AM (CT)")).toBe("2026-10-21T05:00:00.000Z");
 expect(omahaClose("2/30/2026 11:00:00 AM (CT)")).toBeNull();expect(omahaClose("3/8/2026 02:30:00 AM (CT)")).toBeNull();
 expect(omahaClose("10/21/2026 11:00:00 AM (ET)")).toBeNull();
});
test("closed and duplicate rows do not create new opportunities",()=>{
 expect(mapOmahaDetails([items[0]],new Map([["1267",detail]]),Date.parse("2026-10-21T16:00:00Z")).skipped.closed).toBe(1);
 expect(mapOmahaDetails([items[0],items[0]],new Map([["1267",detail]]),before).skipped.duplicate).toBe(1);
});
test("unreadable list, missing details and buyer or date mismatches fail closed",()=>{
 expect(()=>readOmahaPage("Access Denied")).toThrow();expect(()=>readOmahaPage(list.replace('"BidID":"1267"','"BidID":""'))).toThrow();
 expect(()=>mapOmahaDetails([items[0]],new Map(),before)).toThrow();
 expect(()=>mapOmahaDetails([items[0]],new Map([["1267",detail.replace("City - Request for Bid","County - Request for Bid")]]),before)).toThrow();
 expect(()=>mapOmahaDetails([items[0]],new Map([["1267",detail.replace("10/21/2026 11:00:00 AM","10/22/2026 11:00:00 AM")]]),before)).toThrow();
});
test("pagination posts the actual Next Page control and preserves hidden state",()=>{
 const form=omahaNextPageForm('<input type="hidden" name="__VIEWSTATE" value="state&amp;value"/><input type="submit" name="actual$next" value=" " title="Next Page"/>');
 expect(form.get("__VIEWSTATE")).toBe("state&value");expect(form.get("actual$next")).toBe(" ");
 expect(()=>omahaNextPageForm('<input type="submit" name="next" onclick="return false;" title="Next Page"/>')).toThrow();
});
test("registered as local Nebraska source",()=>{
 expect(SOURCE_HOME_JURISDICTIONS.ne_omaha_ionwave).toBe("NE");expect(TAIL_SOURCES.some(s=>s.name==="ne_omaha_ionwave")).toBe(true);
});

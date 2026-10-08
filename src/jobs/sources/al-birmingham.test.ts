import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { birminghamDeadline, parseBirminghamPayload, parseBirminghamHtml } from "./al-birmingham";
import { TAIL_SOURCES } from "../runner";
import { SOURCE_HOME_JURISDICTIONS } from "~/lib/location-state";
const captured = JSON.parse(readFileSync(new URL("./fixtures/al-birmingham/purchasing-2026-10-08.json", import.meta.url),"utf8"));
const before = Date.parse("2026-10-08T18:00:00Z");
const copy = () => structuredClone(captured);
test("real captured purchasing bids: deadlines, documents, identifiers and unknown fields", () => {
  const result = parseBirminghamPayload(captured,before);
  expect(result.rows.length).toBe(2);
  const gear = result.rows.find(r => r.solicitation_number === "27-11")!;
  expect(gear.due_date).toBe("2026-10-08T23:00:00.000Z");
  expect(gear.source_url).toContain(".pdf");
  expect(gear.location).toBe("Birmingham, AL");
  expect(gear.set_aside).toBeNull();
  expect(gear.naics_code).toBeNull();
  expect(gear.psc).toBeNull();
  expect(result.rows.find(r => r.solicitation_number === "27-08")!.due_date).toBe("2026-10-13T23:00:00.000Z");
});
test("closed bids are skipped at the submission deadline", () => {
  const r = parseBirminghamPayload(captured,Date.parse("2026-10-08T23:00:00Z"));
  expect(r.rows.length).toBe(1); expect(r.skipped.closed).toBe(1);
});
test("literal CDT differs from CST; impossible dates and missing times rejected", () => {
  expect(birminghamDeadline("Bids Due: Thursday, October 08, 2026, by 5:00 p.m. CDT")?.iso).toBe("2026-10-08T22:00:00.000Z");
  expect(birminghamDeadline("Bids Due: February 30, 2026, by 5:00 p.m. CST")).toBeNull();
  expect(birminghamDeadline("Bids Due: October 08, 2026")).toBeNull();
  expect(birminghamDeadline("Bid Opening October 08, 2026, by 5:00 p.m. CST")).toBeNull();
});
test("duplicates collapse and damaged rows are accounted for", () => {
  const p=copy(); const c=p.props.pageProps.nodeResource.content;
  c.push(structuredClone(c[1]));
  expect(parseBirminghamPayload(p,before).skipped.duplicate).toBe(1);
  c[1].body.processed="Bids Due: no date";
  expect(parseBirminghamPayload(p,before).skipped.invalid_deadline).toBe(1);
});
test("fail closed on changed payload, inaccessible pages and invalid documents", () => {
  expect(() => parseBirminghamHtml("<h1>403 Forbidden</h1>")).toThrow();
  expect(() => parseBirminghamPayload({})).toThrow();
  const p=copy(); p.props.pageProps.nodeResource.content=[];
  expect(() => parseBirminghamPayload(p)).toThrow();
  p.props.pageProps.nodeResource.content=[{body:{processed:"No current bids"}}];
  expect(parseBirminghamPayload(p).rows).toEqual([]);
  const q=copy(); for(const c of q.props.pageProps.nodeResource.content) if(c.title)c.body.processed=c.body.processed.replace(/\.pdf/gi,".exe");
  expect(() => parseBirminghamPayload(q,before)).toThrow();
});
test("local Alabama registration", () => {
  expect(TAIL_SOURCES.some(s=>s.name==="al_birmingham_purchasing")).toBe(true);
  expect(SOURCE_HOME_JURISDICTIONS.al_birmingham_purchasing).toBe("AL");
});

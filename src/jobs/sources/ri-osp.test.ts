import { describe, expect, test } from "bun:test";
import { createHash, X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";
import { buildRiOspRows, riOspBidUrl, type RiOspRecord } from "./ri-osp";

const fixture = JSON.parse(
  gunzipSync(readFileSync(join(import.meta.dir, "fixtures", "ri-osp", "open-sols-2026-10-06.json.gz"))).toString(),
) as { hits: number; records: RiOspRecord[] };
const NOW = Date.parse("2026-10-06T14:00:00Z");

describe("ri_osp: Rhode Island Ocean State Procures (owner 2026-10-06)", () => {
  test("every open solicitation in the capture becomes a row", () => {
    expect(fixture.hits).toBe(81);
    const r = buildRiOspRows(fixture.records, NOW);
    expect(r.rows.length).toBe(81);
    expect(r.skipped).toEqual({});
  });

  test("a RIDOT bid keeps its agency, type, number, deadline and link", () => {
    const r = buildRiOspRows(fixture.records, NOW);
    const steel = r.rows.find((b) => b.title === "2026 Statewide Steel Repairs")!;
    expect(steel.agency).toBe("State of Rhode Island, Dept of Transportation");
    expect(steel.notice_type).toBe("RIDOT Construction Bid");
    expect(steel.solicitation_number).toBe("TCB27006870");
    expect(steel.due_date).toBe("2026-10-23T17:00:00.000Z");
    expect(steel.location).toBe("Rhode Island");
    expect(steel.source_url).toBe(riOspBidUrl(144820));
    expect(steel.external_id).toBe("riosp-144820");
  });

  test("open enrollments say what they are", () => {
    const r = buildRiOspRows(fixture.records, NOW);
    const oe = r.rows.filter((b) => /^Open Enrollment/.test(b.notice_type ?? ""));
    expect(oe.length).toBe(65);
    expect(oe.every((b) => b.description.includes("Open Enrollment"))).toBe(true);
  });

  test("skips: passed, unreadable, missing, repeated", () => {
    const base = { bidid: 1, title: "X", openDate: NOW + 1000 };
    const r = buildRiOspRows(
      [base, { ...base }, { ...base, bidid: 2, openDate: NOW - 1000 }, { ...base, bidid: 3, openDate: null }, { bidid: 4, title: "" }],
      NOW,
    );
    expect(r.rows.length).toBe(1);
    expect(r.skipped).toEqual({ duplicate: 1, closed: 1, bad_date: 1, missing_fields: 1 });
  });

  test("the pinned intermediate is the real Thawte TLS RSA CA G1", () => {
    const src = readFileSync(join(import.meta.dir, "ri-osp.ts"), "utf8");
    const pem = /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/.exec(src)![0];
    const cert = new X509Certificate(pem);
    expect(cert.subject).toContain("CN=Thawte TLS RSA CA G1");
    expect(cert.issuer).toContain("CN=DigiCert Global Root G2");
    expect(createHash("sha256").update(cert.raw).digest("hex").toUpperCase()).toBe(
      "4BCC5E234FE81EDE4EAF883AA19C31335B0B26E85E066B9945E4CB6153EB20C2",
    );
  });
});

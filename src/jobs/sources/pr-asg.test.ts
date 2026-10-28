import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { TAIL_SOURCES } from "../runner";
import { SOURCE_CLASSES } from "~/lib/source-class";
import { SOURCE_HOME_JURISDICTIONS, deriveInsertLocationColumns } from "~/lib/location-state";
import { asgDateToIso, asgListUrl, asgRow, parseAsgDetail, parseAsgList } from "./pr-asg";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/pr-asg/${name}`, import.meta.url), "utf8");
const now = Date.parse("2026-10-28T20:00:00Z");

describe("Puerto Rico ASG portal", () => {
  test("list page: 27 newest cards with method, agency, number and purpose", () => {
    const cards = parseAsgList(fixture("list-2026-10-28-fetch1.html"));
    expect(cards).toHaveLength(27);
    expect(parseAsgList(fixture("list-2026-10-28-fetch2.html"))).toEqual(cards);
    expect(cards[0]).toEqual({
      method: "Solicitud de Propuesta (RFP)",
      agency: "Instituto de Cultura Puertorriqueña",
      number: "27J-03663",
      purpose:
        "CONTRATACIÓN DE SERVICIOS DE DISEÑO Y CONSTRUCCIÓN PARA LA RESTAURACIÓN DE LA CASA CONCHA MELÉNDEZ DEL INSTITUTO DE CULTURA PUERTORRIQUEÑA DEL GOBIERNO DE PUERTO RICO",
    });
    expect(new Set(cards.map((c) => c.number)).size).toBe(27);
    // Zero-width characters in a purpose are removed.
    expect(cards.every((c) => !/[​‌‍﻿]/.test(c.purpose))).toBe(true);
    expect(asgListUrl(1)).toBe("https://asg.pr.gov/subastas");
    expect(asgListUrl(2)).toBe("https://asg.pr.gov/subastas?page=2&order_by=-creado&date_scope=link");
  });

  test("detail page: town and the bid opening (Puerto Rico time, UTC-4)", () => {
    expect(parseAsgDetail(fixture("detail-27J-03663.html"))).toEqual({ localidad: "San Juan", apertura: "2026-12-03T14:00:00.000Z" });
    expect(parseAsgDetail(fixture("detail-27J-04466.html"))).toEqual({ localidad: "San Juan", apertura: "2026-11-30T15:30:00.000Z" });
    expect(asgDateToIso("5 de enero de 2027", "2:15 PM")).toBe("2027-01-05T18:15:00.000Z");
    expect(asgDateToIso("5 de enero de 2027", null)).toBe("2027-01-06T03:59:00.000Z");
    expect(asgDateToIso("no date", null)).toBeNull();
  });

  test("rows: Spanish title kept, placed in Puerto Rico, linked to the notice", () => {
    const card = parseAsgList(fixture("list-2026-10-28-fetch1.html"))[0];
    const row = asgRow(card, parseAsgDetail(fixture("detail-27J-03663.html")), now);
    if ("skip" in row) throw new Error("expected a row");
    expect(row.external_id).toBe("prasg-27J-03663");
    expect(row.location).toBe("San Juan, PR");
    expect(row.source_url).toBe("https://asg.pr.gov/subastas27J-03663");
    expect(row.due_date).toBe("2026-12-03T14:00:00.000Z");
    expect(row.description).toContain("request for proposals (RFP) 27J-03663");
    expect(deriveInsertLocationColumns({ ...row, sourceName: "pr_asg" }).normalized_state).toBe("PR");
  });

  test("RFIs, missing openings and past openings are skipped", () => {
    const card = { method: "Subasta Formal", agency: "X", number: "27J-1", purpose: "OBRA" };
    expect(asgRow({ ...card, method: "Solicitud de Información (RFI)" }, { localidad: null, apertura: "2027-01-01T00:00:00.000Z" }, now)).toEqual({ skip: "not_a_bid" });
    expect(asgRow(card, { localidad: null, apertura: null }, now)).toEqual({ skip: "no_deadline" });
    expect(asgRow(card, { localidad: null, apertura: "2026-10-01T00:00:00.000Z" }, now)).toEqual({ skip: "closed" });
    const row = asgRow(card, { localidad: null, apertura: "2027-01-01T00:00:00.000Z" }, now);
    expect("skip" in row ? null : row.location).toBe("Puerto Rico");
  });

  test("scheduled, classified as Puerto Rico's state portal", () => {
    expect(TAIL_SOURCES.some((t) => t.name === "pr_asg")).toBe(true);
    expect(SOURCE_CLASSES["pr_asg"]).toEqual({ class: "state", scopeState: "PR", searchScope: "state-portal", recordType: "opportunity" });
    expect(SOURCE_HOME_JURISDICTIONS["pr_asg"]).toBe("PR");
  });
});

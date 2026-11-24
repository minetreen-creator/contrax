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
    expect(row.source_url).toBe("https://asg.pr.gov/subastas/27J-03663");
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
  // The portal was rebuilt in November 2026 (two failed syncs, alert 2026-11-24). Markup as fetched that morning.
  test("rebuilt portal: the new cards and the month/day/year opening are read", () => {
    const list = `<div class="subastas-card-head"><h2 class="subastas-card-title">Subasta Formal</h2> </div> <div class="subastas-card-body"> <h3 class="subastas-case-heading">27J-07152</h3> <span class="subastas-status-badge">Abierta</span>
      <div class="subastas-agency-desc"> <p class="subastas-card-agency">Compañía de Fomento Industrial</p> <p class="subastas-card-summary">DEMOLICIÓN Y DISPOSICIÓN DE EDIFICIOS INDUSTRIALES UBICADO EN EL MUNICIPIO DE CANOVANAS </p> </div> </div>
      <a class="subastas-card-link" href="/subastas/27J-07152">Ver detalle</a>
      <h2 class="subastas-card-title">Subasta Informal</h2> <h3 class="subastas-case-heading">27J-01687</h3> <p class="subastas-card-agency">Gerencia y Presupuesto</p> <p class="subastas-card-summary">REMODELACIÓN DEL TERCER PISO</p>`;
    const cards = parseAsgList(list);
    expect(cards.map((c) => c.number)).toEqual(["27J-07152", "27J-01687"]);
    expect(cards[0]).toMatchObject({ method: "Subasta Formal", agency: "Compañía de Fomento Industrial" });
    expect(cards[0]!.purpose.startsWith("DEMOLICIÓN Y DISPOSICIÓN")).toBe(true);
    const detail = parseAsgDetail(`<article class="subasta-meeting-item"> <h3 class="subasta-meeting-title">Reunión Pre-subasta</h3> <p class="subasta-meeting-meta"> 12/02/2026 · 9:00 AM </p></article>
      <article class="subasta-meeting-item"> <div class="subasta-meeting-content"> <h3 class="subasta-meeting-title">Acto de Apertura</h3> <p class="subasta-meeting-meta"> <i class="far fa-calendar-alt" aria-hidden="true"></i> 01/13/2027 · 10:30 AM - Virtual </p></div></article>`);
    expect(detail.apertura).toBe("2027-01-13T14:30:00.000Z");
    expect(detail.localidad).toBeNull();
    const row = asgRow(cards[0]!, detail, Date.parse("2026-11-24T00:00:00Z")) as { source_url: string; location: string; due_date: string };
    expect(row.source_url).toBe("https://asg.pr.gov/subastas/27J-07152");
    expect(row.location).toBe("Puerto Rico");
    expect(row.due_date).toBe("2027-01-13T14:30:00.000Z");
  });
});

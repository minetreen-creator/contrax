import { describe, expect, test } from "bun:test";
import { inferNaics } from "./naics-infer";

// Owner 2026-11-08: a 237310 (highway, street and bridge) search in Idaho found 3 of ITD's 13 open
// road projects. ITD titles are route names; its description (src/jobs/sources/id-itd.ts) names the
// work "highway construction and maintenance".
const itdDesc = (key: string) =>
  `Idaho Transportation Department highway construction and maintenance project, key number ${key} (Major Highways, Federal funding, District 6).`;

describe("ITD road projects infer 237310", () => {
  test("route-name titles with ITD's description are highway construction", () => {
    for (const title of [
      "1ST STREET WIDENING, AMMON",
      "US-20, MP 291 TO IDAHO FALLS",
      "N 10TH AVE ITS & OVERLAY",
      "SH-55, HORSESHOE BEND DRAINAGE IMPROVEMENTS",
      "PRAIRIE AVE; MEYER RD TO SH-41E",
      "NORTHSIDE BLVD AND KARCHER RD, CITY OF NAMPA",
    ]) {
      expect(inferNaics(title, itdDesc("24168"))).toBe("237310");
    }
  });

  test("a lone 'highway' still does not tag a non-road job", () => {
    expect(inferNaics("Janitorial Services", "Cleaning for the State Highway Patrol district office.")).not.toBe("237310");
  });
});

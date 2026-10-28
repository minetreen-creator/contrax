import { describe, expect, test } from "bun:test";
import { expandTrade, isStrongTradeMatch, MAX_EXPANDED_TERMS, SPANISH_TRADE_TERMS, TRADE_ALIASES } from "./trade-registry";

const matches = (trade: string, title: string) => isStrongTradeMatch(title, null, "", null, expandTrade(trade));

// Owner 2026-10-28: Puerto Rico's ASG portal titles are in Spanish.
describe("Spanish trade terms", () => {
  test("every Spanish list belongs to a real trade", () => {
    for (const key of Object.keys(SPANISH_TRADE_TERMS)) expect(TRADE_ALIASES[key]).toBeTruthy();
  });

  test("they are added after the English list, which keeps its cap", () => {
    const e = expandTrade("construction");
    const english = e.terms.filter((t) => !SPANISH_TRADE_TERMS.construction.includes(t));
    expect(english.length).toBeLessThanOrEqual(MAX_EXPANDED_TERMS);
    expect(e.terms.slice(-SPANISH_TRADE_TERMS.construction.length)).toEqual([...SPANISH_TRADE_TERMS.construction]);
  });

  test("real ASG titles match their trade", () => {
    expect(matches("construction", "PARA LA REMODELACIÓN DE LOS BAÑOS DE LOS EDIFICIOS 231 Y 233 DEL FUERTE ALLEN")).toBe(true);
    expect(matches("construction", "DEMOLICIÓN DE EDIFICIOS INDUSTRIALES DE LA COMPAÑÍA DE FOMENTO INDUSTRIAL")).toBe(true);
    expect(matches("construction", "PARA LA REHABILITACIÓN DEL EDIFICIO LILA MAYORAL")).toBe(true);
    expect(matches("janitorial", "SERVICIOS DE LIMPIEZA Y CONSERJERÍA PARA LAS OFICINAS REGIONALES")).toBe(true);
    expect(matches("landscaping", "MANTENIMIENTO DE ÁREAS VERDES EN LAS ESCUELAS DE LA REGIÓN DE PONCE")).toBe(true);
    expect(matches("hvac", "REPARACIÓN DE UNIDADES DE AIRE ACONDICIONADO CENTRAL")).toBe(true);
    expect(matches("security guard", "SERVICIOS DE GUARDIAS DE SEGURIDAD PARA EL CENTRO GUBERNAMENTAL")).toBe(true);
  });

  test("an agency name with 'seguridad' is not guard work", () => {
    expect(matches("security guard", "MEJORAS Y REMODELACIÓN AL CENTRO DE MANDO Y DE LA OFICINA DE SEGURIDAD")).toBe(false);
    expect(matches("security guard", "ADQUISICIÓN DE RADIOS PORTÁTILES PARA LA POLICÍA")).toBe(false);
  });

  test("English matching is unchanged", () => {
    expect(matches("construction", "Roof replacement at the county courthouse")).toBe(true);
    expect(matches("janitorial", "Janitorial services for the main library")).toBe(true);
    expect(matches("construction", "Purchase of office paper")).toBe(false);
  });
});

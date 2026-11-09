import { describe, expect, test } from "bun:test";
import { checkMaxDates, dateCorrection, extractDates } from "./max-trust";

// Owner 2026-11-09: date checks on Max answers ("forget the sources").
const today = new Date("2026-11-09T15:00:00Z");
const lexington = {
  dueDates: ["2026-12-07"],
  text: JSON.stringify({
    bid: { title: "Request for Qualifications for Progressive Design-Build Services", due: "Mon Dec 07 2026", set_aside: null,
      description: "A pre-submittal meeting will be held on November 18, 2026 at City Hall. Questions are due by 11/24/2026. The selected DB team will provide integrated design." },
  }),
};

describe("date check", () => {
  test("finds dates in English, Spanish, Chinese and numeric forms; ignores fractions", () => {
    const d = extractDates("Due December 7, 2026 or Dec. 7th; el 7 de diciembre de 2026; 2026年12月7日; 12/7/2026; a 1/2 acre lot");
    expect(d.map((x) => `${x.month}/${x.day}`)).toEqual(["12/7", "12/7", "12/7", "12/7", "12/7"]);
  });

  test("the right due date passes", () => {
    expect(checkMaxDates("It's due December 7, so plan ahead.", lexington, today)).toEqual({ status: "ok", due: "2026-12-07", mismatches: [] });
  });

  test("a date written in the notice (meeting, questions) passes", () => {
    expect(checkMaxDates("There's a pre-submittal meeting November 18 and questions close 11/24/2026.", lexington, today).status).toBe("ok");
  });

  test("a wrong due date is caught and corrected in the answer's language", () => {
    const c = checkMaxDates("It's due December 2, so move fast.", lexington, today);
    expect(c).toEqual({ status: "corrected", due: "2026-12-07", mismatches: ["December 2"] });
    expect(dateCorrection(c, "en")).toBe(" Correction: the notice lists the due date as December 7, 2026.");
    expect(dateCorrection(c, "es")).toBe(" Corrección: según el aviso, la fecha límite es el 7 de diciembre de 2026.");
    expect(dateCorrection(c, "zh")).toBe(" 更正：根据公告，截止日期是2026年12月7日。");
  });

  test("with several bids, a wrong date points to the cards", () => {
    const c = checkMaxDates("The first one closes January 9.", { dueDates: ["2026-12-01", "2026-12-15"], text: "" }, today);
    expect(c.status).toBe("corrected");
    expect(dateCorrection(c, "en")).toBe(" Check the due dates on the cards below: they come straight from each notice.");
  });

  test("today's date and answers without dates pass", () => {
    expect(checkMaxDates("As of November 9, it's still open.", lexington, today).status).toBe("ok");
    expect(checkMaxDates("Register in SAM.gov first; it's free.", lexington, today).status).toBe("none");
  });
});

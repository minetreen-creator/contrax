import { describe, expect, test } from "bun:test";
import { dueSoonPush, inSendingHours, newMatchesPush } from "./member-push";
import { stateFromCoords } from "./state-from-coords";

describe("newMatchesPush", () => {
  test("one bid opens that bid", () => {
    const p = newMatchesPush([{ id: 7, title: "Mowing Services", agency: "City of Austin" }], "landscaping in TX")!;
    expect(p.title).toBe("🔔 New bid for landscaping in TX");
    expect(p.body).toBe("Mowing Services · City of Austin");
    expect(p.url).toBe("/bid/7");
  });
  test("several bids open the app's new list", () => {
    const p = newMatchesPush([{ id: 1, title: "A", agency: "" }, { id: 2, title: "B", agency: "" }, { id: 3, title: "C", agency: "" }], "")!;
    expect(p.title).toBe("🔔 3 new bids");
    expect(p.body).toBe("A and 2 more");
    expect(p.url).toBe("/app?view=new");
  });
  test("nothing to send", () => expect(newMatchesPush([], "x")).toBeNull());
});

test("dueSoonPush says tomorrow or in N days", () => {
  const now = Date.parse("2026-11-07T15:00:00Z");
  expect(dueSoonPush({ id: 1, title: "Roof", dueIso: "2026-11-08T15:00:00Z" }, now).title).toBe("⏰ Saved bid due tomorrow");
  expect(dueSoonPush({ id: 1, title: "Roof", dueIso: "2026-11-09T15:00:00Z" }, now).title).toBe("⏰ Saved bid due in 2 days");
});

test("no buzzing at night (Eastern)", () => {
  expect(inSendingHours(new Date("2026-11-07T15:00:00Z"))).toBe(true); // 10 AM ET
  expect(inSendingHours(new Date("2026-11-08T03:00:00Z"))).toBe(false); // 10 PM ET
  expect(inSendingHours(new Date("2026-11-07T11:30:00Z"))).toBe(false); // 6:30 AM ET
});

test("stateFromCoords", () => {
  expect(stateFromCoords(30.27, -97.74)).toBe("TX"); // Austin
  expect(stateFromCoords(37.54, -77.44)).toBe("VA"); // Richmond
  expect(stateFromCoords(38.9, -77.03)).toBe("DC"); // Washington
  expect(stateFromCoords(39.1, -94.58)).toBe("MO"); // Kansas City, MO
  expect(stateFromCoords(51.5, -0.12)).toBeNull(); // London
});

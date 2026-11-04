import { describe, expect, test } from "bun:test";
import { CITY_SOURCES, cityProcurementDeps } from "./city-procurement";

// Owner 2026-11-04: NYC Open Data closed the socket mid-sync, then answered fine.
describe("city open-data feeds retry a dropped connection once", () => {
  const nyc = CITY_SOURCES.find((s) => s.name === "nyc_open_data")!;
  const row = { request_id: "20261102001", short_title: "Curb replacement", agency_name: "DOT", due_date: "2026-12-10T16:00:00.000" };
  test("one dropped connection, then rows", async () => {
    const saved = { ...cityProcurementDeps };
    let calls = 0;
    cityProcurementDeps.pause = async () => {};
    cityProcurementDeps.fetch = async () => {
      calls++;
      if (calls === 1) throw new Error("The socket connection was closed unexpectedly");
      return new Response(JSON.stringify([row]), { status: 200 });
    };
    try {
      const rows = await nyc.fetch();
      expect(rows).toHaveLength(1);
      expect(calls).toBe(2);
    } finally {
      Object.assign(cityProcurementDeps, saved);
    }
  });
  test("two drops in a row still fail loudly", async () => {
    const saved = { ...cityProcurementDeps };
    cityProcurementDeps.pause = async () => {};
    cityProcurementDeps.fetch = async () => {
      throw new Error("The socket connection was closed unexpectedly");
    };
    try {
      await expect(nyc.fetch()).rejects.toThrow();
    } finally {
      Object.assign(cityProcurementDeps, saved);
    }
  });
});

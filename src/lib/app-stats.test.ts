import { expect, test } from "bun:test";
import { appWindow } from "./app-stats";

test("appWindow fills missing counts with zero and reads numeric strings", () => {
  expect(appWindow({ installs: "3", iphone: 2, android: null })).toEqual({
    installs: 3, iphone: 2, android: 0, opened: 0, linkClicks: 0, starterClicks: 0, alertsTurnedOn: 0,
  });
  expect(appWindow(undefined).installs).toBe(0);
});

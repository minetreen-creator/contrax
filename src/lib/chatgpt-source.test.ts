import { describe, expect, test } from "bun:test";
import { chatgptNote, CHATGPT_VIEW_SQL } from "./live-console";

// Owner 2026-11-24 ("do it"): ChatGPT sent 225 visitors in 30 days and the console did not show them.
describe("ChatGPT as a source in Mission Control", () => {
  test("the People tile says how many came from ChatGPT, and stays quiet when none did", () => {
    expect(chatgptNote({ today: 3, week: 95 })).toBe("3 from ChatGPT today · 95 in 7 days");
    expect(chatgptNote({ today: 0, week: 12 })).toBe("0 from ChatGPT today · 12 in 7 days");
    expect(chatgptNote({ today: 0, week: 0 })).toBeNull();
    expect(chatgptNote(undefined)).toBeNull();
  });
  test("a ChatGPT view is its referrer or the tag it adds to links", () => {
    expect(CHATGPT_VIEW_SQL).toContain("referrer ILIKE '%chatgpt.com%'");
    expect(CHATGPT_VIEW_SQL).toContain("source ILIKE '%chatgpt%'");
  });
});

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { passReminderEmail, SHARE_STORY_URL } from "./starter-pass";
import { STORIES_TO_PUBLISH, storiesPageIsLive, storyByline, validateStory } from "./success-stories";

// Owner 2026-11-04: "maybe we should have a Share Your Success page" → "yes".
const good = {
  name: "Anna Park",
  business: "Park Flooring",
  email: "Anna@Example.com",
  trade: "Flooring",
  state: "wa",
  outcome: "found",
  story: "Found three school flooring bids in Washington I never would have seen.",
  share: "full",
  consent: true,
};

describe("share your story", () => {
  test("a complete story is accepted and cleaned", () => {
    const v = validateStory(good);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.value.email).toBe("anna@example.com");
      expect(v.value.state).toBe("WA");
    }
  });

  test("missing fields, a one-word story or no consent are refused in plain words", () => {
    expect(validateStory({ ...good, name: "" })).toEqual({ ok: false, error: "Please enter your name." });
    expect(validateStory({ ...good, email: "nope" })).toEqual({ ok: false, error: "Please enter a valid email address." });
    expect(validateStory({ ...good, story: "great" }).ok).toBe(false);
    expect(validateStory({ ...good, outcome: "millionaire" }).ok).toBe(false);
    expect(validateStory({ ...good, consent: false })).toEqual({ ok: false, error: "Please confirm Contrax may publish your story." });
    // A private story needs no publishing consent.
    expect(validateStory({ ...good, share: "private", consent: false }).ok).toBe(true);
  });

  test("each person is named only the way they chose", () => {
    const s = { name: "Anna Park", business: "Park Flooring", trade: "Flooring", state: "WA" };
    expect(storyByline({ ...s, share: "full" })).toBe("Anna Park, Park Flooring · Flooring · WA");
    expect(storyByline({ ...s, share: "first_name" })).toBe("Anna · Flooring · WA");
    expect(storyByline({ ...s, share: "anonymous" })).toBe("A flooring business in WA");
  });

  test("the public page stays hidden until 3 approved stories", () => {
    expect(STORIES_TO_PUBLISH).toBe(3);
    expect(storiesPageIsLive(0)).toBe(false);
    expect(storiesPageIsLive(2)).toBe(false);
    expect(storiesPageIsLive(3)).toBe(true);
  });

  test("the public list never selects emails or private stories, and nothing is public before approval", () => {
    const server = readFileSync("src/lib/success-stories.server.ts", "utf8");
    const published = server.slice(server.indexOf("export async function listPublishedStories"));
    expect(published).toContain("status = 'approved' AND share <> 'private'");
    expect(published).not.toContain("email");
    expect(server).toContain("status TEXT NOT NULL DEFAULT 'pending'");
    expect(readFileSync("src/routes/success-stories.tsx", "utf8")).toContain("if (!storiesPageIsLive(stories.length)) throw notFound();");
  });

  test("the renewal reminder asks for a story", () => {
    const m = passReminderEmail(new Date("2026-12-04T12:00:00Z"));
    expect(SHARE_STORY_URL).toBe("https://www.contrax.company/share-your-story");
    expect(m.text).toContain(SHARE_STORY_URL);
    expect(m.html).toContain(SHARE_STORY_URL);
  });
});

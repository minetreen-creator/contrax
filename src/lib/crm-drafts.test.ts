/**
 * CRM AI FOLLOW-UP DRAFTS — the PURE suite (phase 3b).
 *
 * DETERMINISTIC, NETWORK-FREE and DATABASE-FREE by construction: every input is a
 * literal and the module under test imports NOTHING. No `mock.module` anywhere —
 * bun's mock registry is process-global and leaks across test files in one run
 * (skill contrax-bun-mock-module-leak).
 *
 * WHAT IS PINNED, in order of how much damage getting it wrong would do:
 *   1. THE PROMPT'S HARD RULES: use only the given facts, place a bracketed
 *      placeholder instead of inventing a missing detail, email BODY only.
 *   2. THE CONTEXT IS BOUNDED — history capped, activity bodies truncated, notes
 *      truncated — so one enormous note cannot widen a prompt.
 *   3. THE OUTPUT NORMALIZER: model packaging (a code fence, wrapping quotes) is
 *      removed, an empty answer is NOT a draft, and the length is capped.
 *   4. THE INSTRUCTION PARSER never drops what the user typed silently: an
 *      unacceptable value is null (a 400 at the route), not a coerced ''.
 *   5. THE COPY: the locked card states the Professional gate with NO price (the
 *      attempt uses the existing Professional modal defaults), and the editor copy
 *      says drafts-only with no "sent" claim anywhere.
 */
import { describe, expect, test } from "bun:test";
import {
  CRM_DRAFT_ACTIVITY_BODY_MAX,
  CRM_DRAFT_ACTIVITY_LIMIT,
  CRM_DRAFT_COPY_LABEL,
  CRM_DRAFT_EDITOR_NOTE,
  CRM_DRAFT_INSTRUCTIONS_MAX,
  CRM_DRAFT_LIMIT_MESSAGE,
  CRM_DRAFT_LOCK_BODY,
  CRM_DRAFT_LOCK_CTA,
  CRM_DRAFT_LOCK_TITLE,
  CRM_DRAFT_MAX_PER_DAY,
  CRM_DRAFT_NOTES_MAX,
  CRM_DRAFT_PRO_REQUIRED,
  CRM_DRAFT_SYSTEM_PROMPT,
  CRM_DRAFT_TEXT_MAX,
  buildCrmDraftPrompt,
  formatDraftContext,
  normalizeDraftText,
  parseDraftInstructions,
  type CrmDraftActivity,
  type CrmDraftContact,
} from "./crm-drafts";

const CONTACT: CrmDraftContact = {
  id: 41,
  name: "Dana Whitfield",
  organization: "Whitfield Facilities Group",
  role: "Contracting officer",
  notes: "Prefers a call before any site visit.",
};

function activity(overrides: Partial<CrmDraftActivity> = {}): CrmDraftActivity {
  return {
    kind: "call",
    body: "Discussed the janitorial scope for the Richmond VA.",
    created_at: "2026-10-02T14:30:00.000Z",
    ...overrides,
  };
}

describe("buildCrmDraftPrompt — the contact, their history, and nothing else", () => {
  test("the same input always produces the same two messages (deterministic)", () => {
    const input = { contact: CONTACT, activities: [activity()], instructions: "Ask about bonding." };
    expect(buildCrmDraftPrompt(input)).toEqual(buildCrmDraftPrompt(input));
  });

  test("the system message is the pinned instruction block", () => {
    const p = buildCrmDraftPrompt({ contact: CONTACT, activities: [] });
    expect(p.system).toBe(CRM_DRAFT_SYSTEM_PROMPT);
  });

  test("the system message forbids inventing facts and asks for the body only", () => {
    // Non-vacuous: these three clauses ARE the honesty rules of the feature.
    expect(CRM_DRAFT_SYSTEM_PROMPT).toContain("Never invent a fact");
    expect(CRM_DRAFT_SYSTEM_PROMPT).toContain("bracketed placeholder");
    expect(CRM_DRAFT_SYSTEM_PROMPT).toContain("No subject line");
    // …and it never asks for a signature block it cannot know.
    expect(CRM_DRAFT_SYSTEM_PROMPT).toContain("no signature block");
  });

  test("the contact, their notes and their history all reach the user message", () => {
    const p = buildCrmDraftPrompt({ contact: CONTACT, activities: [activity()] });
    expect(p.user).toContain("Dana Whitfield");
    expect(p.user).toContain("Whitfield Facilities Group");
    expect(p.user).toContain("Contracting officer");
    expect(p.user).toContain("Prefers a call before any site visit.");
    expect(p.user).toContain("2026-10-02 · call: Discussed the janitorial scope");
    expect(p.user.endsWith("Write the follow-up email body now.")).toBe(true);
  });

  test("no history and no notes are stated honestly, not left blank", () => {
    const p = buildCrmDraftPrompt({
      contact: { ...CONTACT, notes: "", organization: "", role: "" },
      activities: [],
    });
    expect(p.user).toContain("(none recorded)");
    expect(p.user).toContain("(no activity logged yet)");
    // An absent organization/role is simply not claimed.
    expect(p.user).not.toContain("Organization:");
    expect(p.user).not.toContain("Their role:");
  });

  test("the instruction block appears only when the user gave one", () => {
    const without = buildCrmDraftPrompt({ contact: CONTACT, activities: [] });
    expect(without.user).not.toContain("WHAT THE SENDER WANTS");
    const withIt = buildCrmDraftPrompt({
      contact: CONTACT,
      activities: [],
      instructions: "Mention the site visit on Tuesday.",
    });
    expect(withIt.user).toContain("WHAT THE SENDER WANTS IN THIS FOLLOW-UP");
    expect(withIt.user).toContain("Mention the site visit on Tuesday.");
  });
});

describe("formatDraftContext — every bound the model sees", () => {
  test("history is capped at CRM_DRAFT_ACTIVITY_LIMIT, oldest dropped first", () => {
    const many = Array.from({ length: CRM_DRAFT_ACTIVITY_LIMIT + 15 }, (_, i) =>
      activity({ body: `entry ${i}` }),
    );
    const text = formatDraftContext(CONTACT, many, "");
    const rows = text.split("\n").filter((line) => line.startsWith("- "));
    expect(rows.length).toBe(CRM_DRAFT_ACTIVITY_LIMIT);
    expect(rows[0]).toContain("entry 0");
    expect(rows[rows.length - 1]).toContain(`entry ${CRM_DRAFT_ACTIVITY_LIMIT - 1}`);
    expect(text).not.toContain(`entry ${CRM_DRAFT_ACTIVITY_LIMIT}`);
  });

  test("one huge activity body is truncated to CRM_DRAFT_ACTIVITY_BODY_MAX", () => {
    const body = `${"x".repeat(CRM_DRAFT_ACTIVITY_BODY_MAX)}TAIL-MARKER`;
    const text = formatDraftContext(CONTACT, [activity({ body })], "");
    expect(text).not.toContain("TAIL-MARKER");
    expect(text).toContain("x".repeat(CRM_DRAFT_ACTIVITY_BODY_MAX));
  });

  test("huge notes are truncated to CRM_DRAFT_NOTES_MAX", () => {
    const notes = `${"n".repeat(CRM_DRAFT_NOTES_MAX)}NOTES-TAIL`;
    const text = formatDraftContext({ ...CONTACT, notes }, [], "");
    expect(text).not.toContain("NOTES-TAIL");
  });

  test("long instructions are truncated here as well (the route bound is first)", () => {
    const text = formatDraftContext(CONTACT, [], `${"i".repeat(CRM_DRAFT_INSTRUCTIONS_MAX)}I-TAIL`);
    expect(text).not.toContain("I-TAIL");
  });

  test("a missing activity date and empty body are labelled, never guessed", () => {
    const text = formatDraftContext(CONTACT, [activity({ created_at: null, body: "", kind: "" })], "");
    expect(text).toContain("date not recorded · note: (no text)");
  });
});

describe("normalizeDraftText — what may reach the editor", () => {
  test("plain text is trimmed and otherwise untouched", () => {
    expect(normalizeDraftText("  Hi Dana,\n\nFollowing up.\n  ")).toBe("Hi Dana,\n\nFollowing up.");
  });

  test("a wrapping code fence is model packaging, not content", () => {
    expect(normalizeDraftText("```\nHi Dana,\nFollowing up.\n```")).toBe("Hi Dana,\nFollowing up.");
    expect(normalizeDraftText("```text\nHi Dana.\n```")).toBe("Hi Dana.");
  });

  test("wrapping quotes are removed, but interior quotes are kept", () => {
    expect(normalizeDraftText('"Hi Dana,"')).toBe("Hi Dana,");
    expect(normalizeDraftText('"Do you know what "bonding" means?"')).toBe(
      '"Do you know what "bonding" means?"',
    );
  });

  test("an empty or non-text answer is NOT a draft", () => {
    expect(normalizeDraftText("")).toBeNull();
    expect(normalizeDraftText("   \n\t ")).toBeNull();
    expect(normalizeDraftText("```\n\n```")).toBeNull();
    expect(normalizeDraftText(null)).toBeNull();
    expect(normalizeDraftText(42)).toBeNull();
  });

  test("the text is capped at CRM_DRAFT_TEXT_MAX", () => {
    const long = "y".repeat(CRM_DRAFT_TEXT_MAX + 500);
    expect(normalizeDraftText(long)!.length).toBe(CRM_DRAFT_TEXT_MAX);
  });
});

describe("parseDraftInstructions — never a silent drop", () => {
  test("absent means 'no instruction', which is a valid request", () => {
    expect(parseDraftInstructions(undefined)).toBe("");
    expect(parseDraftInstructions(null)).toBe("");
    expect(parseDraftInstructions("")).toBe("");
    expect(parseDraftInstructions("   ")).toBe("");
  });

  test("a normal instruction is trimmed", () => {
    expect(parseDraftInstructions("  ask about bonding  ")).toBe("ask about bonding");
  });

  test("the bound is exactly CRM_DRAFT_INSTRUCTIONS_MAX", () => {
    const atBound = "a".repeat(CRM_DRAFT_INSTRUCTIONS_MAX);
    expect(parseDraftInstructions(atBound)).toBe(atBound);
    expect(parseDraftInstructions(`${atBound}a`)).toBeNull();
  });

  test("a non-string is refused, never coerced", () => {
    expect(parseDraftInstructions(7)).toBeNull();
    expect(parseDraftInstructions({ text: "hi" })).toBeNull();
    expect(parseDraftInstructions(["hi"])).toBeNull();
  });
});

describe("the copy states the gate, and never more", () => {
  test("the locked card names the Professional gate and its CTA (attempt-only)", () => {
    expect(CRM_DRAFT_LOCK_TITLE).toBe("AI follow-up drafts are a Professional feature");
    expect(CRM_DRAFT_LOCK_CTA).toBe("Upgrade to Professional →");
  });

  test("the locked card carries NO price — the attempt uses the existing modal defaults", () => {
    expect(CRM_DRAFT_LOCK_BODY).not.toContain("$");
    expect(CRM_DRAFT_LOCK_TITLE).not.toContain("$");
  });

  test("the locked card says what the gate enforces: history-driven, never sent", () => {
    expect(CRM_DRAFT_LOCK_BODY).toContain("notes");
    expect(CRM_DRAFT_LOCK_BODY).toContain("relationship history");
    expect(CRM_DRAFT_LOCK_BODY).toContain("never sends email");
    // A downgrade keeps the data — the same promise the contacts card makes.
    expect(CRM_DRAFT_LOCK_BODY).toContain("unchanged");
  });

  test("the editor copy is drafts-only with no send affordance and no delivery claim", () => {
    expect(CRM_DRAFT_EDITOR_NOTE).toContain("Drafts only");
    expect(CRM_DRAFT_EDITOR_NOTE).toContain("never sends email");
    expect(CRM_DRAFT_COPY_LABEL).toBe("Copy draft");
    // The only verb the editor offers is copying.
    expect(CRM_DRAFT_COPY_LABEL.toLowerCase()).not.toContain("send");
  });

  test("the limit message names the real cap and says when to come back", () => {
    expect(CRM_DRAFT_LIMIT_MESSAGE).toContain(String(CRM_DRAFT_MAX_PER_DAY));
    expect(CRM_DRAFT_LIMIT_MESSAGE).toContain("try again tomorrow");
  });

  test("the 403 body is the same sentence every other Professional gate uses", () => {
    expect(CRM_DRAFT_PRO_REQUIRED).toBe("Professional plan required");
  });
});

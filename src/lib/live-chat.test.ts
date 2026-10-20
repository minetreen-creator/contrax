import { describe, expect, test } from "bun:test";

import { chatHiddenOn, cleanBody, MAX_CHAT_BODY, unreadFromVisitor, visitorMayReply } from "./live-chat";

describe("live chat rules", () => {
  test("cleanBody trims and rejects empty, too long or non-text", () => {
    expect(cleanBody("  hi there \r\n")).toBe("hi there");
    expect(cleanBody("   ")).toBeNull();
    expect(cleanBody("x".repeat(MAX_CHAT_BODY + 1))).toBeNull();
    expect(cleanBody(42)).toBeNull();
  });

  test("a visitor can only reply inside a thread the owner started", () => {
    expect(visitorMayReply([])).toBe(false);
    expect(visitorMayReply([{ sender: "visitor" }])).toBe(false);
    expect(visitorMayReply([{ sender: "owner" }, { sender: "visitor" }])).toBe(true);
  });

  test("unread counts visitor messages after the owner's last one", () => {
    const at = "2026-10-20T00:00:00Z";
    expect(unreadFromVisitor([{ sender: "owner", at }, { sender: "visitor", at }, { sender: "visitor", at }])).toBe(2);
    expect(unreadFromVisitor([{ sender: "owner", at }, { sender: "visitor", at }, { sender: "owner", at }])).toBe(0);
  });

  test("never on admin or post-checkout pages", () => {
    expect(chatHiddenOn("/admin/live")).toBe(true);
    expect(chatHiddenOn("/post-checkout")).toBe(true);
    expect(chatHiddenOn("/radar")).toBe(false);
  });
});

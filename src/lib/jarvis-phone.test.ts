import { describe, expect, test } from "bun:test";
import {
  callKey,
  isAllowedCaller,
  isGoodbye,
  packHistory,
  pinMatches,
  twilioSignature,
  twiml,
  unpackHistory,
  validCallKey,
  validTwilioSignature,
  xmlEscape,
} from "./jarvis-phone";

describe("Twilio signature", () => {
  // Twilio's documented example (https://www.twilio.com/docs/usage/security); same algorithm as twilio-node's getExpectedTwilioSignature.
  const url = "https://mycompany.com/myapp.php?foo=1&bar=2";
  const params = { CallSid: "CA1234567890ABCDE", Caller: "+12349013030", Digits: "1234", From: "+12349013030", To: "+18005551212" };
  test("matches Twilio's published example", () => {
    expect(twilioSignature("12345", url, params)).toBe("0/KCTR6DLpKmkAf8muzZqo1nDgQ=");
  });
  test("rejects a wrong or missing signature, accepts any listed URL", () => {
    const sig = twilioSignature("12345", url, params);
    expect(validTwilioSignature("12345", sig, ["https://other.example/x", url], params)).toBe(true);
    expect(validTwilioSignature("12345", sig, [url], { ...params, Digits: "9999" })).toBe(false);
    expect(validTwilioSignature("12345", null, [url], params)).toBe(false);
    expect(validTwilioSignature("", sig, [url], params)).toBe(false);
  });
});

describe("caller and PIN", () => {
  test("only listed numbers, any formatting", () => {
    expect(isAllowedCaller("+18045550100", "(804) 555-0100, 804-555-0199")).toBe(true);
    expect(isAllowedCaller("+18045550199", "+1 804 555 0100,8045550199")).toBe(true);
    expect(isAllowedCaller("+18045550101", "8045550100")).toBe(false);
    expect(isAllowedCaller("anonymous", "8045550100")).toBe(false);
    expect(isAllowedCaller("+18045550100", undefined)).toBe(false);
  });
  test("PIN must be configured as 4-8 digits and match exactly", () => {
    expect(pinMatches("4821", "4821")).toBe(true);
    expect(pinMatches("4822", "4821")).toBe(false);
    expect(pinMatches("", "")).toBe(false);
    expect(pinMatches("12", "12")).toBe(false);
  });
  test("call key ties follow-ups to one call", () => {
    const k = callKey("tok", "CA1");
    expect(validCallKey("tok", "CA1", k)).toBe(true);
    expect(validCallKey("tok", "CA2", k)).toBe(false);
    expect(validCallKey("other", "CA1", k)).toBe(false);
    expect(validCallKey("tok", "CA1", "")).toBe(false);
  });
});

describe("conversation", () => {
  test("goodbyes", () => {
    for (const t of ["No", "no thanks", "That's all, Jarvis.", "goodbye", "I'm good, thanks"]) expect(isGoodbye(t)).toBe(true);
    for (const t of ["no signups today?", "how many visitors", "nothing new in Virginia?"]) expect(isGoodbye(t)).toBe(false);
  });
  test("history round-trips, trimmed; junk is ignored", () => {
    const turns = Array.from({ length: 6 }, (_, i) => ({ role: (i % 2 ? "assistant" : "user") as "user" | "assistant", content: `turn ${i} ${"x".repeat(300)}` }));
    const back = unpackHistory(packHistory(turns));
    expect(back).toHaveLength(4);
    expect(back[0].content.startsWith("turn 2")).toBe(true);
    expect(back[0].content.length).toBe(220);
    expect(unpackHistory("not-base64!!")).toEqual([]);
    expect(unpackHistory(null)).toEqual([]);
  });
});

describe("TwiML", () => {
  test("escapes what is spoken and the action URLs", () => {
    expect(xmlEscape(`<a & "b">`)).toBe("&lt;a &amp; &quot;b&quot;&gt;");
    const x = twiml.listen("Sales & <signups>", "https://x/api?step=heard&k=1");
    expect(x).toContain("Sales &amp; &lt;signups&gt;");
    expect(x).toContain('action="https://x/api?step=heard&amp;k=1"');
    expect(twiml.reject()).toContain("<Reject");
    expect(twiml.askPin("https://x", 4)).toContain('numDigits="4"');
  });
});

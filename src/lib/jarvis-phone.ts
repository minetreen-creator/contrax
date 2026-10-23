import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Call Jarvis on the phone (owner 2026-10-23, "1,2,5"). A Twilio number points
 * its voice webhook at /api/phone/jarvis. Only the owner's own phone numbers
 * (JARVIS_PHONE_ALLOWED) get through, and only after the keypad PIN
 * (JARVIS_PHONE_PIN), since caller ID alone can be faked. Every request must
 * carry Twilio's signature (TWILIO_AUTH_TOKEN).
 *
 * PURE helpers: signatures, caller checks, the per-call key, and TwiML.
 */

/** Twilio's British neural voice for the phone (Mission Control uses OpenAI's). */
export const PHONE_VOICE = "Polly.Arthur-Neural";
/** Turns of the conversation carried from one question to the next. */
export const PHONE_HISTORY_TURNS = 4;
const PHONE_TURN_CHARS = 220;

/** Twilio's X-Twilio-Signature: HMAC-SHA1 over the URL plus the sorted POST params, base64. */
export function twilioSignature(authToken: string, url: string, params: Record<string, string>): string {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, k) => acc + k + params[k], url);
  return createHmac("sha1", authToken).update(data, "utf8").digest("base64");
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** True when the signature matches any of the URLs the request may have been sent to. */
export function validTwilioSignature(authToken: string, signature: string | null, urls: string[], params: Record<string, string>): boolean {
  if (!authToken || !signature) return false;
  return urls.some((u) => safeEqual(twilioSignature(authToken, u, params), signature));
}

/** The last ten digits of a phone number ("+1 (804) 555-0100" → "8045550100"). */
export function phoneDigits(v: string | null | undefined): string {
  return String(v ?? "").replace(/\D/g, "").slice(-10);
}

/** Is this caller one of the owner's numbers (comma-separated list)? */
export function isAllowedCaller(from: string | null | undefined, allowedList: string | undefined): boolean {
  const caller = phoneDigits(from);
  if (caller.length !== 10) return false;
  return String(allowedList ?? "")
    .split(",")
    .map(phoneDigits)
    .some((n) => n.length === 10 && n === caller);
}

/** Keypad PIN check (4-8 digits configured; anything else never matches). */
export function pinMatches(entered: string | null | undefined, pin: string | undefined): boolean {
  const want = String(pin ?? "").trim();
  if (!/^\d{4,8}$/.test(want)) return false;
  return safeEqual(String(entered ?? "").replace(/\D/g, ""), want);
}

/** Proof, carried in each follow-up URL, that this call already passed the PIN. */
export function callKey(authToken: string, callSid: string): string {
  return createHmac("sha256", authToken).update(`jarvis-phone:${callSid}`).digest("hex").slice(0, 32);
}

export function validCallKey(authToken: string, callSid: string, key: string | null | undefined): boolean {
  return !!callSid && !!key && safeEqual(callKey(authToken, callSid), key);
}

/** "That's all", "goodbye", "no thanks": the caller is done. */
export function isGoodbye(text: string): boolean {
  return /^\s*(no|nope|nothing|no thanks?|no thank you|that'?s (all|it)|that will be all|goodbye|good bye|bye|hang up|i'?m (good|done)|we'?re done)\b[\s.!,]*(thanks?|thank you|jarvis|sir)?[\s.!]*$/i.test(text);
}

export type PhoneTurn = { role: "user" | "assistant"; content: string };

/** The conversation so far, packed into a URL parameter. */
export function packHistory(turns: PhoneTurn[]): string {
  const kept = turns.slice(-PHONE_HISTORY_TURNS).map((t) => ({ r: t.role === "user" ? "u" : "a", c: t.content.slice(0, PHONE_TURN_CHARS) }));
  return Buffer.from(JSON.stringify(kept), "utf8").toString("base64url");
}

export function unpackHistory(v: string | null | undefined): PhoneTurn[] {
  if (!v) return [];
  try {
    const arr = JSON.parse(Buffer.from(v, "base64url").toString("utf8")) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((t): t is { r: string; c: string } => !!t && typeof t.c === "string" && (t.r === "u" || t.r === "a"))
      .slice(-PHONE_HISTORY_TURNS)
      .map((t) => ({ role: t.r === "u" ? "user" : "assistant", content: t.c.slice(0, PHONE_TURN_CHARS) }));
  } catch {
    return [];
  }
}

export function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

const say = (text: string) => `<Say voice="${PHONE_VOICE}">${xmlEscape(text)}</Say>`;

/** TwiML for each step of the call. */
export const twiml = {
  doc: (body: string) => `<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`,
  reject: () => twiml.doc(`<Reject reason="rejected"/>`),
  hangup: (text: string) => twiml.doc(`${say(text)}<Hangup/>`),
  askPin: (action: string, digits: number) =>
    twiml.doc(`<Gather input="dtmf" numDigits="${digits}" timeout="8" action="${xmlEscape(action)}" method="POST">${say("Jarvis here. Your access code, sir.")}</Gather>${say("No code entered. Goodbye, sir.")}<Hangup/>`),
  listen: (prompt: string, action: string) =>
    twiml.doc(
      `<Gather input="speech" speechTimeout="auto" timeout="6" language="en-US" actionOnEmptyResult="true" action="${xmlEscape(action)}" method="POST">${say(prompt)}</Gather>`,
    ),
  /** "One moment, sir" while the next request does the thinking. */
  thinking: (redirect: string) => twiml.doc(`${say("One moment, sir.")}<Redirect method="POST">${xmlEscape(redirect)}</Redirect>`),
};

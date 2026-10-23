import { createFileRoute } from "@tanstack/react-router";
import { sanitizeLogString } from "~/lib/ai";
import { askJarvis, onlineCount } from "~/lib/jarvis.server";
import { MAX_QUESTION_CHARS } from "~/lib/jarvis";
import {
  callKey,
  isAllowedCaller,
  isGoodbye,
  packHistory,
  pinMatches,
  twiml,
  unpackHistory,
  validCallKey,
  validTwilioSignature,
} from "~/lib/jarvis-phone";

/**
 * POST /api/phone/jarvis — Twilio's voice webhook for the Jarvis phone line
 * (src/lib/jarvis-phone.ts). Steps, by ?step=: (none) the call comes in and
 * Jarvis asks for the PIN; pin checks it; heard takes what he said; think
 * answers it (after "One moment, sir") and listens again.
 */

/** Twilio waits 15 seconds for a reply; answer before that. */
const THINK_BUDGET_MS = 11_000;
const PATH = "/api/phone/jarvis";

function xml(body: string, status = 200) {
  return new Response(body, { status, headers: { "Content-Type": "text/xml; charset=utf-8", "Cache-Control": "no-store" } });
}

function greeting(): string {
  const hour = Number(new Date().toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false })) % 24;
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

async function handler({ request }: { request: Request }) {
  const token = process.env.TWILIO_AUTH_TOKEN ?? "";
  if (!token) return xml(twiml.hangup("Jarvis's phone line isn't set up yet."), 503);

  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? url.host;
  const form = await request.formData().catch(() => null);
  const params: Record<string, string> = {};
  form?.forEach((v, k) => {
    if (typeof v === "string") params[k] = v;
  });
  // Twilio signs the URL it called; behind Vercel that may show up with or without :443.
  const bare = host.replace(/:443$/, "");
  const urls = [request.url, `https://${bare}${url.pathname}${url.search}`, `https://${bare}:443${url.pathname}${url.search}`];
  if (!validTwilioSignature(token, request.headers.get("x-twilio-signature"), urls, params)) {
    return new Response("Forbidden", { status: 403 });
  }
  // Only the owner's own phones get past the first ring.
  if (!isAllowedCaller(params.From, process.env.JARVIS_PHONE_ALLOWED)) return xml(twiml.reject());

  const pin = process.env.JARVIS_PHONE_PIN ?? "";
  if (!/^\d{4,8}$/.test(pin)) return xml(twiml.hangup("Jarvis's phone line needs an access code set up first. Goodbye, sir."));

  const base = `https://${bare}${PATH}`;
  const callSid = params.CallSid ?? "";
  const step = url.searchParams.get("step");
  const link = (q: Record<string, string>) => `${base}?${new URLSearchParams(q).toString()}`;

  if (!step) return xml(twiml.askPin(link({ step: "pin" }), pin.length));

  if (step === "pin") {
    if (!pinMatches(params.Digits, pin)) return xml(twiml.hangup("That code isn't right. Goodbye."));
    const k = callKey(token, callSid);
    return xml(twiml.listen(`${greeting()}, sir. What can I do for you?`, link({ step: "heard", k })));
  }

  // Every later step must come from a call that passed the PIN.
  const k = url.searchParams.get("k") ?? "";
  if (!validCallKey(token, callSid, k)) return xml(twiml.hangup("Let's start over, sir. Goodbye."));
  const h = url.searchParams.get("h") ?? "";

  if (step === "heard") {
    const heard = String(params.SpeechResult ?? "").trim().slice(0, MAX_QUESTION_CHARS);
    if (!heard) {
      if (url.searchParams.get("m")) return xml(twiml.hangup("I'll be here when you need me, sir. Goodbye."));
      return xml(twiml.listen("Anything else, sir?", link({ step: "heard", k, h, m: "1" })));
    }
    if (isGoodbye(heard)) return xml(twiml.hangup("Very good, sir. Goodbye."));
    return xml(twiml.thinking(link({ step: "think", k, h, q: heard })));
  }

  if (step === "think") {
    const question = (url.searchParams.get("q") ?? "").slice(0, MAX_QUESTION_CHARS);
    const history = unpackHistory(h);
    let say = "Sorry, sir, I didn't catch that.";
    if (!process.env.OPENAI_API_KEY) say = "My thinking circuits aren't connected just now, sir.";
    else if (question) {
      const timeout = new Promise<null>((r) => setTimeout(() => r(null), THINK_BUDGET_MS));
      try {
        const reply = await Promise.race([
          askJarvis({ question, snapshot: { onlineCount: await onlineCount(), online: [], feed: [], trials: [], money: null }, history, channel: "phone" }),
          timeout,
        ]);
        say = reply?.say ?? "That one is taking me longer than a phone call allows, sir. Try asking it a simpler way.";
      } catch (err) {
        console.error("[phone/jarvis] failed:", sanitizeLogString(err));
        say = "My apologies, sir, something went wrong on my end.";
      }
    }
    const next = packHistory([...history, { role: "user", content: question }, { role: "assistant", content: say }]);
    return xml(twiml.listen(say, link({ step: "heard", k, h: next })));
  }

  return xml(twiml.hangup("Goodbye, sir."));
}

export const Route = createFileRoute("/api/phone/jarvis")({
  server: { handlers: { POST: handler } },
});

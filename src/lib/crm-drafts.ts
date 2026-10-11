/**
 * CRM AI FOLLOW-UP DRAFTS — the PURE half (owner handoff 2026-10-10, item 5;
 * CRM phase 3b). "Generate a draft follow-up email for a contact from their
 * relationship history + notes; drafts only — never auto-send; server-gated to
 * Professional (aiDrafts flag)."
 *
 * WHAT THIS MODULE IS, AND IS NOT. It holds the prompt, the output normalizer and
 * the copy — nothing else. It imports NOTHING (no `~/db`, no `~/lib/ai`, no React),
 * so the UI, the route and both unit suites can share one definition of what a
 * draft request means without dragging a database driver or an HTTP client behind
 * it. That is the same split as src/lib/crm-reminders.ts (pure rules) versus
 * src/lib/crm-reminders.server.ts (Neon), and it is what keeps the suites
 * deterministic, network-free and database-free by construction.
 *
 * THE HARD RULES THIS FILE ENCODES, and where each one is ENFORCED:
 *   1. DRAFTS ONLY — nothing here writes, sends or even names a mail transport.
 *      The draft is TEXT returned to the caller for a human to edit and copy
 *      (CRM_DRAFT_EDITOR_NOTE says exactly that). There is no "send" outcome and
 *      no "sent" claim anywhere in this feature.
 *   2. NO INVENTED FACTS IN THE PROMPT — the model is told to use only the contact
 *      details and activity history it is given, and to use a bracketed
 *      placeholder for a missing detail (the writer's own name, for instance)
 *      rather than inventing one. The prompt never states a price, a deadline or a
 *      limit that Contrax did not compute.
 *   3. BOUNDED INPUT — a contact's history is capped (CRM_DRAFT_ACTIVITY_LIMIT) and
 *      each activity body truncated (CRM_DRAFT_ACTIVITY_BODY_MAX) before it reaches
 *      the model, so one enormous note cannot turn into an enormous prompt.
 *   4. BOUNDED, HONEST OUTPUT — `normalizeDraftText()` strips an accidental code
 *      fence / wrapping quotes and caps the length. An empty model answer is NOT a
 *      draft (it returns null), and the caller reports a failure rather than
 *      showing an empty editor.
 *
 * ENTITLEMENT IS NOT DECIDED HERE. `aiDrafts` comes from the phase-1 gate
 * (src/lib/crm-access.server.ts `getCrmAccess()`, Professional only) and is
 * enforced in the route/seam — this module only carries the locked-card COPY a
 * non-Professional account sees (no price: the upgrade modal keeps the existing
 * Professional defaults, exactly like the reminders card).
 */

/** One contact, as the draft prompt needs it (a subset of GET /api/crm's row). */
export interface CrmDraftContact {
  id: number;
  name: string;
  organization: string;
  role: string;
  notes: string;
}

/** One logged interaction (a row of `crm_activities`). */
export interface CrmDraftActivity {
  kind: string;
  body: string;
  created_at: string | null;
}

/** The messages handed to the shared OpenAI helper (src/lib/ai.ts `callAI`). */
export interface CrmDraftMessages {
  system: string;
  user: string;
}

/** How many of the most recent activities a draft may read. */
export const CRM_DRAFT_ACTIVITY_LIMIT = 25;
/** Characters kept from one activity body (the newest are the most relevant). */
export const CRM_DRAFT_ACTIVITY_BODY_MAX = 600;
/** Characters kept from the contact's free-text notes. */
export const CRM_DRAFT_NOTES_MAX = 2000;
/** Bound on the user's optional instruction (`instructions` in the POST body). */
export const CRM_DRAFT_INSTRUCTIONS_MAX = 500;
/** Longest draft the editor will hold. */
export const CRM_DRAFT_TEXT_MAX = 4000;
/** Longest contact name / organization / role folded into the prompt. */
const CRM_DRAFT_FIELD_MAX = 200;

/**
 * The per-account DAILY generation cap, enforced by the EXISTING rate-limit
 * mechanism (src/lib/rate-limit.ts `checkRateLimit`, scope `crm_draft`, key
 * `user:<id>`) — the same per-user daily cap the AI Executive Brief route puts in
 * front of its own paid generation (scope `analyze_daily`). It is an abuse guard,
 * not a published feature allowance: the ratified tier table promises AI follow-up
 * drafts on Professional with no count, and no surface advertises this number
 * except the honest message below when it is actually reached.
 */
export const CRM_DRAFT_MAX_PER_DAY = 20;
export const CRM_DRAFT_WINDOW_SEC = 24 * 60 * 60;

/** The one honest sentence a user gets when the daily cap is reached. */
export const CRM_DRAFT_LIMIT_MESSAGE = `You've reached today's limit of ${CRM_DRAFT_MAX_PER_DAY} AI follow-up drafts. Please try again tomorrow.`;
/** Failure copy for a model/transport error — never a partial or faked draft. */
export const CRM_DRAFT_FAILED_MESSAGE = "Could not generate a draft. Please try again.";
/** Failure copy when the caller's optional instruction is not acceptable. */
export const CRM_DRAFT_INVALID_MESSAGE = "Invalid draft request.";
/** 404 — the contact is not this user's (or is archived). */
export const CRM_DRAFT_CONTACT_NOT_FOUND = "That contact was not found in your contacts.";
/** 403 — the Professional gate (server-decided; the client never computes it). */
export const CRM_DRAFT_PRO_REQUIRED = "Professional plan required";

/** The instruction block the model is judged against (one place, pinned by tests). */
export const CRM_DRAFT_SYSTEM_PROMPT = [
  "You write short follow-up emails for a small-business government contractor.",
  "Use ONLY the contact details, notes and activity history you are given. Never invent a fact, a date, a price, a deadline or a promise.",
  "If something you would normally include is missing (for example the sender's name), write a bracketed placeholder such as [your name] instead of making one up.",
  "Write the email body only: a greeting, two or three short paragraphs, and a sign-off. No subject line, no commentary, no markdown, no bullet lists, no signature block.",
  "Keep it under 180 words and end with a specific, low-pressure next step.",
].join(" ");

/** Trims one untrusted text field to a bound (never a coercion of a non-string). */
function bounded(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/**
 * The context block sent as the user message: the contact, their notes, and their
 * relationship history newest-first (the slice is taken here as well as in SQL, so
 * a caller that hands over more cannot widen the prompt).
 */
export function formatDraftContext(
  contact: CrmDraftContact,
  activities: readonly CrmDraftActivity[],
  instructions: string,
): string {
  const lines: string[] = ["CONTACT"];
  lines.push(`Name: ${bounded(contact.name, CRM_DRAFT_FIELD_MAX) || "(not recorded)"}`);
  const organization = bounded(contact.organization, CRM_DRAFT_FIELD_MAX);
  const role = bounded(contact.role, CRM_DRAFT_FIELD_MAX);
  if (organization) lines.push(`Organization: ${organization}`);
  if (role) lines.push(`Their role: ${role}`);
  const notes = bounded(contact.notes, CRM_DRAFT_NOTES_MAX);
  lines.push("");
  lines.push("NOTES ON THIS CONTACT");
  lines.push(notes || "(none recorded)");
  lines.push("");
  lines.push("RELATIONSHIP HISTORY (newest first)");
  const recent = activities.slice(0, CRM_DRAFT_ACTIVITY_LIMIT);
  if (!recent.length) {
    lines.push("(no activity logged yet)");
  } else {
    for (const activity of recent) {
      const day = activity.created_at ? String(activity.created_at).slice(0, 10) : "date not recorded";
      const kind = bounded(activity.kind, 40) || "note";
      const body = bounded(activity.body, CRM_DRAFT_ACTIVITY_BODY_MAX) || "(no text)";
      lines.push(`- ${day} · ${kind}: ${body}`);
    }
  }
  const extra = bounded(instructions, CRM_DRAFT_INSTRUCTIONS_MAX);
  if (extra) {
    lines.push("");
    lines.push("WHAT THE SENDER WANTS IN THIS FOLLOW-UP");
    lines.push(extra);
  }
  lines.push("");
  lines.push("Write the follow-up email body now.");
  return lines.join("\n");
}

/**
 * Builds the exact messages sent to the model. PURE: the same input always yields
 * the same two strings, which is what makes the suite deterministic and lets a
 * reviewer diff a prompt change without a network call.
 */
export function buildCrmDraftPrompt(input: {
  contact: CrmDraftContact;
  activities: readonly CrmDraftActivity[];
  /** Optional: the user's own instruction (already bounded by the route). */
  instructions?: string;
}): CrmDraftMessages {
  return {
    system: CRM_DRAFT_SYSTEM_PROMPT,
    user: formatDraftContext(input.contact, input.activities, input.instructions ?? ""),
  };
}

/**
 * Turns the model's answer into the text the editor may show — or null when there
 * is no usable draft. Conservative by design: it removes a wrapping code fence and
 * wrapping quotes (model packaging, not content), trims, and caps the length. It
 * never rewrites a sentence, and an empty (or whitespace-only) answer is a failure
 * rather than an empty draft.
 */
export function normalizeDraftText(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let text = raw.trim();
  const fence = /^```[a-zA-Z]*\n([\s\S]*?)\n?```$/;
  const fenced = text.match(fence);
  if (fenced) text = fenced[1]!.trim();
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"') && !text.slice(1, -1).includes('"')) {
    text = text.slice(1, -1).trim();
  }
  if (!text) return null;
  return text.slice(0, CRM_DRAFT_TEXT_MAX);
}

// ── The optional user instruction, as the route receives it ──────────────────
/**
 * Normalizes the optional `instructions` field of the POST body.
 *
 *   absent / null / ''  → '' (no instruction; a draft from the history alone)
 *   string ≤ 500 chars  → that string, trimmed
 *   anything else       → null, which the route answers with a 400 — never a
 *                         silent drop of something the user typed
 */
export function parseDraftInstructions(raw: unknown): string | null {
  if (raw === undefined || raw === null) return "";
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length > CRM_DRAFT_INSTRUCTIONS_MAX) return null;
  return trimmed;
}

// ── Panel copy (house gate style — title / body / CTA, NO price) ─────────────
/**
 * What a non-Professional account sees where the drafts panel would be: the house
 * locked card (the same shape as CRM_REMINDERS_LOCK_* and GATE_PROMPTS), whose only
 * action is an UPGRADE ATTEMPT — the modal opens on click, never on page view
 * (owner rule 8). No price is stated here: the attempt uses the existing
 * Professional defaults in src/components/PremiumUpgradeModal.tsx.
 *
 * It claims exactly what the gate enforces: drafts are Professional, they are
 * written from the contact's own notes and history, and they are never sent by
 * Contrax.
 */
export const CRM_DRAFT_LOCK_TITLE = "AI follow-up drafts are a Professional feature";
export const CRM_DRAFT_LOCK_BODY =
  "AI follow-up drafts write a first version of a follow-up email from a contact's notes and your logged relationship history — you review, edit and copy it yourself. Contrax never sends email on your behalf. Your contacts, notes and saved bids are unchanged.";
export const CRM_DRAFT_LOCK_CTA = "Upgrade to Professional →";

/** The per-contact control (Professional only). */
export const CRM_DRAFT_ACTION_LABEL = "Draft follow-up";
/** Editor copy — DRAFTS ONLY, stated where the user reads it. */
export const CRM_DRAFT_EDITOR_TITLE = "Follow-up draft";
export const CRM_DRAFT_EDITOR_NOTE =
  "Drafts only — edit or copy this yourself. Contrax never sends email on your behalf, and nothing here writes to your contact's history.";
export const CRM_DRAFT_COPY_LABEL = "Copy draft";
export const CRM_DRAFT_COPIED_LABEL = "Copied";
export const CRM_DRAFT_COPY_FAILED_LABEL = "Press ⌘/Ctrl + C to copy";
export const CRM_DRAFT_INSTRUCTIONS_LABEL = "Anything to include? (optional)";
export const CRM_DRAFT_INSTRUCTIONS_PLACEHOLDER =
  "e.g. mention the site visit on Tuesday and ask about the bonding requirement";
export const CRM_DRAFT_GENERATE_LABEL = "Generate draft";
export const CRM_DRAFT_REGENERATE_LABEL = "Regenerate";
export const CRM_DRAFT_GENERATING_LABEL = "Writing a draft…";
export const CRM_DRAFT_CLOSE_LABEL = "Close";

import { createServerFn } from "@tanstack/react-start";
import { sql } from "~/db";
import { getCurrentUser } from "~/lib/auth";

export type FeedbackContext = "score" | "proposal" | "win_probability" | "bid_summary";
export type UnhelpfulReason = "inaccurate" | "too_vague" | "too_generic" | "missed_requirements" | "other";

const contexts = ["score", "proposal", "win_probability", "bid_summary"] as const;
const reasons = ["inaccurate", "too_vague", "too_generic", "missed_requirements", "other"] as const;

export const submitFeedback = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const data = (input || {}) as Record<string, unknown>;
    const context = String(data.context || "");
    if (!(contexts as readonly string[]).includes(context)) throw new Error("Invalid feedback context");
    const wasHelpful = data.wasHelpful === true ? true : data.wasHelpful === false ? false : null;
    if (wasHelpful === null) throw new Error("Please choose whether the result was helpful");
    const reason = data.unhelpfulReason ? String(data.unhelpfulReason) : null;
    if (reason && !(reasons as readonly string[]).includes(reason)) throw new Error("Invalid feedback reason");
    return {
      context: context as FeedbackContext,
      sessionId: String(data.sessionId || "").slice(0, 100) || null,
      solicitationRef: data.solicitationRef ? String(data.solicitationRef).slice(0, 200) : null,
      aiOutputSummary: String(data.aiOutputSummary || "").slice(0, 1000),
      wasHelpful,
      unhelpfulReason: wasHelpful ? null : reason,
      unhelpfulDetail: wasHelpful ? null : String(data.unhelpfulDetail || "").slice(0, 2000),
    };
  })
  .handler(async ({ data }) => {
    const user = await getCurrentUser();
    const rows = await sql()`
      INSERT INTO ai_feedback (user_id, session_id, context, solicitation_ref, ai_output_summary, was_helpful, unhelpful_reason, unhelpful_detail)
      VALUES (${user?.id ?? null}, ${user ? null : data.sessionId}, ${data.context}, ${data.solicitationRef}, ${data.aiOutputSummary}, ${data.wasHelpful}, ${data.unhelpfulReason}, ${data.unhelpfulDetail})
      RETURNING id`;
    return { success: true, id: Number((rows[0] as { id: number }).id) };
  });

export const getFeedbackStats = createServerFn({ method: "GET" }).handler(async () => {
  const byContext = await sql()`
    SELECT context, COUNT(*)::int AS total, COUNT(*) FILTER (WHERE was_helpful)::int AS helpful,
      ROUND(AVG(CASE WHEN was_helpful THEN 1 ELSE 0 END) * 100)::int AS helpful_rate
    FROM ai_feedback GROUP BY context ORDER BY context`;
  const complaints = await sql()`
    SELECT unhelpful_reason AS reason, COUNT(*)::int AS count FROM ai_feedback
    WHERE was_helpful = false AND unhelpful_reason IS NOT NULL GROUP BY unhelpful_reason ORDER BY count DESC`;
  return { byContext, commonComplaints: complaints };
});

/** Recent negative-feedback patterns for the Learning Engine. */
export const getUnhelpfulFeedbackSummary = createServerFn({ method: "GET" }).handler(async () => {
  const rows = await sql()`
    SELECT context, unhelpful_reason AS reason, COUNT(*)::int AS count,
      MAX(created_at) AS latest
    FROM ai_feedback WHERE was_helpful = false AND created_at >= NOW() - INTERVAL '90 days'
    GROUP BY context, unhelpful_reason ORDER BY count DESC, latest DESC`;
  return rows;
});

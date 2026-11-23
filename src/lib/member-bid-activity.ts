/**
 * The owner hears when a member is working a bid (owner 2026-11-23: "how will we know if someone
 * bids on something?" → "add it"). A bid is submitted to the agency, never through Contrax, so the
 * site only knows two things: the member marks a saved bid Preparing or Submitted, or a signed-in
 * member opens the official notice. Both are told to the owner once. PURE.
 */
export type MemberBidStage = "preparing" | "submitted";
export const MEMBER_BID_STAGES: readonly MemberBidStage[] = ["preparing", "submitted"];
export function isMemberBidStage(v: unknown): v is MemberBidStage {
  return v === "preparing" || v === "submitted";
}

type Alert = { subject: string; text: string; push: { title: string; body: string; tag: string; url: string } };
const who = (email: string | null) => email?.trim() || "(member email not on file)";
const job = (title: string | null) => (title ?? "").trim().slice(0, 140) || "Untitled bid";

export function memberBidStageOwnerAlert(a: { memberEmail: string | null; title: string | null; agency: string | null; stage: MemberBidStage; bidId: number }): Alert {
  const m = who(a.memberEmail);
  const j = job(a.title);
  const agency = (a.agency ?? "").trim();
  const submitted = a.stage === "submitted";
  return {
    subject: submitted ? `📨 A Contrax member submitted a bid: ${m}` : `📝 A Contrax member is preparing a bid: ${m}`,
    text: [
      submitted ? "A member marked a saved bid as submitted." : "A member marked a saved bid as preparing.",
      `Member: ${m}`,
      `Bid: ${j}${agency ? `, ${agency}` : ""}`,
      "That is their word in their pipeline; Contrax cannot see what an agency receives.",
      `The bid: https://www.contrax.company/bid/${a.bidId}`,
    ].join("\n\n"),
    push: {
      title: submitted ? "📨 A member submitted a bid" : "📝 A member is preparing a bid",
      body: `${m}: ${j}`.slice(0, 180),
      tag: `stage-${a.stage}-${a.bidId}-${m}`.slice(0, 64),
      url: `/bid/${a.bidId}`,
    },
  };
}

/** One alert a day per member: the first official notice they open that day. */
export function memberNoticeOpenOwnerAlert(a: { memberEmail: string | null; title: string | null; agency: string | null; bidId: number }): Alert {
  const m = who(a.memberEmail);
  const j = job(a.title);
  const agency = (a.agency ?? "").trim();
  return {
    subject: `📄 A Contrax member opened an official notice: ${m}`,
    text: [
      "A signed-in member opened the agency's official notice for a bid. That is where the bid documents are, so it is the best sign the site has that someone is working a bid.",
      `Member: ${m}`,
      `Bid: ${j}${agency ? `, ${agency}` : ""}`,
      "You get this once a day per member, for the first notice they open that day.",
      `The bid: https://www.contrax.company/bid/${a.bidId}`,
    ].join("\n\n"),
    push: { title: "📄 A member opened an official notice", body: `${m}: ${j}`.slice(0, 180), tag: `notice-${m}`.slice(0, 64), url: `/bid/${a.bidId}` },
  };
}

/** The line under the bids in a paying member's morning email. */
export const MEMBER_BID_NUDGE_HEAD = "Bidding on one of these?";
export const MEMBER_BID_NUDGE_BODY = "Save it, then mark it Preparing or Submitted in your pipeline, so your bids stay in one list with their deadlines.";
export const MEMBER_BID_NUDGE_URL = "https://www.contrax.company/pipeline?source=bid_email";

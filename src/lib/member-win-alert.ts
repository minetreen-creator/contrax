/**
 * The owner's alert when a member wins (owner 2026-11-22: "is there a way for me to be notified if
 * someone wins a bid?" → "add it"). Two ways a win becomes known: the morning federal award check
 * finds the member's own company as the winner, or the member marks a saved bid "won" in the
 * pipeline. State and local wins are only known the second way. PURE.
 */
export type MemberWinSource = "award_check" | "marked_won";

export function memberWinOwnerAlert(win: {
  memberEmail: string | null;
  title: string | null;
  agency: string | null;
  amount?: number | null;
  source: MemberWinSource;
  bidId: number;
}): { subject: string; text: string; push: { title: string; body: string; tag: string; url: string } } {
  const who = win.memberEmail?.trim() || "(member email not on file)";
  const job = (win.title ?? "").trim().slice(0, 140) || "Untitled bid";
  const agency = (win.agency ?? "").trim();
  const amount = typeof win.amount === "number" && win.amount > 0 ? `$${Math.round(win.amount).toLocaleString("en-US")}` : null;
  const how =
    win.source === "award_check"
      ? "The federal award notice names their company as the winner."
      : "They marked it won in their pipeline. That is their word; no award record was checked.";
  return {
    subject: `🏆 A Contrax member won a bid: ${who}`,
    text: [
      "A member won a bid they tracked on Contrax.",
      `Member: ${who}`,
      `Bid: ${job}${agency ? `, ${agency}` : ""}${amount ? `, ${amount}` : ""}`,
      how,
      `The bid: https://www.contrax.company/bid/${win.bidId}`,
      "Worth a personal note: a win is the best story the site can tell.",
    ].join("\n\n"),
    push: {
      title: "🏆 A member won a bid",
      body: `${who}: ${job}${amount ? ` (${amount})` : ""}`.slice(0, 180),
      tag: `win-${win.bidId}-${who}`.slice(0, 64),
      url: `/bid/${win.bidId}`,
    },
  };
}

/** Only explicit, allowlisted plan returns bypass onboarding. Never auto-charge. */
export function paidPlanReturn(value: string | null | undefined): string | null {
  if (!value || !value.startsWith("/upgrade?")) return null;
  const params = new URLSearchParams(value.slice("/upgrade?".length));
  const plan = params.get("plan");
  // Owner 2026-11-02: a $5 click on a bid page keeps the bid through signup.
  const bid = params.get("bid");
  const bidPart = bid && /^\d{1,10}$/.test(bid) ? `&bid=${bid}` : "";
  return plan && ["starter", "professional", "agency"].includes(plan)
    ? `/upgrade?plan=${plan}${bidPart}`
    : null;
}

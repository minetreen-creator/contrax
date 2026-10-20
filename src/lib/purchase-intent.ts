/** Only explicit, allowlisted plan returns bypass onboarding. Never auto-charge. */
export function paidPlanReturn(value: string | null | undefined): string | null {
  if (!value || !value.startsWith("/upgrade?")) return null;
  const params = new URLSearchParams(value.slice("/upgrade?".length));
  const plan = params.get("plan");
  return plan && ["starter", "professional", "agency"].includes(plan)
    ? `/upgrade?plan=${plan}`
    : null;
}

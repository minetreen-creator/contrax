/**
 * Picking up a $5 checkout someone started (owner 2026-11-08: "when someone signed up after starting
 * checkout, offer them the $5 checkout again right away").
 *
 * When a checkout opens, this browser remembers the plan and the time. If the person comes back on a
 * free Basic account within 48 hours without having paid, the upgrade bar says so and one tap opens
 * the checkout again. Stored only in this browser; cleared once a checkout succeeds.
 */
const KEY = "contrax_checkout_started";
export const RESUME_WINDOW_MS = 48 * 3_600_000;

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const store = (): Store | null => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
};

export function rememberCheckoutStarted(plan: string, now: number = Date.now(), s: Store | null = store()): void {
  try {
    s?.setItem(KEY, JSON.stringify({ plan, at: now }));
  } catch {
    /* storage blocked */
  }
}

/** The plan of a checkout started in the last 48 hours, else null. */
export function startedCheckoutPlan(now: number = Date.now(), s: Store | null = store()): string | null {
  try {
    const v = JSON.parse(s?.getItem(KEY) ?? "null") as { plan?: unknown; at?: unknown } | null;
    if (!v || typeof v.plan !== "string" || typeof v.at !== "number") return null;
    return now - v.at >= 0 && now - v.at <= RESUME_WINDOW_MS ? v.plan : null;
  } catch {
    return null;
  }
}

export function clearCheckoutStarted(s: Store | null = store()): void {
  try {
    s?.removeItem(KEY);
  } catch {
    /* storage blocked */
  }
}

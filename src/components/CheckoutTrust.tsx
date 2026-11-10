/**
 * One trust line under the $5 buttons (owner 2026-11-10, "no sales"): who handles the payment,
 * how people can pay, and that nothing renews. Apple Pay and Google Pay are on in Stripe (owner
 * 2026-11-09).
 */
export const CHECKOUT_TRUST_TEXT = "🔒 Secure checkout by Stripe · Card, Apple Pay or Google Pay · No auto-renew";

export function CheckoutTrust({ tone = "light", className = "" }: { tone?: "light" | "dark"; className?: string }) {
  return <p className={`text-xs ${tone === "dark" ? "text-slate-300" : "text-slate-500"} ${className}`}>{CHECKOUT_TRUST_TEXT}</p>;
}

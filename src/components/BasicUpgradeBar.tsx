import { useEffect, useState } from "react";
import { checkTrial } from "~/lib/trial";
import { STARTER_FIRST_MONTH_PRICE } from "~/lib/starter-offer";
import { trackEvent } from "~/lib/track";
import { redirectToCheckout } from "~/lib/checkout";
import { startedCheckoutPlan } from "~/lib/checkout-resume";

/**
 * Always-on bar for free Basic accounts (owner 2026-10-29: "keep basic but no
 * more living there"). Basic is for looking around; acting on a bid (the
 * official notice, contacts, daily email) needs a plan. Renders nothing for
 * trials, paying members and visitors without an account.
 *
 * Owner 2026-11-08: someone who opened the $5 checkout, backed out and then made
 * a free account gets that checkout offered again, one tap, no plan page in between.
 */
export function BasicUpgradeBar() {
  const [basic, setBasic] = useState(false);
  const [resume, setResume] = useState(false);
  const [opening, setOpening] = useState(false);
  useEffect(() => {
    checkTrial()
      .then((t) => {
        const isBasic = !!t?.trialEnded || (t?.planTier === "basic" && !t?.active);
        setBasic(isBasic);
        if (!isBasic) return;
        const started = startedCheckoutPlan() === "starter";
        setResume(started);
        trackEvent(started ? "resume_checkout_shown" : "basic_upgrade_bar_shown");
      })
      .catch(() => setBasic(false));
  }, []);
  if (!basic) return null;
  if (resume) {
    return (
      <div className="sticky top-0 z-40 border-b border-amber-500/40 bg-amber-500 px-4 py-2 text-center text-sm font-semibold text-slate-950">
        Your account is ready. Finish your ${STARTER_FIRST_MONTH_PRICE} Starter checkout to open official notices, contacts and the daily bid email.{" "}
        <button
          type="button"
          disabled={opening}
          onClick={() => {
            trackEvent("resume_checkout_click");
            setOpening(true);
            redirectToCheckout("starter").finally(() => setOpening(false));
          }}
          className="underline underline-offset-2 hover:no-underline disabled:opacity-60"
        >
          {opening ? "Opening checkout…" : `Finish for $${STARTER_FIRST_MONTH_PRICE} →`}
        </button>
      </div>
    );
  }
  return (
    <div className="sticky top-0 z-40 border-b border-amber-500/40 bg-amber-500 px-4 py-2 text-center text-sm font-semibold text-slate-950">
      You're on free Basic: you can look, but official notices, contacts and the daily bid email are for members.{" "}
      <a
        href="/upgrade?plan=starter"
        onClick={() => trackEvent("basic_upgrade_bar_click")}
        className="underline underline-offset-2 hover:no-underline"
      >
        Get Starter for ${STARTER_FIRST_MONTH_PRICE} for 30 days →
      </a>
    </div>
  );
}

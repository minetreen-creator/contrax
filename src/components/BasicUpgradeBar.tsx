import { useEffect, useState } from "react";
import { checkTrial } from "~/lib/trial";
import { STARTER_FIRST_MONTH_PRICE } from "~/lib/starter-offer";
import { trackEvent } from "~/lib/track";
import { FoundingSpotsLine } from "~/components/FoundingSpotsLine";

/**
 * Always-on bar for free Basic accounts (owner 2026-10-29: "keep basic but no
 * more living there"). Basic is for looking around; acting on a bid (the
 * official notice, contacts, daily email) needs a plan. Renders nothing for
 * trials, paying members and visitors without an account.
 */
export function BasicUpgradeBar() {
  const [basic, setBasic] = useState(false);
  useEffect(() => {
    checkTrial()
      .then((t) => {
        const isBasic = !!t?.trialEnded || (t?.planTier === "basic" && !t?.active);
        setBasic(isBasic);
        if (isBasic) trackEvent("basic_upgrade_bar_shown");
      })
      .catch(() => setBasic(false));
  }, []);
  if (!basic) return null;
  return (
    <div className="sticky top-0 z-40 border-b border-amber-500/40 bg-amber-500 px-4 py-2 text-center text-sm font-semibold text-slate-950">
      You're on free Basic: you can look, but official notices, contacts and the daily bid email are for members.{" "}
      <a
        href="/upgrade?plan=starter"
        onClick={() => trackEvent("basic_upgrade_bar_click")}
        className="underline underline-offset-2 hover:no-underline"
      >
        Get Starter for ${STARTER_FIRST_MONTH_PRICE} your first month →
      </a>
      <FoundingSpotsLine where="basic_bar" className="ml-2 underline underline-offset-2 hover:no-underline" />
    </div>
  );
}

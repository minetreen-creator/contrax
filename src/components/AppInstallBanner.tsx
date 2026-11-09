import { useEffect, useRef, useState } from "react";
import { trackEvent } from "~/lib/track";
import { APP_INSTALLED_KEY, markAppInstalled } from "~/lib/app-install";

/**
 * Install prompt for the Contrax app (owner 2026-11-07, "1"): phone visitors on
 * Radar and bid pages get a small banner at the bottom of the screen. Tapping
 * it opens the two-step install for their phone (Android's own Install button
 * when the browser offers it). Shown a little while in, never to someone who
 * already has the app open from the home screen, and once per visitor:
 * dismissing it or opening the install steps hides it for good on that phone.
 */
const SEEN_KEY = "contrax-app-banner";
/**
 * Radar waits longer (owner 2026-11-08: a Winchester visitor got the banner and
 * closed it while their search was still loading); bid pages are read at once.
 */
const SHOW_AFTER_MS = { radar: 20000, bid: 6000 } as const;

type Platform = "ios" | "android";

export function AppInstallBanner({ where, hold = false }: { where: "radar" | "bid"; hold?: boolean }) {
  const [platform, setPlatform] = useState<Platform | null>(null);
  const [visible, setVisible] = useState(false);
  // `hold` (owner 2026-11-09): bid pages keep the banner back until the visitor has seen the $5
  // offer. It still mounts at once so Android's install event is not missed.
  const [due, setDue] = useState(false);
  const shown = useRef(false);
  const [sheet, setSheet] = useState(false);
  const [installEvt, setInstallEvt] = useState<any>(null);

  useEffect(() => {
    const ua = navigator.userAgent;
    const p: Platform | null = /iPhone|iPad|iPod/.test(ua) ? "ios" : /Android/.test(ua) ? "android" : null;
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as any).standalone === true;
    let seen = false;
    try {
      seen = !!localStorage.getItem(SEEN_KEY) || !!localStorage.getItem(APP_INSTALLED_KEY);
    } catch {
      seen = true; // storage blocked: we can't remember a dismissal, so don't nag
    }
    if (!p || standalone || seen) return;
    setPlatform(p);
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallEvt(e);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    // Android finished the install (from this banner or Chrome's own menu): count it here too,
    // not only when the app is first opened from the home screen.
    const onInstalled = () => {
      markAppInstalled(ua);
      setVisible(false);
    };
    window.addEventListener("appinstalled", onInstalled);
    const t = window.setTimeout(() => setDue(true), SHOW_AFTER_MS[where]);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, [where]);

  useEffect(() => {
    if (!due || hold || shown.current || !platform) return;
    shown.current = true;
    setVisible(true);
    trackEvent("app_banner_shown", `${where}:${platform}`);
  }, [due, hold, platform, where]);

  const remember = () => {
    try {
      localStorage.setItem(SEEN_KEY, new Date().toISOString());
    } catch {}
  };

  if (!platform || !visible) return null;

  const close = () => {
    remember();
    setVisible(false);
    setSheet(false);
    trackEvent("app_banner_dismiss", `${where}:${platform}`);
  };

  const nativeInstall = async () => {
    if (!installEvt) return;
    installEvt.prompt();
    const choice = await installEvt.userChoice.catch(() => null);
    trackEvent("app_banner_install", `${where}:${choice?.outcome ?? "unknown"}`);
    setInstallEvt(null);
    if (choice?.outcome === "accepted") {
      markAppInstalled();
      setVisible(false);
    }
  };

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 px-3 pb-3" role="dialog" aria-label="Get the Contrax app">
      <div className="mx-auto max-w-md rounded-2xl border border-slate-700 bg-[#0b1220] p-3 text-white shadow-2xl">
        {!sheet ? (
          <div className="flex items-center gap-3">
            <img src="/app-icon-192.png" alt="" width={40} height={40} className="h-10 w-10 shrink-0 rounded-xl" />
            <button
              type="button"
              onClick={() => {
                remember();
                setSheet(true);
                trackEvent("app_banner_tap", `${where}:${platform}`);
              }}
              className="min-w-0 flex-1 text-left"
            >
              <span className="block text-sm font-bold leading-tight">📱 Get Contrax on your home screen</span>
              <span className="block text-xs text-slate-300">Your phone buzzes when a bid in your trade posts.</span>
            </button>
            <button type="button" onClick={close} aria-label="Close" className="px-2 text-lg leading-none text-slate-400">
              ✕
            </button>
          </div>
        ) : (
          <div>
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm font-bold">Add Contrax in 2 steps</p>
              <button type="button" onClick={close} aria-label="Close" className="px-1 text-lg leading-none text-slate-400">
                ✕
              </button>
            </div>
            {platform === "android" && installEvt ? (
              <button
                type="button"
                onClick={nativeInstall}
                className="mt-3 w-full rounded-xl bg-amber-400 px-4 py-3 text-sm font-bold text-slate-950"
              >
                Install the Contrax app
              </button>
            ) : platform === "android" ? (
              <ol className="mt-2 space-y-1 text-sm text-slate-200">
                <li>1. Tap the menu <b>⋮</b> at the top right of Chrome</li>
                <li>2. Tap <b>Install app</b> or <b>Add to Home screen</b></li>
              </ol>
            ) : (
              <ol className="mt-2 space-y-1 text-sm text-slate-200">
                <li>1. Tap <b>Open the app page</b> below, then the <b>Share</b> button ⬆️ in Safari</li>
                <li>2. Tap <b>Add to Home Screen</b>, then open Contrax from your home screen</li>
              </ol>
            )}
            <a
              href={`/app?source=banner-${where}`}
              onClick={() => trackEvent("app_banner_open_app", `${where}:${platform}`)}
              className="mt-3 block rounded-xl border border-slate-600 px-4 py-2.5 text-center text-sm font-semibold text-white"
            >
              Open the app page
            </a>
            <p className="mt-2 text-center text-[11px] text-slate-400">Phone alerts need a paid plan. Browsing bids does not.</p>
          </div>
        )}
      </div>
    </div>
  );
}

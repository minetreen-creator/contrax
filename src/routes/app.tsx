import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { STATE_CODE_TO_NAME } from "~/lib/location-state";
import { stateFromCoords } from "~/lib/state-from-coords";
import { STARTER_FIRST_MONTH_PRICE } from "~/lib/starter-offer";
import { trackEvent } from "~/lib/track";
import { BIDS_FIRST_TABS, getBidsFirst, type BidsFirstData, type BidsFirstTab } from "~/lib/bids-first";

/**
 * The Contrax app (owner 2026-11-07: "yes build the app"). An installable web
 * app: Add to Home Screen on iPhone, Install on Android. Open to everyone;
 * the phone notifications are for paid plans ("i like your way better").
 */

interface MiniBid {
  id: number;
  title: string;
  agency: string;
  due_date: string | null;
}

/** The member's matches from the last 24 hours (what the notifications are about). Paid plans only. */
const getNewForYou = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ paid: boolean; label: string; bids: MiniBid[] }> => {
    const none = { paid: false, label: "", bids: [] };
    try {
      const { getCurrentUser } = await import("~/lib/auth");
      const user = await getCurrentUser();
      if (!user) return none;
      const { hasPaidBidAccess } = await import("~/lib/head-start.server");
      if (!(await hasPaidBidAccess(user))) return none;
      const { primaryProfile } = await import("~/lib/trial-recap.server");
      const { buildDigestMatcher } = await import("~/lib/digest-match");
      const matcher = buildDigestMatcher(await primaryProfile(Number(user.id)));
      if (!matcher.personal) return { paid: true, label: "", bids: [] };
      const { sql } = await import("~/db");
      const { LOW_CONTENT_SQL } = await import("~/lib/low-content");
      const { AWARD_EXCLUSION_SQL } = await import("~/lib/source-class");
      const s = sql();
      const rows = (await s`
        SELECT id, title, agency, due_date, location, description, category, naics_code FROM bids
        WHERE created_at > NOW() - INTERVAL '24 hours' AND due_date > NOW()
          AND ${s.unsafe(LOW_CONTENT_SQL)} AND ${s.unsafe(AWARD_EXCLUSION_SQL)}
        ORDER BY created_at DESC`) as any[];
      const bids = rows
        .filter((r) => matcher.matches(r))
        .slice(0, 30)
        .map((r) => ({ id: Number(r.id), title: String(r.title ?? ""), agency: String(r.agency ?? ""), due_date: r.due_date ? new Date(r.due_date).toISOString() : null }));
      return { paid: true, label: matcher.label, bids };
    } catch (e) {
      console.error("[app] new-for-you failed:", e);
      return none;
    }
  },
);

const due = (iso: string | null) =>
  iso ? `Due ${new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : "";

function keyBytes(base64: string): Uint8Array {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

type Platform = "ios" | "android" | "other";
type AlertState = "loading" | "signed-out" | "needs-plan" | "unsupported" | "ios-install-first" | "off" | "on" | "blocked" | "working";

function BidList({ bids }: { bids: MiniBid[] }) {
  return (
    <ul className="mt-3 divide-y divide-slate-800">
      {bids.map((b) => (
        <li key={b.id}>
          <a href={`/bid/${b.id}`} className="block py-3 active:bg-slate-800/60">
            <span className="block text-sm font-semibold leading-snug text-white">{b.title}</span>
            <span className="mt-0.5 block text-xs text-slate-400">{[b.agency, due(b.due_date)].filter(Boolean).join(" · ")}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

function AppPage() {
  const [platform, setPlatform] = useState<Platform>("other");
  const [standalone, setStandalone] = useState(false);
  const [installEvt, setInstallEvt] = useState<any>(null);
  const [alerts, setAlerts] = useState<AlertState>("loading");
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [newForYou, setNewForYou] = useState<{ paid: boolean; label: string; bids: MiniBid[] } | null>(null);
  // Owner 2026-11-08 (mystery-shopper pass): "Bids near me" led with food
  // orders ("Various Breakfast Products"). It now shows real trade work by tab,
  // from the same source as the Radar landing panel (~/lib/bids-first).
  const [nearby, setNearby] = useState<BidsFirstData | null | undefined>(undefined);
  const [tab, setTab] = useState<BidsFirstTab>("construction");
  const [locating, setLocating] = useState(false);

  const loadNearby = (state: string) => {
    getBidsFirst({ data: { state } })
      .then((n) => {
        setNearby(n);
        try {
          if (n?.state) localStorage.setItem("contrax-app-state", n.state);
        } catch {}
      })
      .catch(() => setNearby(null));
  };

  useEffect(() => {
    const ua = navigator.userAgent;
    setPlatform(/iPhone|iPad|iPod/.test(ua) ? "ios" : /Android/.test(ua) ? "android" : "other");
    const isStandalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as any).standalone === true;
    setStandalone(isStandalone);
    trackEvent("app_open", isStandalone ? "installed" : "browser");
    // Install counting (owner 2026-11-07: "Is there a way to track downloads?").
    // Android reports a finished install (appinstalled); iPhone never does, so
    // the first open from the home screen counts instead. One flag per phone
    // keeps an Android install from counting twice.
    const devicePlatform = /iPhone|iPad|iPod/.test(ua) ? "ios" : /Android/.test(ua) ? "android" : "desktop";
    const countInstall = () => {
      try {
        if (localStorage.getItem("contrax-app-installed")) return;
        localStorage.setItem("contrax-app-installed", new Date().toISOString());
      } catch {}
      trackEvent("app_installed", devicePlatform);
    };
    if (isStandalone) countInstall();
    window.addEventListener("appinstalled", countInstall);
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallEvt(e);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
    let saved = "";
    try {
      saved = localStorage.getItem("contrax-app-state") ?? "";
    } catch {}
    loadNearby(saved);
    getNewForYou().then(setNewForYou).catch(() => {});
    (async () => {
      const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
      let endpoint = "";
      if (supported) {
        const reg = await navigator.serviceWorker.getRegistration("/").catch(() => undefined);
        endpoint = (await reg?.pushManager.getSubscription().catch(() => null))?.endpoint ?? "";
      }
      const res = await fetch(`/api/push${endpoint ? `?endpoint=${encodeURIComponent(endpoint)}` : ""}`, { credentials: "same-origin" }).then((r) => r.json()).catch(() => null);
      if (!res || !res.signedIn) return setAlerts("signed-out");
      if (!res.paid) return setAlerts("needs-plan");
      setPublicKey(res.publicKey);
      if (!supported) return setAlerts(/iPhone|iPad|iPod/.test(navigator.userAgent) && !isStandalone ? "ios-install-first" : "unsupported");
      if (Notification.permission === "denied") return setAlerts("blocked");
      setAlerts(res.on ? "on" : "off");
    })();
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", countInstall);
    };
  }, []);

  const turnOn = async () => {
    if (!publicKey) return;
    setAlerts("working");
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") return setAlerts(perm === "denied" ? "blocked" : "off");
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) as BufferSource }));
      const r = await fetch("/api/push", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "subscribe", subscription: sub.toJSON() }) });
      if (r.status === 402) return setAlerts("needs-plan");
      if (!r.ok) throw new Error(String(r.status));
      trackEvent("app_alerts_on", platform);
      setAlerts("on");
    } catch {
      setAlerts("off");
    }
  };

  const turnOff = async () => {
    setAlerts("working");
    try {
      const reg = await navigator.serviceWorker.getRegistration("/");
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "unsubscribe", endpoint: sub.endpoint }) });
        await sub.unsubscribe();
      }
      setAlerts("off");
    } catch {
      setAlerts("on");
    }
  };

  const useMyLocation = () => {
    if (!("geolocation" in navigator)) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        // The coordinates never leave the phone; only the state code is used.
        const st = stateFromCoords(pos.coords.latitude, pos.coords.longitude);
        if (st) loadNearby(st);
      },
      () => setLocating(false),
      { maximumAge: 600_000, timeout: 10_000 },
    );
  };

  const install = async () => {
    if (!installEvt) return;
    installEvt.prompt();
    const choice = await installEvt.userChoice.catch(() => null);
    trackEvent("app_install_prompt", choice?.outcome ?? "unknown");
    setInstallEvt(null);
  };

  const stateName = nearby?.state ? STATE_CODE_TO_NAME[nearby.state] : "";

  return (
    <main className="min-h-screen bg-slate-950 pb-12 text-slate-100">
      <div className="mx-auto w-full max-w-md px-4 pt-6">
        <div className="flex items-center gap-3">
          <img src="/app-icon-192.png" alt="" width={44} height={44} className="rounded-xl" />
          <div>
            <p className="text-lg font-extrabold leading-tight text-white">Contrax</p>
            <p className="text-xs text-slate-400">Public bids near you, the minute they post</p>
          </div>
        </div>

        {!standalone && (
          <section className="mt-5 rounded-2xl border border-amber-400/40 bg-amber-400/10 p-4">
            <h1 className="text-base font-bold text-amber-200">📲 Put Contrax on your home screen</h1>
            {platform === "ios" ? (
              <ol className="mt-2 space-y-1 text-sm text-slate-200">
                <li>1. Tap the <b>Share</b> button <span aria-hidden="true">⬆️</span> at the bottom of Safari</li>
                <li>2. Tap <b>Add to Home Screen</b></li>
                <li>3. Open Contrax from your home screen to turn on alerts</li>
              </ol>
            ) : installEvt ? (
              <button onClick={install} className="mt-3 w-full rounded-xl bg-amber-400 px-4 py-3 text-base font-bold text-slate-950 active:bg-amber-300">
                Install the Contrax app
              </button>
            ) : (
              <p className="mt-2 text-sm text-slate-200">
                Open your browser menu <span aria-hidden="true">⋮</span> and tap <b>Install app</b> or <b>Add to Home screen</b>.
              </p>
            )}
          </section>
        )}

        <section className="mt-5 rounded-2xl border border-slate-700 bg-slate-900 p-4">
          <h2 className="text-base font-bold text-white">🔔 Bid alerts on your phone</h2>
          <p className="mt-1 text-sm text-slate-300">Your phone buzzes when a new public bid in your trade and area posts, and again before a saved bid is due.</p>
          {alerts === "loading" || alerts === "working" ? (
            <p className="mt-3 text-sm text-slate-400">One moment…</p>
          ) : alerts === "signed-out" ? (
            <div className="mt-3 flex gap-2">
              <a href="/signup" className="flex-1 rounded-xl bg-amber-400 px-4 py-3 text-center text-sm font-bold text-slate-950">Create account</a>
              <a href="/login" className="flex-1 rounded-xl border border-slate-600 px-4 py-3 text-center text-sm font-semibold text-white">Sign in</a>
            </div>
          ) : alerts === "needs-plan" ? (
            <a href="/upgrade?plan=starter" onClick={() => trackEvent("app_alerts_upgrade_click")} className="mt-3 block rounded-xl bg-emerald-500 px-4 py-3 text-center text-sm font-bold text-slate-950">
              Turn on alerts with Starter: ${STARTER_FIRST_MONTH_PRICE} for 30 days
            </a>
          ) : alerts === "ios-install-first" ? (
            <p className="mt-3 text-sm text-amber-200">On iPhone, add Contrax to your home screen first (steps above), then open it from there to turn on alerts.</p>
          ) : alerts === "unsupported" ? (
            <p className="mt-3 text-sm text-slate-400">This browser can&apos;t show notifications. Try Chrome on Android, or Safari on iPhone (iOS 16.4 or later) after adding Contrax to your home screen.</p>
          ) : alerts === "blocked" ? (
            <p className="mt-3 text-sm text-amber-200">Notifications are blocked for Contrax. Turn them on in your phone&apos;s settings, then come back here.</p>
          ) : alerts === "on" ? (
            <div className="mt-3 flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-emerald-300">✓ Alerts are on for this phone</p>
              <button onClick={turnOff} className="text-xs text-slate-400 underline">Turn off</button>
            </div>
          ) : (
            <button onClick={turnOn} className="mt-3 w-full rounded-xl bg-amber-400 px-4 py-3 text-base font-bold text-slate-950 active:bg-amber-300">
              Turn on bid alerts
            </button>
          )}
          {newForYou?.paid && !newForYou.label && (
            <p className="mt-3 text-xs text-slate-400">
              Tell us your trade and state so alerts know what to send: <a href="/dashboard" className="text-amber-300 underline">set up your profile</a>.
            </p>
          )}
        </section>

        {newForYou?.paid && newForYou.label && (
          <section id="new" className="mt-5 rounded-2xl border border-slate-700 bg-slate-900 p-4">
            <h2 className="text-base font-bold text-white">🆕 New for you</h2>
            <p className="mt-1 text-xs text-slate-400">Last 24 hours · {newForYou.label}</p>
            {newForYou.bids.length ? <BidList bids={newForYou.bids} /> : <p className="mt-3 text-sm text-slate-400">Nothing new in the last 24 hours. We&apos;ll buzz you when there is.</p>}
          </section>
        )}

        <section className="mt-5 rounded-2xl border border-slate-700 bg-slate-900 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-white">📍 Bids near me</h2>
              {nearby?.state ? (
                <p className="mt-1 text-xs text-slate-400">
                  {nearby.total.toLocaleString()} open bids in {stateName}
                </p>
              ) : null}
            </div>
            <button onClick={useMyLocation} disabled={locating} className="shrink-0 rounded-lg border border-slate-600 px-3 py-2 text-xs font-semibold text-white">
              {locating ? "Finding you…" : "Use my location"}
            </button>
          </div>
          <label className="mt-3 block text-xs text-slate-400">
            State{" "}
            <select
              value={nearby?.state ?? ""}
              onChange={(e) => loadNearby(e.target.value)}
              className="ml-1 rounded-lg border border-slate-600 bg-slate-800 px-2 py-1 text-sm text-white"
            >
              <option value="">Pick a state</option>
              {Object.entries(STATE_CODE_TO_NAME)
                .sort((a, b) => a[1].localeCompare(b[1]))
                .map(([code, name]) => (
                  <option key={code} value={code}>
                    {name}
                  </option>
                ))}
            </select>
          </label>
          {nearby === undefined ? (
            <p className="mt-3 text-sm text-slate-400">Loading…</p>
          ) : nearby ? (
            <>
              <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="Trades">
                {BIDS_FIRST_TABS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    role="tab"
                    aria-selected={tab === t.id}
                    onClick={() => {
                      setTab(t.id);
                      trackEvent("app_nearby_tab", t.id);
                    }}
                    className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold ${
                      tab === t.id ? "border-amber-500 bg-amber-500/15 text-amber-300" : "border-slate-700 text-slate-300"
                    }`}
                  >
                    {t.label} <span className="text-slate-400">{nearby.counts[t.id].toLocaleString()}</span>
                  </button>
                ))}
              </div>
              {nearby.bids[tab].length ? (
                <BidList bids={nearby.bids[tab]} />
              ) : (
                <p className="mt-3 text-sm text-slate-400">No open bids in this trade in {stateName} right now. Try another trade or state.</p>
              )}
              <a
                href={`/radar?trade=${encodeURIComponent(BIDS_FIRST_TABS.find((t) => t.id === tab)?.trade ?? "")}&state=${nearby.state}`}
                className="mt-2 block text-sm font-semibold text-amber-300"
              >
                See every {BIDS_FIRST_TABS.find((t) => t.id === tab)?.label.toLowerCase()} match in {stateName} →
              </a>
            </>
          ) : (
            <p className="mt-3 text-sm text-slate-400">Pick your state to see open bids.</p>
          )}
        </section>

        <nav className="mt-5 grid grid-cols-2 gap-3 text-sm">
          <a href="/radar" className="rounded-2xl border border-slate-700 bg-slate-900 p-4 font-semibold text-white">
            🔎 Search by trade
          </a>
          <a href="/megaprojects" className="rounded-2xl border border-slate-700 bg-slate-900 p-4 font-semibold text-white">
            🏗️ Megaprojects
          </a>
        </nav>
        <p className="mt-4 text-center text-xs text-slate-500">💰 Open any bid to see what similar federal jobs in your state went for.</p>
      </div>
    </main>
  );
}

export const Route = createFileRoute("/app")({
  head: () => ({
    meta: [
      { title: "Contrax app: public bids near you, with phone alerts" },
      { name: "description", content: "Open government bids in your trade and area. Add Contrax to your home screen and get a buzz when a new bid posts." },
      { name: "theme-color", content: "#0b1220" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-title", content: "Contrax" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
    ],
    links: [
      { rel: "manifest", href: "/app.webmanifest" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
      { rel: "canonical", href: "https://www.contrax.company/app" },
    ],
  }),
  component: AppPage,
});

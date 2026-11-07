/**
 * Contrax app numbers for Mission Control (owner 2026-11-07: "Is there a way
 * to track downloads of the app?"). Counts only, no individual visitors.
 * Filled by /api/admin/live-console; shown in the App card.
 */
export interface AppWindowCounts {
  /** Phones that installed the app (Android install event, or first home-screen open on iPhone). */
  installs: number;
  iphone: number;
  android: number;
  /** People who opened the app page at all (browser or installed). */
  opened: number;
  /** People who clicked an app link on the homepage or a bid page. */
  linkClicks: number;
  /** People who tapped a "$5 Starter for alerts" button (app page or homepage). */
  starterClicks: number;
  /** Phones that turned alerts on in this window. */
  alertsTurnedOn: number;
}

export interface AppStats {
  today: AppWindowCounts;
  week: AppWindowCounts;
  sinceLaunch: AppWindowCounts;
  /** Phones with alerts on right now. */
  alertsOnNow: number;
}

export const APP_EVENT_NAMES = ["app_installed", "app_open", "home_app_click", "bid_app_click", "app_alerts_upgrade_click"] as const;

/** Fold per-window SQL rows into the card's numbers. PURE. */
export function appWindow(r: Partial<Record<keyof AppWindowCounts, number | string | null>> | undefined): AppWindowCounts {
  const n = (v: unknown) => Number(v ?? 0) || 0;
  return {
    installs: n(r?.installs),
    iphone: n(r?.iphone),
    android: n(r?.android),
    opened: n(r?.opened),
    linkClicks: n(r?.linkClicks),
    starterClicks: n(r?.starterClicks),
    alertsTurnedOn: n(r?.alertsTurnedOn),
  };
}

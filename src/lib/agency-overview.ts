/**
 * CROSS-CLIENT DASHBOARD — the pure half (Agency tier phase 2, owner decision
 * 2026-10-20; business plan rev 370 "PHASES 2–3 QUEUED" → this is phase 2).
 *
 * WHAT IT ANSWERS. One Agency account can hold up to 10 client workspaces (phase 1,
 * migration 068). A consultant cannot be "inside" all of them at once — the active
 * workspace is a single switch — so this module turns a per-workspace STATISTICS
 * row into the one view a consultant actually needs: for every client, which bids
 * fall due in the next seven days, which are already past due, which pipelines are
 * moving, how much CRM contact there is, and when that client was last touched.
 *
 * CLIENT-SAFE BY CONSTRUCTION — NO IMPORTS, exactly like src/lib/workspaces.ts:
 * the /workspace UI (src/components/AgencyClientOverview.tsx) imports these types
 * and this function, so nothing here may reach `~/db` or any `*.server` module.
 * The database statement lives in src/lib/agency-overview.server.ts; the endpoint
 * in src/routes/api/agency-overview.ts.
 *
 * THIS MODULE DECIDES NOTHING ABOUT ENTITLEMENT OR CAPS. It never creates, edits or
 * gates: it aggregates rows the server has already read for the caller's OWN
 * workspaces. The 10-workspace ceiling, the Agency entitlement ladder and every
 * scope predicate stay where phase 1 put them (src/lib/workspaces.ts,
 * src/lib/workspaces.server.ts, /api/workspaces) — re-implementing any of them here
 * is exactly the drift this phase is not allowed to introduce.
 *
 * WHERE THE ROLLUP COMES FROM. The per-workspace counts are computed by ONE SQL
 * statement keyed on `workspace_id` (so a client's row can never contain another
 * client's bids: the join condition IS the scope, there is no unscoped list here to
 * leak through). The counts handed to this module are therefore already
 * per-workspace; `clampCount()` still refuses a negative/NaN/∞ count rather than
 * rendering "-1 due" or "NaN" in a dashboard a consultant acts on.
 */

/** The `saved_matches.pursuit_status` values (migration 052; same five the editor allows). */
export type PursuitStatus = "evaluating" | "preparing" | "submitted" | "won" | "lost";

/** Statuses that mean the bid is IN MOTION and not yet decided. */
const ADVANCING: PursuitStatus[] = ["preparing", "submitted"];

/** How far ahead "due soon" reaches: today plus this many days, inclusive. */
export const DUE_WINDOW_DAYS = 7;

/** The date range a rollup covers, as ISO `YYYY-MM-DD` strings. */
export interface AgencyOverviewWindow {
  /** First day counted (a bid due today is NOT overdue). */
  today: string;
  /** Last day counted as "due soon" — `today + DUE_WINDOW_DAYS`, inclusive. */
  weekEnd: string;
}

/** One workspace's raw counts, as the store returns them. */
export interface WorkspaceStats {
  id: number;
  name: string;
  states: string[];
  trades: string[];
  /** Saved bids filed under this client (`saved_matches.workspace_id`). */
  savedBids: number;
  /** Saved bids whose bid falls due inside the window. */
  dueInWindow: number;
  /** Saved bids whose due date has already passed. */
  overdue: number;
  /** Saved bids per pursuit status, as stored. Unknown keys are ignored. */
  byPursuit: Record<string, number>;
  /** Newest `saved_matches.created_at` for this client, or null. */
  lastSavedAt: string | null;
  /** Live (non-archived) CRM contacts filed under this client. */
  contacts: number;
  /** Newest CRM activity on one of this client's contacts, or null. */
  lastCrmActivityAt: string | null;
}

/** A workspace's rollup: the raw counts plus what the dashboard derives from them. */
export interface WorkspaceRollup extends WorkspaceStats {
  /** Bids currently moving in the pipeline (preparing + submitted). */
  advancing: number;
  /** Why this client needs attention, most urgent first. Empty ⇒ quiet. */
  attention: string[];
  /** The newest of `lastSavedAt` / `lastCrmActivityAt`, or null if never touched. */
  lastActivityAt: string | null;
}

/** Account-wide sums over every visible workspace. */
export interface AgencyOverviewTotals {
  workspaces: number;
  savedBids: number;
  dueInWindow: number;
  overdue: number;
  contacts: number;
  advancing: number;
}

/** The payload of GET /api/agency-overview. */
export interface AgencyOverview {
  window: AgencyOverviewWindow;
  /** Attention-first, then by name: the client that needs work is at the top. */
  workspaces: WorkspaceRollup[];
  totals: AgencyOverviewTotals;
}

/**
 * `Date` → ISO `YYYY-MM-DD` in UTC. UTC on purpose: the window is compared against
 * `due_date::date` in the database, and an explicit UTC day is the only reading that
 * is identical on every machine (the same convention src/lib/bid-status.ts's
 * `LIVE_SQL` relies on for `NOW()::date`).
 */
export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * The rollup window for `now`: today, and the last day counted as "due soon".
 * A 7-day window is INCLUSIVE of both ends (`today .. today + 7`), so a bid due
 * exactly a week out shows up, and one due in eight days does not.
 */
export function dayWindow(now: Date): AgencyOverviewWindow {
  const end = new Date(now.getTime() + DUE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  return { today: isoDate(now), weekEnd: isoDate(end) };
}

/** A count that can be rendered: a finite, non-negative integer, else 0. */
export function clampCount(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

/**
 * A timestamptz column as an ISO-8601 string, or null. The Neon driver parses
 * timestamptz into a JS `Date`, and `String(date)` is "Mon Oct 19 2026 09:00:00
 * GMT+0000" — NOT ISO, which would silently break the newest-of-two comparison
 * below (it compares strings, and ISO-8601 sorts chronologically). Normalised here,
 * in one place, and pinned by a test.
 */
export function isoTimestamp(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  return String(value);
}

/** The count for one pursuit status, clamped; anything unrecognised is not counted. */
export function countPursuit(byPursuit: Record<string, number> | null | undefined, status: PursuitStatus): number {
  return clampCount(byPursuit ? byPursuit[status] : 0);
}

/** Bids in motion (preparing + submitted) — decided ones (won/lost) are not advancing. */
export function advancingCount(byPursuit: Record<string, number> | null | undefined): number {
  return ADVANCING.reduce((sum, status) => sum + countPursuit(byPursuit, status), 0);
}

/** The newest of two ISO timestamps as strings (lexical order is chronological when both are ISO-8601). */
function newest(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a >= b ? a : b;
}

/** Why this client needs attention — most urgent first; empty when it is quiet. */
export function attentionReasons(stats: {
  name: string;
  overdue: number;
  dueInWindow: number;
  advancing: number;
}): string[] {
  const reasons: string[] = [];
  if (stats.overdue > 0) reasons.push(`${stats.overdue} overdue`);
  if (stats.dueInWindow > 0) reasons.push(`${stats.dueInWindow} due in the next ${DUE_WINDOW_DAYS} days`);
  if (stats.advancing > 0) reasons.push(`${stats.advancing} advancing in the pipeline`);
  return reasons;
}

/** How urgent a workspace is: an overdue bid outranks a soon-due one outranks movement. */
function urgency(r: WorkspaceRollup): number {
  return r.overdue * 1000 + r.dueInWindow * 100 + r.advancing;
}

/**
 * Turn the per-workspace statistics into the dashboard payload: derive, total, and
 * order. Ordering is deterministic and explicit (urgency descending, then name,
 * then id) rather than relying on the store's row order or on a locale-sensitive
 * compare — the same fixture must always produce the same list.
 */
export function buildAgencyOverview(
  stats: readonly WorkspaceStats[],
  window: AgencyOverviewWindow,
): AgencyOverview {
  const workspaces: WorkspaceRollup[] = stats.map((row) => {
    const savedBids = clampCount(row.savedBids);
    const dueInWindow = clampCount(row.dueInWindow);
    const overdue = clampCount(row.overdue);
    const contacts = clampCount(row.contacts);
    const advancing = advancingCount(row.byPursuit);
    return {
      ...row,
      savedBids,
      dueInWindow,
      overdue,
      contacts,
      advancing,
      states: Array.isArray(row.states) ? row.states : [],
      trades: Array.isArray(row.trades) ? row.trades : [],
      lastSavedAt: row.lastSavedAt ?? null,
      lastCrmActivityAt: row.lastCrmActivityAt ?? null,
      lastActivityAt: newest(row.lastSavedAt ?? null, row.lastCrmActivityAt ?? null),
      attention: attentionReasons({ name: row.name, overdue, dueInWindow, advancing }),
    };
  });

  workspaces.sort((a, b) => {
    const delta = urgency(b) - urgency(a);
    if (delta !== 0) return delta;
    if (a.name !== b.name) return a.name < b.name ? -1 : 1;
    return a.id - b.id;
  });

  const totals: AgencyOverviewTotals = {
    workspaces: workspaces.length,
    savedBids: workspaces.reduce((n, w) => n + w.savedBids, 0),
    dueInWindow: workspaces.reduce((n, w) => n + w.dueInWindow, 0),
    overdue: workspaces.reduce((n, w) => n + w.overdue, 0),
    contacts: workspaces.reduce((n, w) => n + w.contacts, 0),
    advancing: workspaces.reduce((n, w) => n + w.advancing, 0),
  };

  return { window, workspaces, totals };
}

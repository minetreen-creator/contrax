/**
 * CLIENT WORKSPACES — the pure policy of the Agency tier's multi-client
 * workspaces (owner decision 2026-10-20, business plan rev 369, phase 1).
 *
 * A workspace is a named client bucket owned by one account: a name, a link to the
 * `business_profiles` row that carries its states (locations) and trades
 * (service_categories), and — through `users.active_profile_id` — the account's
 * active client context. Nothing here touches a database: this module is imported
 * by the browser (the /workspace UI reads the cap) as well as by the server route,
 * so it holds ONLY the limits, the cap arithmetic, the scope fragment and the input
 * validation.
 *
 * NO IMPORTS ON PURPOSE: this module is imported by the browser bundle (the
 * /workspace UI reads the cap) AND by server code, so it must never pull in `~/db`.
 * The entitlement ladder lives in src/lib/workspaces.server.ts, which imports
 * `hasAgencyAccess` from ~/lib/trial.
 *
 * THE ENTITLEMENT LADDER IS NOT NEW (and must not become new):
 *   * `hasAgencyAccess` (src/lib/trial.ts) is the shipped Agency gate — /workspace
 *     already uses it, and it owns the internal bypass set (admin, an active
 *     full-access grant, the internal demo tier) and the `!expired` guard.
 *   * the "entitled" predicate is the CRM's own: `!expired && (subscription_status
 *     === 'active' || trial.active)` — a stored `plan_tier` ALONE never grants.
 * Workspace creation needs BOTH. So an account that picked "Agency" at signup and
 * never paid, trialled or was granted anything cannot create clients, exactly like
 * it cannot edit a CRM contact.
 *
 * READS ARE NEVER GATED HERE. The store's list/read path has no entitlement check:
 * a downgraded account keeps every workspace, saved bid and contact it created and
 * can still READ them — the same "reads survive downgrade, edits gated, data
 * preserved" policy as the CRM (src/lib/crm-access.server.ts). Only create, rename
 * and settings writes go through `canCreate`/`canAddWorkspace`.
 */

/** Hard cap: one Agency account may hold at most this many client workspaces. */
export const WORKSPACE_LIMIT = 10;
/** Longest accepted workspace (client) name, matching the migration's CHECK. */
export const WORKSPACE_NAME_MAX = 80;
/** Most state codes one workspace may carry (there are 50 + DC + territories). */
export const WORKSPACE_STATES_MAX = 60;
/** Most trade labels one workspace may carry. */
export const WORKSPACE_TRADES_MAX = 20;
/** Longest accepted trade label (same bound as business_profiles service_categories). */
export const WORKSPACE_TRADE_MAX = 120;

/** What the caller may do with workspaces, and the cap they are held to. */
export interface WorkspaceAccess {
  /** Create / rename / edit settings. False for anything below Agency. */
  canCreate: boolean;
  /** The create cap when `canCreate`; 0 otherwise (never a permissive default). */
  limit: number;
}

/**
 * The cap arithmetic, pure and shared by the route (which answers 409) and the
 * database function `workspace_create` (which refuses to insert past the same cap
 * under an advisory lock). `existingCount` is what the caller OWNS right now.
 */
export function canAddWorkspace(existingCount: number, access: WorkspaceAccess): boolean {
  if (!access.canCreate) return false;
  if (!Number.isFinite(existingCount) || existingCount < 0) return false;
  return existingCount < Math.min(access.limit, WORKSPACE_LIMIT);
}

/** A trimmed, non-empty client name inside the migration's CHECK, or null. */
export function validateWorkspaceName(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const name = input.trim();
  if (name.length < 1 || name.length > WORKSPACE_NAME_MAX) return null;
  return name;
}

/**
 * State codes, normalised to upper-case two-letter codes, de-duplicated and in the
 * caller's order. Returns null when the input is not an array of usable codes — it
 * NEVER drops a bad code silently, because a silently dropped state would look like
 * the workspace simply does not cover it.
 */
export function validateWorkspaceStates(input: unknown): string[] | null {
  if (!Array.isArray(input)) return null;
  const out: string[] = [];
  for (const raw of input) {
    if (typeof raw !== "string") return null;
    const code = raw.trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(code)) return null;
    if (!out.includes(code)) out.push(code);
  }
  if (out.length > WORKSPACE_STATES_MAX) return null;
  return out;
}

/** Trade labels: trimmed, non-empty, bounded, de-duplicated. Null when unusable. */
export function validateWorkspaceTrades(input: unknown): string[] | null {
  if (!Array.isArray(input)) return null;
  const out: string[] = [];
  for (const raw of input) {
    if (typeof raw !== "string") return null;
    const trade = raw.trim().replace(/\s+/g, " ");
    if (trade.length < 1 || trade.length > WORKSPACE_TRADE_MAX) return null;
    if (!out.includes(trade)) out.push(trade);
  }
  if (out.length > WORKSPACE_TRADES_MAX) return null;
  return out;
}

/**
 * The WHERE fragment that scopes a `saved_matches` / `crm_contacts` read to one
 * workspace context:
 *
 *   null   → `workspace_id IS NULL` — the account's own context. This is the ONLY
 *            branch a Starter/Professional account can ever take (it can never own a
 *            workspace), so their reads are unchanged by the workspace feature.
 *   number → `workspace_id = <id>` — one client's rows, never another's.
 *
 * Returned as SQL TEXT for `sql().unsafe(...)` (the house pattern for a hardcoded
 * fragment), and the id is a SERVER-RESOLVED integer coerced through Number.isInteger
 * here, never a client-supplied string. An id that is not a positive integer throws
 * rather than widening the scope: a broken scope must fail loudly, never read
 * everything.
 */
export function workspaceScopeClause(activeWorkspaceId: number | null, qualifier?: string): string {
  // A table qualifier is REQUIRED whenever the query joins another table that also has
  // a `workspace_id` (saved_matches ⋈ crm_contacts) — an unqualified column would make
  // PostgreSQL raise "column reference workspace_id is ambiguous".
  let column = "workspace_id";
  if (qualifier !== undefined) {
    if (!/^[a-z_][a-z0-9_]*$/i.test(qualifier)) {
      throw new Error(`workspaceScopeClause: refusing a malformed table qualifier (${qualifier})`);
    }
    column = `${qualifier}.workspace_id`;
  }
  if (activeWorkspaceId === null) return `${column} IS NULL`;
  if (!Number.isInteger(activeWorkspaceId) || activeWorkspaceId <= 0) {
    throw new Error(`workspaceScopeClause: refusing a non-positive workspace id (${String(activeWorkspaceId)})`);
  }
  return `${column} = ${activeWorkspaceId}`;
}

/**
 * CLIENT WORKSPACES — the data layer (Agency tier phase 1, owner decision
 * 2026-10-20). SERVER-ONLY (imports `~/db`); /api/workspaces and the saved-bid /
 * CRM read paths are its callers.
 *
 * WHAT A WORKSPACE IS HERE. One row in `workspaces` (migration 068): a client name,
 * the account that owns it, and the `business_profiles` row that carries its states
 * (`locations`) and trades (`service_categories`). The ACTIVE workspace is NOT a new
 * column: it is `users.active_profile_id` — the switch the Agency page has used
 * since the entity feature — resolved back to its workspace row. Using the one
 * existing switch means the Radar/dashboard feed (which already reads the active
 * profile) follows the workspace with no second source of truth.
 *
 * ENTITLEMENT IS DECIDED IN ONE PLACE: `computeWorkspaceAccess` below (the shipped
 * `hasAgencyAccess` gate + the CRM's "entitled" predicate). The STORE never decides
 * anything: `create()` takes the `limit` the caller was granted and the database function
 * `workspace_create` enforces it atomically under an advisory lock; a NULL return
 * means the cap was hit and /api/workspaces maps it to 409. `list()` and
 * `getActiveWorkspaceId()` are pure reads with NO entitlement check, so a
 * downgraded account keeps reading every workspace, saved bid and contact it
 * created (the CRM's "reads survive downgrade" policy, applied to workspaces).
 *
 * EVERY METHOD IS OWNER-SCOPED BY CONSTRUCTION: `userId` is a required argument and
 * appears in the WHERE clause of every statement, so a client-supplied workspace id
 * can never reach another account's row.
 */
import { sql } from "~/db";
import { hasAgencyAccess, type TrialStatus } from "~/lib/trial";
import { WORKSPACE_LIMIT, type WorkspaceAccess } from "~/lib/workspaces";

/**
 * PURE entitlement ladder for workspaces. It lives HERE (not in the client-safe
 * src/lib/workspaces.ts) because it reads `hasAgencyAccess` from ~/lib/trial, which
 * imports `~/db`.
 *
 * THE LADDER IS NOT NEW (and must not become new):
 *   * `hasAgencyAccess` (src/lib/trial.ts) is the shipped Agency gate — /workspace
 *     already uses it — and it owns the internal bypass set (admin, an active
 *     full-access grant, the internal demo tier) and the `!expired` guard.
 *   * the "entitled" predicate is the CRM's own: `!expired && (subscription_status
 *     === 'active' || trial.active)`. A stored `plan_tier` ALONE never grants, so an
 *     account that picked "Agency" at signup and never paid, trialled or was granted
 *     anything cannot create clients — exactly like it cannot edit a CRM contact.
 * Creation needs BOTH halves; reads are never gated by this module.
 */
export function computeWorkspaceAccess(
  trial: Pick<TrialStatus, "active" | "expired" | "planTier" | "fullAccess"> | null | undefined,
  subscriptionStatus: string | null | undefined,
  user?: { is_admin?: boolean } | null,
): WorkspaceAccess {
  const agencyTier = hasAgencyAccess(trial, user);
  const internal =
    user?.is_admin === true ||
    trial?.fullAccess === true ||
    (trial?.planTier === "demo" && trial?.expired !== true);
  const entitled =
    !!trial && !trial.expired && (subscriptionStatus === "active" || trial.active === true);
  const canCreate = agencyTier && (internal || entitled);
  return { canCreate, limit: canCreate ? WORKSPACE_LIMIT : 0 };
}

/** One workspace as the UI and the scope helpers need it. */
export interface WorkspaceRow {
  id: number;
  name: string;
  profileId: number | null;
  states: string[];
  trades: string[];
  created_at: string | null;
}

/** What /api/workspaces asks of the database. */
export interface WorkspaceStore {
  /** The caller's own workspaces, oldest first. Never entitlement-gated. */
  list(userId: number): Promise<WorkspaceRow[]>;
  /**
   * Create a workspace through the migration-068 cap function. `limit` is the
   * caller's grant (10 for Agency), never a client value. null ⇒ cap hit → 409.
   */
  create(
    userId: number,
    limit: number,
    input: { name: string; states: string[]; trades: string[] },
  ): Promise<number | null>;
  /** Rename an owned workspace; null when no row matched (→ 404). */
  rename(userId: number, id: number, name: string): Promise<number | null>;
  /** Replace an owned workspace's states/trades; null when no row matched (→ 404). */
  updateSettings(
    userId: number,
    id: number,
    states: string[],
    trades: string[],
  ): Promise<number | null>;
  /** Point `users.active_profile_id` at an owned workspace (null = back to account). */
  setActive(userId: number, id: number | null): Promise<boolean>;
  /** The active workspace's id, or null when the account context is active. */
  getActiveWorkspaceId(userId: number): Promise<number | null>;
}

/** A JSONB array column as a string[] — never a guess: only real strings survive. */
function textArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

export const neonWorkspaceStore: WorkspaceStore = {
  async list(userId) {
    const rows = (await sql()`
      SELECT w.id, w.name, w.profile_id, w.created_at, bp.locations, bp.service_categories
      FROM workspaces w
      LEFT JOIN business_profiles bp ON bp.id = w.profile_id
      WHERE w.user_id = ${userId}
      ORDER BY w.created_at, w.id
    `) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: Number(r.id),
      name: String(r.name ?? ""),
      profileId: r.profile_id === null || r.profile_id === undefined ? null : Number(r.profile_id),
      states: textArray(r.locations),
      trades: textArray(r.service_categories),
      created_at: r.created_at ? String(r.created_at) : null,
    }));
  },
  async create(userId, limit, input) {
    const rows = (await sql()`
      SELECT workspace_create(
        ${userId}, ${limit}, ${input.name},
        ${JSON.stringify(input.states)}::jsonb, ${JSON.stringify(input.trades)}::jsonb
      ) AS id
    `) as Array<{ id: number | null }>;
    const id = rows[0]?.id ?? null;
    return id === null ? null : Number(id);
  },
  async rename(userId, id, name) {
    const rows = (await sql()`
      UPDATE workspaces SET name = ${name}, updated_at = NOW()
      WHERE id = ${id} AND user_id = ${userId}
      RETURNING id
    `) as Array<{ id: number }>;
    return rows.length ? Number(rows[0]!.id) : null;
  },
  async updateSettings(userId, id, states, trades) {
    // The states/trades live on the linked business_profiles row — the same row the
    // Radar/dashboard feed already reads through users.active_profile_id, so there is
    // exactly ONE place a workspace's states and trades are stored.
    const rows = (await sql()`
      UPDATE business_profiles SET
        locations = ${JSON.stringify(states)}::jsonb,
        service_categories = ${JSON.stringify(trades)}::jsonb,
        updated_at = NOW()
      WHERE id = (SELECT profile_id FROM workspaces WHERE id = ${id} AND user_id = ${userId})
      RETURNING id
    `) as Array<{ id: number }>;
    if (!rows.length) return null;
    await sql()`
      UPDATE workspaces SET updated_at = NOW() WHERE id = ${id} AND user_id = ${userId}
    `;
    return Number(rows[0]!.id);
  },
  async setActive(userId, id) {
    if (id === null) {
      await sql()`UPDATE users SET active_profile_id = NULL WHERE id = ${userId}`;
      return true;
    }
    const rows = (await sql()`
      UPDATE users SET active_profile_id = (
        SELECT profile_id FROM workspaces WHERE id = ${id} AND user_id = ${userId}
      )
      WHERE id = ${userId}
        AND EXISTS (SELECT 1 FROM workspaces WHERE id = ${id} AND user_id = ${userId})
      RETURNING id
    `) as Array<{ id: number }>;
    return rows.length > 0;
  },
  async getActiveWorkspaceId(userId) {
    const rows = (await sql()`
      SELECT w.id
      FROM users u
      JOIN workspaces w ON w.profile_id = u.active_profile_id AND w.user_id = u.id
      WHERE u.id = ${userId}
      LIMIT 1
    `) as Array<{ id: number }>;
    return rows.length ? Number(rows[0]!.id) : null;
  },
};

/** The active workspace id for a user, or null. Fail-soft: a DB error reads "none". */
export async function resolveActiveWorkspaceId(
  userId: number,
  store: WorkspaceStore = neonWorkspaceStore,
): Promise<number | null> {
  try {
    return await store.getActiveWorkspaceId(userId);
  } catch (error) {
    // Never break a read because the workspace tables are unavailable (a PREVIEW
    // database without migration 068, for instance): an unscoped read is exactly
    // what every Starter/Professional account gets.
    console.error("[workspaces] active workspace lookup failed:", error);
    return null;
  }
}

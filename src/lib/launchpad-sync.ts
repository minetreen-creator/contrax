/**
 * Launchpad account sync (owner 2026-10-17). Pure and client-safe.
 *
 * Signed-in visitors keep one Launchpad workspace on their account so it
 * follows them to any device; this browser's copy stays as the offline/
 * signed-out fallback. When both exist, the most recently saved one wins.
 */
import { parseLaunchpad, type LaunchpadData } from "~/lib/launchpad";

/** Largest workspace the server stores (every field is capped at 4,000 chars). */
export const MAX_WORKSPACE_BYTES = 100_000;

export function hasLaunchpadContent(data: LaunchpadData): boolean {
  return (
    Object.values(data.profile).some((v) => v.trim() !== "") ||
    data.registrations.length > 0 ||
    data.registrationNotes.trim() !== "" ||
    [data.bid.title, data.bid.url, data.bid.decision, data.bid.notes, data.bid.action, data.bid.date].some((v) => v.trim() !== "")
  );
}

function savedAt(data: LaunchpadData): number {
  const t = Date.parse(data.updatedAt);
  return Number.isFinite(t) ? t : 0;
}

/**
 * Decide which copy to show after sign-in is known.
 *  - `use`: the workspace to load into the page.
 *  - `push`: true when this browser's copy is newer and should be saved to the account.
 */
export function pickLaunchpad(local: LaunchpadData, remote: LaunchpadData | null): { use: LaunchpadData; push: boolean } {
  const localHas = hasLaunchpadContent(local);
  if (!remote || !hasLaunchpadContent(remote)) return { use: local, push: localHas };
  if (!localHas) return { use: remote, push: false };
  return savedAt(local) > savedAt(remote) ? { use: local, push: true } : { use: remote, push: false };
}

/** Sanitize an untrusted workspace (same rules as reading browser storage). Null when unusable. */
export function sanitizeWorkspace(raw: unknown): LaunchpadData | null {
  if (!raw || typeof raw !== "object") return null;
  try {
    const json = JSON.stringify(raw);
    if (json.length > MAX_WORKSPACE_BYTES) return null;
    return parseLaunchpad(json);
  } catch {
    return null;
  }
}

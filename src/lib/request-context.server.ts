/**
 * Request-scoped SSR context — AsyncLocalStorage store (server-only).
 *
 * Replaces the per-request globalThis cookie/IP stash in vercel-entry.ts.
 * `contraxRequestStore.run` scopes the cookie/IP to the request's async
 * execution chain:
 *
 *   - Two concurrent requests never cross-talk (each keeps its own context),
 *     which the globalThis stash could not guarantee.
 *   - The context is removed automatically when the run() promise settles —
 *     on success AND on a thrown error — so a failed request can never leak
 *     its values into the next request (the stash pattern left the globals
 *     behind whenever the SSR fetch or the body stream threw).
 *
 * `.server.ts` suffix: this module is imported only by the Vercel launcher
 * (vercel-entry.ts) and tests — never by client-reachable code — so the
 * `node:async_hooks` import cannot leak into a client bundle. The client-safe
 * readers live in ./request-context.ts and resolve through the accessor wired
 * by the module side effect at the bottom of this file. The accessor lives on
 * globalThis (see request-context.ts) so the launcher's copy of this module
 * and the dist bundle's copy of the readers share one slot despite the bundler
 * inlining this module into two separate module graphs.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import {
  setRequestContextAccessor,
  type RequestContext,
} from "./request-context";

export const contraxRequestStore = new AsyncLocalStorage<RequestContext>();

/**
 * Runs `callback` inside the request-scoped store. The context is automatically
 * cleaned up when the returned promise settles, on success or on a thrown
 * error — the AsyncLocalStorage equivalent of "set at request start, cleaned
 * in a finally", with the cleanup guaranteed even when `callback` throws.
 */
export function runWithRequestContext<T>(
  context: RequestContext,
  callback: () => Promise<T>,
): Promise<T> {
  return contraxRequestStore.run(context, callback);
}

// Wire the server-side store into the client-safe readers once at boot. This
// side effect runs only where this module is imported (server bundle + tests);
// the client bundle never executes it, so client reads always hit the empty
// context fallback.
setRequestContextAccessor(() => contraxRequestStore.getStore());
/**
 * Request-scoped SSR context — client-safe facade.
 *
 * The Vercel launcher (vercel-entry.ts) needs to expose the raw Cookie header
 * and the client IP to route loaders and createServerFn handlers during SSR
 * (auth.ts reads the session cookie, score.tsx applies the anonymous free-score
 * IP limit). Historically this was stashed on `globalThis` per request, which
 * races under concurrent requests and leaks the previous request's values when
 * an SSR call throws before the delete runs.
 *
 * This module is the CLIENT-SAFE half of the replacement: it contains NO node
 * builtins, so route files (auth.ts, score.tsx) can import it from both the
 * SSR bundle and the client bundle. The AsyncLocalStorage itself lives in
 * `./request-context.server.ts` (server-only); the launcher imports that
 * module once at boot, which self-wires `contraxRequestStore` as the accessor
 * below. In the client bundle the accessor stays unset, so every read falls
 * back to the EMPTY context — exactly the behavior of the old
 * "globalThis absent outside the Vercel launcher" path (fail-open).
 */
export interface RequestContext {
  /** Raw Cookie header value ("" when the request had none). */
  cookie: string;
  /** Client IP ("" when unresolvable), same derivation as /api/event. */
  ip: string;
}

const EMPTY_REQUEST_CONTEXT: RequestContext = Object.freeze({
  cookie: "",
  ip: "",
});

type RequestContextAccessor = () => RequestContext | undefined;

let currentAccessor: RequestContextAccessor | undefined;

/**
 * Installed once at server boot by `request-context.server.ts` (its module
 * side effect). Never called from client code. Exposed for unit tests.
 */
export function setRequestContextAccessor(
  accessor: RequestContextAccessor | undefined,
): void {
  currentAccessor = accessor;
}

/**
 * Returns the current request's context. Outside a request — client bundle,
 * local serve.ts, an SSR error path, or before the store is wired — returns
 * the EMPTY context (""/""), never throwing.
 */
export function getRequestContext(): RequestContext {
  return currentAccessor?.() ?? EMPTY_REQUEST_CONTEXT;
}
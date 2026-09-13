/**
 * Request-scoped SSR context — client-safe facade.
 *
 * The accessor is stored in a GLOBAL registry (not a module-local variable):
 * the Vercel launcher (vercel-entry.ts) is bundled from SOURCE while the
 * TanStack SSR handler runs from dist/server/server.js, so this module can
 * exist TWICE in one process (once inline in the launcher bundle, once in the
 * dist chunks). A module-local accessor could therefore be set on one copy and
 * read from another. The global registry keyed by a fixed string makes both
 * copies share the same accessor slot.
 *
 * This module contains NO node builtins, so route files (auth.ts, score.tsx)
 * can import it from both the SSR bundle and the client bundle. The
 * AsyncLocalStorage store itself lives in ./request-context.server.ts
 * (server-only); the launcher imports that module once at boot, which self-wires
 * the store as the accessor below. In the client bundle the accessor stays
 * unset, so every read falls back to the EMPTY context — fail-open.
 */
export interface RequestContext {
  /** Raw Cookie header value ("" when the request had none). */
  cookie: string;
  /** Client IP ("" when unresolvable), same derivation as /api/event. */
  ip: string;
}

const EMPTY_REQUEST_CONTEXT: Readonly<RequestContext> = Object.freeze({
  cookie: "",
  ip: "",
});

type RequestContextAccessor = () => RequestContext | undefined;

const ACCESSOR_KEY = "__contrax_request_context_accessor_v1__";

type ContextGlobal = typeof globalThis & {
  [ACCESSOR_KEY]?: RequestContextAccessor;
};

/**
 * Installed once at server boot by request-context.server.ts (its module side
 * effect). Pass undefined to clear the registry slot (unit tests). Never called
 * from client code.
 */
export function setRequestContextAccessor(
  accessor: RequestContextAccessor | undefined,
): void {
  const registry = globalThis as ContextGlobal;
  if (accessor) registry[ACCESSOR_KEY] = accessor;
  else delete registry[ACCESSOR_KEY];
}

/**
 * Returns the current request's context. Outside a request — client bundle,
 * local serve.ts, an SSR error path, or before the store is wired — returns
 * the EMPTY context (""/""), never throwing.
 */
export function getRequestContext(): Readonly<RequestContext> {
  const registry = globalThis as ContextGlobal;
  return registry[ACCESSOR_KEY]?.() ?? EMPTY_REQUEST_CONTEXT;
}
// Production server for the built site. The TanStack Start build emits a portable
// fetch handler (dist/server/server.js) plus static client assets (dist/client);
// this wraps them in a Bun server on port 3000 — static files first, SSR for the
// rest. Run `bun run build` before starting. Restart it with `bun run publish`.
//
// Starting a new instance supersedes the old one: it frees the port no matter
// which user owns the current server (provisioning starts it as `engine`; a team
// member's `bun run publish` runs as their own user), so publish never collides
// with an already-running server. Every sandbox user has passwordless sudo, so
// the takeover works across user boundaries.
import handler from "./dist/server/server.js";

// Pinned, NOT read from the environment. The published preview URL
// (<label>.<PUBLIC_SITE_DOMAIN>) is reverse-proxied to 0.0.0.0:3000 inside the
// sandbox, so the default site MUST bind there. Bun auto-loads .env files, so
// honouring process.env.PORT/HOST would let a stray env var or a .env in the site
// dir silently move the site off :3000 (or onto loopback) and break the public URL.
const PORT = 3000;
const HOST = "0.0.0.0";
const CLIENT_DIR = `${import.meta.dir}/dist/client`;

// ── Stripe webhook handler ───────────────────────────────────────────────────

async function handleStripeWebhookRoute(req: Request): Promise<Response> {
  try {
    const signature = req.headers.get("stripe-signature");
    if (!signature) {
      return new Response(JSON.stringify({ error: "Missing signature" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const body = await req.text();

    // Dynamically import the handler so it resolves at runtime with env vars
    const { handleStripeWebhook } = await import("./src/lib/stripe.ts");
    const result = await handleStripeWebhook(body, signature);

    if (!result.success) {
      return new Response(JSON.stringify({ error: result.error }), {
        status: result.error === "Invalid signature" ? 400 : 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("stripe webhook error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

// ── Stripe checkout session handler ──────────────────────────────────────────

async function handleCreateCheckoutSession(req: Request): Promise<Response> {
  try {
    const { createCheckoutSession, resolveUserIdFromCookie } = await import(
      "./src/lib/stripe.ts"
    );
    const jsonHeaders = { "Content-Type": "application/json" };

    // SIGN-IN REQUIRED (owner order 2026-09-18): a checkout must never be
    // created without a resolvable user id. Identical to the canonical route
    // src/routes/api/stripe/create-checkout-session.ts and to
    // handleGrantsBilling below.
    const userId = await resolveUserIdFromCookie(req.headers.get("cookie"));
    if (userId == null) {
      return new Response(
        JSON.stringify({ error: "Sign in to choose a Contrax plan." }),
        { status: 401, headers: jsonHeaders },
      );
    }

    const body = (await req.json().catch(() => ({}))) as {
      planTier?: string;
      mode?: "payment" | "subscription";
      promoCode?: string;
    };

    const validTiers = ["starter", "professional", "agency", "savings_premium"];
    if (!body.planTier || !validTiers.includes(body.planTier)) {
      return new Response(
        JSON.stringify({
          error: `Invalid planTier. Must be one of: ${validTiers.join(", ")}`,
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
    if (body.mode && !["payment", "subscription"].includes(body.mode)) {
      return new Response(
        JSON.stringify({ error: `Invalid mode. Must be "payment" or "subscription"` }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const normalized = (body.promoCode ?? "").trim().toLowerCase();
    const promoCode = normalized === "vad26" ? "VAD26" : undefined;
    const result = await createCheckoutSession(body.planTier as any, {
      userId,
      mode: body.mode ?? "subscription",
      ...(promoCode ? { promoCode } : {}),
    });

    if (!result.success) {
      return new Response(JSON.stringify({ error: result.error }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ url: result.url }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("create-checkout-session error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

// ── Bid Scout checkout handler ───────────────────────────────────────────────

async function handleBidScoutCheckout(req: Request): Promise<Response> {
  try {
    const body = (await req.json().catch(() => null)) as unknown;

    // Dynamically import so env vars resolve at runtime
    const { bidScoutCheckoutSchema, normalizeBidScoutInput, createBidScoutCheckoutSession } =
      await import("./src/lib/bid-scout.ts");
    const { resolveUserIdFromCookie } = await import("./src/lib/stripe.ts");
    const { checkEmailLimit, checkIpLimit, rateLimitedResponse } = await import(
      "./src/lib/rate-limit.ts"
    );
    const { isBlockedIp } = await import("./src/lib/request-ip.ts");

    if (isBlockedIp(req)) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }

    const parsed = bidScoutCheckoutSchema.safeParse(body ?? {});
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const message = first
        ? `${first.path.join(".") || "field"}: ${first.message}`
        : "Invalid submission";
      return new Response(
        JSON.stringify({ error: `Please check your details — ${message}` }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }
    const input = normalizeBidScoutInput(parsed.data);

    const ipLimit = await checkIpLimit(req, "bid_scout_checkout_ip", 10, 60 * 60);
    if (!ipLimit.allowed) {
      const r = rateLimitedResponse(ipLimit);
      return new Response(await r.text(), { status: r.status, headers: Object.fromEntries(r.headers) });
    }
    const acctLimit = await checkEmailLimit(input.email, "bid_scout_checkout_email", 5, 60 * 60);
    if (!acctLimit.allowed) {
      const r = rateLimitedResponse(acctLimit);
      return new Response(await r.text(), { status: r.status, headers: Object.fromEntries(r.headers) });
    }

    const userId = await resolveUserIdFromCookie(req.headers.get("cookie"));
    const result = await createBidScoutCheckoutSession(input, { userId });

    if (!result.success) {
      return new Response(
        JSON.stringify({ error: result.error ?? "Internal server error" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response(JSON.stringify({ url: result.url }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("bid-scout checkout error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

// ── Contrax Grants billing handlers (lockstep with the canonical routes) ─────
//
// Mirrors /api/stripe/create-checkout-session above: these exist for code-level
// parity with src/routes/api/stripe/grants-{checkout,portal}-session.ts and
// delegate to the same lib functions in src/lib/grants-subscription.server.ts.
// Both require a signed-in user (401 otherwise) and take no input.

async function handleGrantsBilling(
  req: Request,
  kind: "checkout" | "portal",
): Promise<Response> {
  try {
    const { resolveUserIdFromCookie } = await import("./src/lib/stripe.ts");
    const { createGrantsCheckoutSession, createGrantsPortalSession, getGrantsSubscription } =
      await import("./src/lib/grants-subscription.server.ts");
    const jsonHeaders = { "Content-Type": "application/json" };

    const userId = await resolveUserIdFromCookie(req.headers.get("cookie"));
    if (userId == null) {
      return new Response(
        JSON.stringify({ error: "Sign in to subscribe to Contrax Grants." }),
        { status: 401, headers: jsonHeaders },
      );
    }

    if (kind === "portal") {
      const subscription = await getGrantsSubscription(userId);
      if (!subscription.stripeCustomerId) {
        return new Response(
          JSON.stringify({ error: "No Contrax Grants subscription found for your account." }),
          { status: 403, headers: jsonHeaders },
        );
      }
    }

    const result =
      kind === "checkout"
        ? await createGrantsCheckoutSession(userId)
        : await createGrantsPortalSession(userId);
    if (!result.success || !result.url) {
      return new Response(
        JSON.stringify({ error: result.error ?? "Internal server error" }),
        { status: 500, headers: jsonHeaders },
      );
    }
    return new Response(JSON.stringify({ url: result.url }), {
      status: 200,
      headers: jsonHeaders,
    });
  } catch (err) {
    console.error(`grants-${kind}-session error:`, err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

// ── Plan-tier billing handler (lockstep with the canonical route) ─────────────
//
// Mirrors /api/stripe/create-checkout-session and the Grants handlers above:
// this exists for code-level parity with
// src/routes/api/stripe/portal-session.ts (the "Manage subscription" button on
// Settings) and delegates to the same lib functions in
// src/lib/tier-subscription.server.ts. Sign-in required (401 otherwise).

async function handleTierPortalSession(req: Request): Promise<Response> {
  const jsonHeaders = { "Content-Type": "application/json" };
  try {
    const { resolveUserIdFromCookie } = await import("./src/lib/stripe.ts");
    const { createTierPortalSession, getTierBilling } = await import(
      "./src/lib/tier-subscription.server.ts"
    );

    const userId = await resolveUserIdFromCookie(req.headers.get("cookie"));
    if (userId == null) {
      return new Response(
        JSON.stringify({ error: "Sign in to manage your subscription." }),
        { status: 401, headers: jsonHeaders },
      );
    }

    const billing = await getTierBilling(userId);
    if (!billing.stripeCustomerId) {
      return new Response(
        JSON.stringify({ error: "No paid Contrax subscription found for your account." }),
        { status: 403, headers: jsonHeaders },
      );
    }

    const result = await createTierPortalSession(userId);
    if (!result.success || !result.url) {
      return new Response(
        JSON.stringify({ error: result.error ?? "Internal server error" }),
        {
          status: result.code === "portal_not_configured" ? 503 : 500,
          headers: jsonHeaders,
        },
      );
    }
    return new Response(JSON.stringify({ url: result.url }), {
      status: 200,
      headers: jsonHeaders,
    });
  } catch (err) {
    console.error("portal-session error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: jsonHeaders,
    });
  }
}

// ── Analytics handler (lightweight, no framework dependency) ──────────────────

async function handleAnalytics(req: Request): Promise<Response> {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      path?: string;
      referrer?: string;
    };
    const path = (body.path ?? "/").slice(0, 2048);
    const referrer = (body.referrer ?? "").slice(0, 2048) || null;
    const userAgent =
      (req.headers.get("user-agent") ?? "").slice(0, 512) || null;

    // Use the same neon DB as the app
    const { neon } = await import("@neondatabase/serverless");
    const url = process.env.DATABASE_URL;
    if (url) {
      const db = neon(url);
      await db`
        INSERT INTO analytics_events (path, referrer, user_agent)
        VALUES (${path}, ${referrer}, ${userAgent})
      `;
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("analytics error:", err);
    return new Response(JSON.stringify({ ok: false }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

// ── Main fetch handler ───────────────────────────────────────────────────────

async function mainFetch(req: Request): Promise<Response> {
  const { pathname, searchParams } = new URL(req.url);

  // Stripe checkout session — handle before SSR
  if (pathname === "/api/stripe/create-checkout-session" && req.method === "POST") {
    return handleCreateCheckoutSession(req);
  }

  // Bid Scout checkout — handle before SSR (JSON body; same guardrails as the
  // canonical TanStack route src/routes/api/bid-scout/checkout.ts, kept in
  // lockstep and delegating to the same lib function)
  if (pathname === "/api/bid-scout/checkout" && req.method === "POST") {
    return handleBidScoutCheckout(req);
  }

  // Contrax Grants billing — handle before SSR (same guardrails as the
  // canonical TanStack routes, which also serve these paths in production)
  if (pathname === "/api/stripe/grants-checkout-session" && req.method === "POST") {
    return handleGrantsBilling(req, "checkout");
  }
  if (pathname === "/api/stripe/grants-portal-session" && req.method === "POST") {
    return handleGrantsBilling(req, "portal");
  }

  // Plan-tier billing portal (Starter/Professional/Agency) — handle before SSR
  // (same guardrails as the canonical TanStack route, which also serves this
  // path in production)
  if (pathname === "/api/stripe/portal-session" && req.method === "POST") {
    return handleTierPortalSession(req);
  }

  // Stripe webhook — needs raw body, handle before SSR
  if (pathname === "/api/stripe/webhook" && req.method === "POST") {
    return handleStripeWebhookRoute(req);
  }

  // Analytics endpoint — handle before SSR
  if (pathname === "/api/analytics" && req.method === "POST") {
    return handleAnalytics(req);
  }


  // Static assets
  if (pathname !== "/") {
    const file = Bun.file(CLIENT_DIR + pathname);
    if (await file.exists()) return new Response(file);
  }

  // SSR
  return (
    handler as { fetch: (r: Request) => Response | Promise<Response> }
  ).fetch(req);
}

// ── Port management + startup ────────────────────────────────────────────────

// Free PORT regardless of which user owns the current listener. lsof runs under
// sudo so it can see (and the kill can signal) a process owned by another user;
// the loop waits for the socket to actually release before we bind.
const freePort =
  `for _ in $(seq 1 25); do ` +
  `pids=$(lsof -t -iTCP:${String(PORT)} -sTCP:LISTEN 2>/dev/null || true); ` +
  `if [ -z "$pids" ]; then exit 0; fi; ` +
  `kill $pids 2>/dev/null || true; sleep 0.2; ` +
  `done`;

// Take over the port, re-freeing and retrying if another publish grabbed it in the
// gap between freeing and binding (last publish wins). Bun.serve throws EADDRINUSE
// synchronously, so without this a raced publish would die while the shell already
// reported success.
for (let attempt = 1; ; attempt++) {
  await Bun.$`sudo sh -c ${freePort}`.quiet().nothrow();
  try {
    Bun.serve({
      port: PORT,
      hostname: HOST,
      fetch: mainFetch,
      idleTimeout: 120, // keep connections alive for long-running Stripe webhook/checkout requests
    });
    break;
  } catch (err) {
    if (attempt >= 10) throw err;
    await Bun.sleep(200);
  }
}

console.log(`team-site serving on http://${HOST}:${String(PORT)}`);

// Warn if Stripe env vars are missing (non-fatal)
if (!process.env.STRIPE_SECRET_KEY) {
  console.warn("⚠ STRIPE_SECRET_KEY is not set — Stripe webhooks will fail");
}
if (!process.env.STRIPE_WEBHOOK_SECRET) {
  console.warn("⚠ STRIPE_WEBHOOK_SECRET is not set — webhook signature verification will fail");
}

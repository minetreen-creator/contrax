import { describe, expect, test } from "bun:test";
import {
  authorizeUrl,
  decryptToken,
  encryptToken,
  exchangeCode,
  fetchBusinessProfile,
  needsRefresh,
  refreshTokens,
  signState,
  thumbtackConfig,
  verifyState,
} from "./thumbtack.server";

const ENV = { THUMBTACK_CLIENT_ID: "client-1", THUMBTACK_CLIENT_SECRET: "secret-1", THUMBTACK_SCOPES: "supply::businesses.list" };
const cfg = thumbtackConfig(ENV)!;
const KEY_ENV = { TOKEN_ENCRYPTION_KEY: "k".repeat(40) };

describe("Connect with Thumbtack (owner 2026-10-22)", () => {
  test("off until credentials exist; staging by default, production on request", () => {
    expect(thumbtackConfig({})).toBeNull();
    expect(cfg.authBase).toBe("https://staging-auth.thumbtack.com");
    expect(cfg.apiBase).toBe("https://staging-api.thumbtack.com");
    expect(cfg.redirectUri).toBe("https://www.contrax.company/auth/thumbtack/callback");
    const prod = thumbtackConfig({ ...ENV, THUMBTACK_ENV: "production" })!;
    expect(prod.authBase).toBe("https://auth.thumbtack.com");
  });

  test("the consent URL carries client, redirect, scopes and state", () => {
    const u = new URL(authorizeUrl(cfg, "STATE"));
    expect(u.origin + u.pathname).toBe("https://staging-auth.thumbtack.com/oauth2/auth");
    expect(u.searchParams.get("client_id")).toBe("client-1");
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("redirect_uri")).toBe(cfg.redirectUri);
    expect(u.searchParams.get("scope")).toBe("supply::businesses.list");
    expect(u.searchParams.get("state")).toBe("STATE");
    expect(u.searchParams.get("audience")).toBe("urn:partner-api");
  });

  test("without THUMBTACK_SCOPES, asks only for the read-only scopes", () => {
    const { THUMBTACK_SCOPES: _drop, ...rest } = ENV as Record<string, string | undefined>;
    const scopes = thumbtackConfig(rest)!.scopes.split(" ");
    expect(scopes).toEqual(["offline_access", "supply::businesses.list", "supply::businesses/profile.read", "supply::users.read"]);
    expect(scopes.some((sc) => /write|messages|negotiations/.test(sc))).toBe(false);
  });

  test("state: only the signed, unexpired value with the matching nonce cookie names a user", () => {
    const now = Date.parse("2026-10-22T23:00:00Z");
    const state = signState(cfg, 42, "nonce-a", now);
    expect(verifyState(cfg, state, "nonce-a", now + 60_000)).toBe(42);
    expect(verifyState(cfg, state, "nonce-b", now)).toBeNull(); // another browser's callback
    expect(verifyState(cfg, state, null, now)).toBeNull();
    expect(verifyState(cfg, state, "nonce-a", now + 11 * 60_000)).toBeNull(); // expired
    expect(verifyState(cfg, state.replace(/^42\./, "43."), "nonce-a", now)).toBeNull(); // tampered user
    expect(verifyState(thumbtackConfig({ ...ENV, THUMBTACK_CLIENT_SECRET: "other" })!, state, "nonce-a", now)).toBeNull();
    expect(verifyState(cfg, "garbage", "nonce-a", now)).toBeNull();
  });

  test("tokens are encrypted at rest and tampering is detected", () => {
    const sealed = encryptToken("access-token-xyz", KEY_ENV);
    expect(sealed).not.toContain("access-token-xyz");
    expect(decryptToken(sealed, KEY_ENV)).toBe("access-token-xyz");
    const parts = sealed.split(".");
    parts[3] = parts[3]!.slice(0, -2) + (parts[3]!.endsWith("A") ? "BB" : "AA");
    expect(() => decryptToken(parts.join("."), KEY_ENV)).toThrow();
    expect(() => encryptToken("x", { TOKEN_ENCRYPTION_KEY: "short" })).toThrow("TOKEN_ENCRYPTION_KEY");
  });

  test("the code exchange uses HTTP Basic client auth and the registered redirect", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const fakeFetch = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(JSON.stringify({ access_token: "at", refresh_token: "rt", expires_in: 3600 }), { status: 200 });
    }) as unknown as typeof fetch;
    const t = await exchangeCode(cfg, "the-code", fakeFetch);
    expect(t.access_token).toBe("at");
    expect(seen!.url).toBe("https://staging-auth.thumbtack.com/oauth2/token");
    expect((seen!.init.headers as Record<string, string>).Authorization).toBe(
      `Basic ${Buffer.from("client-1:secret-1").toString("base64")}`,
    );
    const body = new URLSearchParams(String(seen!.init.body));
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("the-code");
    expect(body.get("redirect_uri")).toBe(cfg.redirectUri);

    const failing = (async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 })) as unknown as typeof fetch;
    await expect(exchangeCode(cfg, "bad", failing)).rejects.toThrow("invalid_grant");
  });

  test("a failed profile read never breaks the connection", async () => {
    const down = (async () => new Response("nope", { status: 503 })) as unknown as typeof fetch;
    expect(await fetchBusinessProfile(cfg, "at", down)).toBeNull();
    const ok = (async () => new Response(JSON.stringify({ data: [{ businessID: "b1" }] }), { status: 200 })) as unknown as typeof fetch;
    expect(await fetchBusinessProfile(cfg, "at", ok)).toEqual({ data: [{ businessID: "b1" }] });
  });
});

describe("automatic token refresh", () => {
  const now = Date.parse("2026-10-23T21:00:00Z");
  test("renews only when the access token has expired or is about to", () => {
    expect(needsRefresh(null, now)).toBe(false);
    expect(needsRefresh(new Date(now + 60 * 60_000), now)).toBe(false);
    expect(needsRefresh(new Date(now + 60_000), now)).toBe(true); // inside the 2-minute margin
    expect(needsRefresh(new Date(now - 1), now)).toBe(true);
    expect(needsRefresh("2026-10-23T20:00:00Z", now)).toBe(true);
    expect(needsRefresh("not a date", now)).toBe(false);
  });

  test("the refresh request sends the refresh token with client Basic auth", async () => {
    const cfg = thumbtackConfig({ THUMBTACK_CLIENT_ID: "client-1", THUMBTACK_CLIENT_SECRET: "secret-1" })!;
    let seen: { url: string; init: RequestInit } | null = null;
    const fake = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(JSON.stringify({ access_token: "new-at", refresh_token: "new-rt", expires_in: 3600 }), { status: 200 });
    }) as unknown as typeof fetch;
    const t = await refreshTokens(cfg, "old-rt", fake);
    expect(t.access_token).toBe("new-at");
    expect(seen!.url).toBe("https://staging-auth.thumbtack.com/oauth2/token");
    const body = new URLSearchParams(String(seen!.init.body));
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("old-rt");
    expect((seen!.init.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from("client-1:secret-1").toString("base64")}`);
  });
});

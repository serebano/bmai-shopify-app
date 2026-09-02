import { describe, expect, it, vi } from "vitest";
import { createTokenProvider, BmaiCredentialError, type StoredRefresh, type TokenStore } from "../app/lib/bmaiToken";

// The durable provisioning credential: a rotating OAuth refresh token minted into a
// short-lived access token, cached until near-expiry, with each rotation persisted.

function memStore(initial: StoredRefresh | null = null): TokenStore & { value: StoredRefresh | null } {
  let value = initial;
  return {
    get value() { return value; },
    load: async () => value,
    save: async (v) => { value = v; },
  };
}

function tokenResponse(access: string, refresh: string, expires_in = 3600) {
  return { ok: true, status: 200, json: async () => ({ access_token: access, refresh_token: refresh, expires_in, token_type: "Bearer" }) } as unknown as Response;
}

describe("bmai durable token provider", () => {
  it("mints via refresh_token grant, caches until near expiry, then re-refreshes", async () => {
    let t = 1_000_000;
    const now = () => t;
    const fetchImpl = vi.fn(async () => tokenResponse("access-1", "refresh-2", 3600));
    const p = createTokenProvider({
      mcpUrl: "https://busymate.ai/mcp",
      seedClientId: "cid", seedRefreshToken: "refresh-1",
      fetchImpl: fetchImpl as unknown as typeof fetch, now, skewSeconds: 120,
    });
    expect(await p.getAccessToken()).toBe("access-1");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    // within TTL - skew: served from cache (no new fetch)
    t += 3000 * 1000; // +3000s < 3600-120
    expect(await p.getAccessToken()).toBe("access-1");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    // past the skew window: re-refresh
    t += 500 * 1000;
    await p.getAccessToken();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    // the token endpoint + grant were correct
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://busymate.ai/mcp/token");
    expect(String(init.body)).toContain("grant_type=refresh_token");
    expect(String(init.body)).toContain("refresh_token=refresh-1");
  });

  it("PERSISTS the rotated refresh token to the store (store wins over the seed)", async () => {
    const store = memStore(null);
    let calls = 0;
    const fetchImpl = vi.fn(async () => { calls++; return tokenResponse(`access-${calls}`, `refresh-next-${calls}`, 3600); });
    let t = 0;
    const p = createTokenProvider({
      mcpUrl: "https://busymate.ai/mcp/",
      seedClientId: "cid", seedRefreshToken: "refresh-seed",
      store, fetchImpl: fetchImpl as unknown as typeof fetch, now: () => t, skewSeconds: 0,
    });
    await p.getAccessToken();
    expect(store.value).toEqual({ clientId: "cid", refreshToken: "refresh-next-1" });
    // next refresh uses the STORED (rotated) token, not the seed
    t += 4000 * 1000;
    await p.getAccessToken();
    const [, init2] = fetchImpl.mock.calls[1] as unknown as [string, RequestInit];
    expect(String(init2.body)).toContain("refresh_token=refresh-next-1");
  });

  it("a populated store OVERRIDES a stale env seed", async () => {
    const store = memStore({ clientId: "cid", refreshToken: "stored-rt" });
    const fetchImpl = vi.fn(async () => tokenResponse("a", "b"));
    const p = createTokenProvider({
      mcpUrl: "https://busymate.ai/mcp",
      seedClientId: "cid", seedRefreshToken: "stale-seed-rt",
      store, fetchImpl: fetchImpl as unknown as typeof fetch, now: () => 0,
    });
    await p.getAccessToken();
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(init.body)).toContain("refresh_token=stored-rt");
  });

  it("falls back to a static bootstrap token when no refresh creds are set", async () => {
    const fetchImpl = vi.fn();
    const p = createTokenProvider({
      mcpUrl: "https://busymate.ai/mcp", staticToken: "boot-token",
      fetchImpl: fetchImpl as unknown as typeof fetch, now: () => 0,
    });
    expect(await p.getAccessToken()).toBe("boot-token");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("throws a clear re-authorize error when the refresh chain is revoked", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ error: "invalid_grant", error_description: "refresh token already used (rotated) — chain revoked" }) }) as unknown as Response);
    const p = createTokenProvider({
      mcpUrl: "https://busymate.ai/mcp", seedClientId: "cid", seedRefreshToken: "revoked",
      fetchImpl: fetchImpl as unknown as typeof fetch, now: () => 0,
    });
    await expect(p.getAccessToken()).rejects.toBeInstanceOf(BmaiCredentialError);
  });

  it("throws when NO credential of any kind is configured", async () => {
    const p = createTokenProvider({ mcpUrl: "https://busymate.ai/mcp", now: () => 0 });
    await expect(p.getAccessToken()).rejects.toBeInstanceOf(BmaiCredentialError);
  });
});

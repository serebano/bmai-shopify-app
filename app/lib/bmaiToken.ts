/**
 * The app's DURABLE bmai provisioning credential.
 *
 * The Busymate AI MCP surface (busymate.ai/mcp) authenticates every `tools/call` with a
 * short-lived (1h) OAuth 2.1 access token. A headless server cannot re-run the
 * browser consent every hour, so the durable credential is an OAuth REFRESH TOKEN
 * (rotating) obtained ONCE via the DCR + PKCE authorization-code flow. This provider
 * mints a fresh access token from that refresh token, caches it until just before
 * expiry, and PERSISTS each rotated refresh token (the edge rotates on every
 * refresh — the previous one is revoked) so a restart survives.
 *
 * Env (set on the app host, value-blind):
 *   BMAI_MGMT_CLIENT_ID           — the DCR client_id the refresh token belongs to
 *   BMAI_MGMT_REFRESH_TOKEN       — the SEED refresh token (used once, then the
 *                                   rotated value is read from the store)
 *   BMAI_MGMT_TOKEN               — OPTIONAL static access token (bootstrap/testing);
 *                                   used only when no refresh credential is set
 *
 * A `TokenStore` (Prisma-backed in prod) persists the rotating refresh token; the
 * store ALWAYS wins over the env seed once populated, so the (now-stale) seed is a
 * one-time bootstrap. Secrets are value-blind: never logged or returned.
 *
 */

export interface StoredRefresh {
  clientId: string;
  refreshToken: string;
}

/** Durable store for the rotating refresh token (Prisma in prod; memory in tests). */
export interface TokenStore {
  load: () => Promise<StoredRefresh | null>;
  save: (v: StoredRefresh) => Promise<void>;
}

export interface TokenProviderDeps {
  /** The MCP base URL (OAuth /token lives at `${mcpUrl}/token`). */
  mcpUrl: string;
  /** OPTIONAL static access token — bootstrap only, when no refresh creds are set. */
  staticToken?: string;
  /** Seed refresh credential from env (used until the store is populated). */
  seedClientId?: string;
  seedRefreshToken?: string;
  /** Durable rotation store. */
  store?: TokenStore;
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** Seconds of head-room before expiry to pre-refresh (default 120). */
  skewSeconds?: number;
}

export interface TokenProvider {
  /** Return a valid OAuth access token, minting/refreshing as needed. */
  getAccessToken: () => Promise<string>;
  /** Drop the cached access token (call on a 401 to force a re-mint). */
  invalidate: () => void;
}

export class BmaiCredentialError extends Error {}

const tokenEndpoint = (mcpUrl: string) => `${mcpUrl.replace(/\/+$/, "")}/token`;

export function createTokenProvider(deps: TokenProviderDeps): TokenProvider {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? Date.now;
  const skewMs = (deps.skewSeconds ?? 120) * 1000;

  let cached: { token: string; expMs: number } | null = null;
  // In-memory copy of the current refresh credential (seed until the store loads).
  let current: StoredRefresh | null =
    deps.seedClientId && deps.seedRefreshToken
      ? { clientId: deps.seedClientId, refreshToken: deps.seedRefreshToken }
      : null;
  let loadedFromStore = false;

  async function ensureLoaded(): Promise<void> {
    if (loadedFromStore || !deps.store) return;
    loadedFromStore = true;
    const stored = await deps.store.load().catch(() => null);
    if (stored?.clientId && stored?.refreshToken) current = stored; // store WINS over the seed
  }

  async function refresh(): Promise<string> {
    if (!current) {
      throw new BmaiCredentialError(
        "no Busymate AI refresh credential configured",
      );
    }
    const res = await fetchImpl(tokenEndpoint(deps.mcpUrl), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: current.refreshToken,
        client_id: current.clientId,
      }).toString(),
    });
    const json = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    };
    if (!res.ok || !json.access_token) {
      throw new BmaiCredentialError(
        `refresh_token grant failed (${res.status} ${json.error ?? ""}${
          json.error_description ? ": " + json.error_description : ""
        }) — re-authorize the app (DCR + PKCE) and reseed the Busymate AI refresh token`,
      );
    }
    // Persist the ROTATED refresh token BEFORE returning (the old one is now revoked).
    if (json.refresh_token && json.refresh_token !== current.refreshToken) {
      current = { clientId: current.clientId, refreshToken: json.refresh_token };
      if (deps.store) await deps.store.save(current).catch(() => {});
    }
    const ttlMs = (json.expires_in ?? 3600) * 1000;
    cached = { token: json.access_token, expMs: now() + ttlMs };
    return json.access_token;
  }

  return {
    invalidate() {
      cached = null;
    },
    async getAccessToken() {
      if (cached && cached.expMs - skewMs > now()) return cached.token;
      await ensureLoaded();
      if (current) return refresh();
      if (deps.staticToken) return deps.staticToken; // bootstrap/testing fallback
      throw new BmaiCredentialError(
        "no Busymate AI credential configured (refresh credential or bootstrap token required)",
      );
    },
  };
}

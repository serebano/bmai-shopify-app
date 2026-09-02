import { SignJWT, exportJWK, importPKCS8, jwtVerify, type JWK } from "jose";

/**
 * Identified launch — mint a short-lived ES256 JWT whose subject is the Shopify
 * customer id. The storefront widget's getIdentity fetches this; the SDK does the
 * URL-fragment handoff. The bmai tenant is registered with this app's JWKS as its
 * visitor identity provider, so Busymate AI scopes order reads to the JWT subject.
 *
 * THE CLAIM CONTRACT (#2132 FAIL A). Busymate AI's `support-launch` selects the
 * tenant's identity provider by the token's `iss` and then requires
 * exp/iat/sub/jti/nonce + the tenant claim (`shop`) + the subject claim (`sub`).
 * A token WITHOUT `iss` is rejected before any provider lookup
 * (`unparseable_issuer` → 401 → anonymous fallback), so every shopper stayed
 * anonymous and the order tools were never offered. The issuer is this app's
 * ORIGIN (SHOPIFY_APP_URL) — the same value provisioning registers as the
 * provider's `issuer`, so the two can never drift.
 *
 * The PRIVATE key lives only in LAUNCH_SIGNING_KEY (secret). Never in the DB, never
 * shipped to the browser.
 *
 */
const KID = process.env.LAUNCH_KEY_ID || "bmai-shopify-launch-1";
const TTL_SECONDS = 120;

/** The `aud` every launch token carries and the registered provider accepts. */
export const LAUNCH_AUDIENCE = "bmai-support-launch";
/** The `shop` claim binds the token to ONE store (the provider's tenant claim). */
export const LAUNCH_TENANT_CLAIM = "shop";

let cachedKey: Awaited<ReturnType<typeof importPKCS8>> | null = null;

async function signingKey() {
  if (cachedKey) return cachedKey;
  const pem = (process.env.LAUNCH_SIGNING_KEY || "").replace(/\\n/g, "\n");
  if (!pem) throw new Error("LAUNCH_SIGNING_KEY not set (owner-gated)");
  cachedKey = await importPKCS8(pem, "ES256");
  return cachedKey;
}

/** The launch-token issuer = this app's public origin (never a path, never a port-less guess). */
export function launchIssuer(): string {
  try {
    return new URL(process.env.SHOPIFY_APP_URL || "https://store.busymate.ai").origin;
  } catch {
    return "https://store.busymate.ai";
  }
}

/** Public JWKS URL the provider verifies against (served by /.well-known/jwks.json). */
export function launchJwksUri(): string {
  return `${launchIssuer()}/.well-known/jwks.json`;
}

/** The one-time mint endpoint the widget calls (App Proxy → POST /identity). */
export function launchIdentityEndpoint(): string {
  return `${launchIssuer()}/identity`;
}

export interface LaunchClaims {
  sub: string; // Shopify customer id
  shop: string;
}

export interface LaunchIdentity {
  token: string;
  nonce: string;
}

export async function mintLaunchIdentity(claims: LaunchClaims): Promise<LaunchIdentity> {
  const key = await signingKey();
  const nonce = crypto.randomUUID();
  const token = await new SignJWT({ [LAUNCH_TENANT_CLAIM]: claims.shop, nonce })
    .setProtectedHeader({ alg: "ES256", kid: KID })
    .setIssuer(launchIssuer())
    .setSubject(claims.sub)
    .setJti(crypto.randomUUID())
    .setIssuedAt()
    .setExpirationTime(`${TTL_SECONDS}s`)
    .setAudience(LAUNCH_AUDIENCE)
    .sign(key);
  return { token, nonce };
}

export async function verifyLaunchToken(token: string): Promise<(LaunchClaims & { nonce: string }) | null> {
  const key = await signingKey();
  const { payload } = await jwtVerify(token, key, { audience: LAUNCH_AUDIENCE, issuer: launchIssuer() });
  if (!payload.sub || typeof payload.shop !== "string") return null;
  return { sub: payload.sub, shop: payload.shop, nonce: String(payload.nonce ?? "") };
}

/**
 * True once the ES256 launch signing key is configured (identified launch can
 * mint + JWKS can publish). A cheap, secret-free env readiness probe — it never
 * reveals the key, only whether one is present.
 */
export function launchIdentityConfigured(): boolean {
  return (process.env.LAUNCH_SIGNING_KEY || "").includes("PRIVATE KEY");
}

/**
 * What provisioning registers as the tenant's visitor identity provider
 * (`upsert_tenant_identity_provider`): the public verification metadata of the
 * tokens THIS host mints. null when no signing key is configured — the host could
 * not mint a token, so registering a provider would be a green-while-dead claim.
 */
export interface LaunchIdentityRegistration {
  issuer: string;
  jwksUri: string;
  identityEndpointUrl: string;
  audience: string;
  tenantClaim: string;
  maxTokenAgeSeconds: number;
}

export function launchIdentityRegistration(): LaunchIdentityRegistration | null {
  if (!launchIdentityConfigured()) return null;
  return {
    issuer: launchIssuer(),
    jwksUri: launchJwksUri(),
    identityEndpointUrl: launchIdentityEndpoint(),
    audience: LAUNCH_AUDIENCE,
    tenantClaim: LAUNCH_TENANT_CLAIM,
    maxTokenAgeSeconds: TTL_SECONDS,
  };
}

/** Public JWKS served at /.well-known/jwks.json. */
export async function publicJwks(): Promise<{ keys: JWK[] }> {
  try {
    const key = await signingKey();
    const jwk = await exportJWK(key);
    // exportJWK on a private key includes `d`; publish only public members.
    const { d: _d, ...pub } = jwk as JWK & { d?: string };
    return { keys: [{ ...pub, kid: KID, alg: "ES256", use: "sig" }] };
  } catch {
    return { keys: [] };
  }
}

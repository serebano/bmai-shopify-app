import { SignJWT, exportJWK, importPKCS8, jwtVerify, type JWK } from "jose";

/**
 * Identified launch — mint a short-lived ES256 JWT whose subject is the Shopify
 * customer id. The storefront widget's getIdentity fetches this; the SDK does the
 * URL-fragment handoff. The bmai tenant is registered with this app's JWKS as its
 * visitor identity provider, so Busymate AI scopes order reads to the JWT subject.
 *
 * The PRIVATE key lives only in LAUNCH_SIGNING_KEY (secret). Never in the DB, never
 * shipped to the browser.
 *
 */
const KID = process.env.LAUNCH_KEY_ID || "bmai-shopify-launch-1";
const TTL_SECONDS = 120;

let cachedKey: Awaited<ReturnType<typeof importPKCS8>> | null = null;

async function signingKey() {
  if (cachedKey) return cachedKey;
  const pem = (process.env.LAUNCH_SIGNING_KEY || "").replace(/\\n/g, "\n");
  if (!pem) throw new Error("LAUNCH_SIGNING_KEY not set (owner-gated)");
  cachedKey = await importPKCS8(pem, "ES256");
  return cachedKey;
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
  const token = await new SignJWT({ shop: claims.shop, nonce })
    .setProtectedHeader({ alg: "ES256", kid: KID })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(`${TTL_SECONDS}s`)
    .setAudience("bmai-support-launch")
    .sign(key);
  return { token, nonce };
}

export async function verifyLaunchToken(token: string): Promise<(LaunchClaims & { nonce: string }) | null> {
  const key = await signingKey();
  const { payload } = await jwtVerify(token, key, { audience: "bmai-support-launch" });
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

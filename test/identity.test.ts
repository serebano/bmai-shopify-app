import { createLocalJWKSet, decodeJwt, exportPKCS8, generateKeyPair, jwtVerify } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The launch-JWT claim contract (#2132 FAIL A). Busymate AI's support-launch
 * selects the tenant's identity provider by `iss` and then requires
 * exp/iat/sub/jti/nonce + the `shop` (tenant) claim + `sub`. The pre-fix token
 * had NO `iss` and NO `jti`, so every signed-in shopper was rejected as
 * `unparseable_issuer` and silently fell back to anonymous — the order tools
 * could never be offered. This pins every required claim AND that the token
 * verifies against the JWKS this app publishes, for the issuer provisioning
 * registers (the SAME `launchIssuer()` value — no drift possible).
 */
async function freshIdentity() {
  vi.resetModules();
  return import("../app/lib/identity");
}

describe("launch identity JWT", () => {
  let pem = "";
  beforeEach(async () => {
    const { privateKey } = await generateKeyPair("ES256", { extractable: true });
    pem = await exportPKCS8(privateKey);
    vi.stubEnv("LAUNCH_SIGNING_KEY", pem);
    vi.stubEnv("SHOPIFY_APP_URL", "https://store.example.test");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("carries iss/jti/sub/shop/nonce/aud/iat/exp and verifies against the published JWKS for the registered issuer", async () => {
    const id = await freshIdentity();
    const { token, nonce } = await id.mintLaunchIdentity({ sub: "10344311423269", shop: "acme.myshopify.com" });
    const claims = decodeJwt(token);
    // The pre-fix defect: no iss, no jti.
    expect(claims.iss).toBe("https://store.example.test");
    expect(typeof claims.jti).toBe("string");
    expect(claims.jti).toHaveLength(36);
    expect(claims.sub).toBe("10344311423269");
    expect(claims.shop).toBe("acme.myshopify.com");
    expect(claims.nonce).toBe(nonce);
    expect(claims.aud).toBe("bmai-support-launch");
    expect(typeof claims.iat).toBe("number");
    expect(typeof claims.exp).toBe("number");
    expect(claims.exp! - claims.iat!).toBe(120);
    for (const required of ["exp", "iat", "sub", "jti", "nonce", "shop"]) expect(claims).toHaveProperty(required);

    // Verifies with the platform's checks: the app's JWKS + issuer + audience + alg.
    const jwks = createLocalJWKSet(await id.publicJwks());
    const { payload, protectedHeader } = await jwtVerify(token, jwks, {
      issuer: id.launchIssuer(),
      audience: "bmai-support-launch",
      algorithms: ["ES256"],
      requiredClaims: ["exp", "iat", "sub", "jti", "nonce", "shop"],
    });
    expect(protectedHeader.kid).toBe("bmai-shopify-launch-1");
    expect(payload.sub).toBe("10344311423269");
  });

  it("the issuer is the app ORIGIN and the registration mirrors it exactly (provisioning registers what the token says)", async () => {
    vi.stubEnv("SHOPIFY_APP_URL", "https://store.example.test/some/path");
    const id = await freshIdentity();
    expect(id.launchIssuer()).toBe("https://store.example.test");
    const reg = id.launchIdentityRegistration();
    expect(reg).toEqual({
      issuer: "https://store.example.test",
      jwksUri: "https://store.example.test/.well-known/jwks.json",
      identityEndpointUrl: "https://store.example.test/identity",
      audience: "bmai-support-launch",
      tenantClaim: "shop",
      maxTokenAgeSeconds: 120,
    });
    const { token } = await id.mintLaunchIdentity({ sub: "1", shop: "acme.myshopify.com" });
    expect(decodeJwt(token).iss).toBe(reg!.issuer);
  });

  it("no signing key → no registration (a provider is never registered for tokens the host cannot mint)", async () => {
    vi.stubEnv("LAUNCH_SIGNING_KEY", "");
    const id = await freshIdentity();
    expect(id.launchIdentityConfigured()).toBe(false);
    expect(id.launchIdentityRegistration()).toBeNull();
  });

  it("verifyLaunchToken accepts its own token and rejects a foreign issuer", async () => {
    const id = await freshIdentity();
    const { token, nonce } = await id.mintLaunchIdentity({ sub: "42", shop: "acme.myshopify.com" });
    expect(await id.verifyLaunchToken(token)).toEqual({ sub: "42", shop: "acme.myshopify.com", nonce });
    vi.stubEnv("SHOPIFY_APP_URL", "https://other.example.test");
    const other = await freshIdentity();
    await expect(other.verifyLaunchToken(token)).rejects.toThrow(/"iss" claim|issuer/i);
  });
});

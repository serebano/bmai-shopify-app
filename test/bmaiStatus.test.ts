import { afterEach, describe, expect, it } from "vitest";
import { loader } from "../app/routes/api.bmai.status";

// The /api/bmai/status capability probe: booleans only, no secret value leaked.
const ORIGINAL = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL };
});

async function status(): Promise<Record<string, unknown>> {
  const res = await loader();
  return (await res.json()) as Record<string, unknown>;
}

describe("/api/bmai/status loader", () => {
  it("actorVerifier is TRUE when a ≥32-byte master is set", async () => {
    process.env.BMAI_SUPPORT_ACTOR_MASTER = "x".repeat(40);
    const body = await status();
    expect(body.actorVerifier).toBe(true);
    expect(body.ok).toBe(true);
    expect(typeof body.audience).toBe("string");
    expect(body.audience).toBe("https://store.busymate.ai");
  });

  it("actorVerifier is FALSE when the master is unset", async () => {
    delete process.env.BMAI_SUPPORT_ACTOR_MASTER;
    const body = await status();
    expect(body.actorVerifier).toBe(false);
  });

  it("actorVerifier is FALSE when the master is too short (<32 bytes)", async () => {
    process.env.BMAI_SUPPORT_ACTOR_MASTER = "too-short";
    const body = await status();
    expect(body.actorVerifier).toBe(false);
  });

  it("launchIdentity reflects the ES256 launch key presence, and no secret leaks", async () => {
    delete process.env.LAUNCH_SIGNING_KEY;
    expect((await status()).launchIdentity).toBe(false);

    process.env.LAUNCH_SIGNING_KEY = "-----BEGIN PRIVATE KEY-----\\nMIG...\\n-----END PRIVATE KEY-----";
    const body = await status();
    expect(body.launchIdentity).toBe(true);
    // Booleans only — the response must never echo a secret value.
    expect(JSON.stringify(body)).not.toContain("PRIVATE KEY");
  });
});

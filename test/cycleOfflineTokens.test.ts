import { describe, expect, it, vi } from "vitest";
import {
  cycleOfflineTokens,
  type CycleDeps,
  type OfflineSessionLike,
} from "../app/lib/cycleOfflineTokens";

/**
 * One-off token cycling (#2110): the library never replaces an EXISTING
 * non-expiring token on its own (a session with `expires` null is "active"
 * forever), so every pre-upgrade install keeps a token Shopify now rejects. The
 * core is pure + injectable: pick the permanent sessions, exchange each via
 * `migrateToExpiringToken`, store the expiring result, report per shop — and
 * never let a token value reach the report or the log.
 */

// Synthetic opaque values — NOT credentials.
const OLD = "old-permanent-token-value";
const NEW = "new-expiring-token-value";
const REFRESH = "new-refresh-token-value";

const hour = 60 * 60 * 1000;

function permanent(shop: string): OfflineSessionLike {
  return { id: `offline_${shop}`, shop, accessToken: OLD };
}
function expiring(shop: string): OfflineSessionLike {
  return {
    id: `offline_${shop}`,
    shop,
    accessToken: NEW,
    expires: new Date(Date.now() + hour),
    refreshToken: REFRESH,
    refreshTokenExpires: new Date(Date.now() + 30 * 24 * hour),
  };
}

function deps(sessions: OfflineSessionLike[], overrides: Partial<CycleDeps> = {}) {
  const log: string[] = [];
  const d: CycleDeps = {
    listOfflineSessions: async () => sessions,
    migrate: vi.fn(async (shop: string) => expiring(shop)),
    store: vi.fn(async () => true),
    log: (line) => log.push(line),
    ...overrides,
  };
  return { d, log };
}

describe("cycleOfflineTokens", () => {
  it("migrates only permanent sessions and stores the expiring result", async () => {
    const { d } = deps([permanent("a.myshopify.com"), expiring("b.myshopify.com")]);
    const report = await cycleOfflineTokens(d);
    expect(report.scanned).toBe(2);
    expect(report.cycled).toEqual(["a.myshopify.com"]);
    expect(report.skipped).toEqual([{ shop: "b.myshopify.com", reason: "already expiring" }]);
    expect(d.migrate).toHaveBeenCalledWith("a.myshopify.com", OLD);
    expect(d.store).toHaveBeenCalledTimes(1);
    const stored = (d.store as ReturnType<typeof vi.fn>).mock.calls[0][0] as OfflineSessionLike;
    expect(stored.refreshToken).toBe(REFRESH);
    expect(stored.expires).toBeInstanceOf(Date);
  });

  it("treats an expiring session WITHOUT a refresh token as needing a cycle", async () => {
    const s = { ...expiring("c.myshopify.com"), refreshToken: undefined };
    const { d } = deps([s]);
    const report = await cycleOfflineTokens(d);
    expect(report.cycled).toEqual(["c.myshopify.com"]);
  });

  it("filters to one shop when asked", async () => {
    const { d } = deps([permanent("a.myshopify.com"), permanent("b.myshopify.com")]);
    const report = await cycleOfflineTokens(d, { shop: "b.myshopify.com" });
    expect(report.cycled).toEqual(["b.myshopify.com"]);
    expect(report.skipped).toEqual([{ shop: "a.myshopify.com", reason: "not the requested shop" }]);
  });

  it("dry run lists candidates and exchanges nothing", async () => {
    const { d } = deps([permanent("a.myshopify.com")]);
    const report = await cycleOfflineTokens(d, { dryRun: true });
    expect(report.candidates).toEqual(["a.myshopify.com"]);
    expect(report.cycled).toEqual([]);
    expect(d.migrate).not.toHaveBeenCalled();
    expect(d.store).not.toHaveBeenCalled();
  });

  it("one shop's failure never aborts the others, and the report is value-blind", async () => {
    const migrate = vi.fn(async (shop: string) => {
      if (shop === "bad.myshopify.com") throw new Error(`exchange failed for ${OLD}`);
      return expiring(shop);
    });
    const { d, log } = deps([permanent("bad.myshopify.com"), permanent("good.myshopify.com")], { migrate });
    const report = await cycleOfflineTokens(d);
    expect(report.cycled).toEqual(["good.myshopify.com"]);
    expect(report.failed).toHaveLength(1);
    expect(report.failed[0].shop).toBe("bad.myshopify.com");
    const everything = JSON.stringify(report) + log.join("\n");
    expect(everything).not.toContain(OLD);
    expect(everything).not.toContain(NEW);
    expect(everything).not.toContain(REFRESH);
  });

  it("fails closed when the exchange returns a session that is not expiring", async () => {
    const migrate = vi.fn(async (shop: string) => ({ ...permanent(shop), accessToken: NEW }));
    const { d } = deps([permanent("a.myshopify.com")], { migrate });
    const report = await cycleOfflineTokens(d);
    expect(report.cycled).toEqual([]);
    expect(report.failed[0]).toMatchObject({ shop: "a.myshopify.com" });
    expect(report.failed[0].error).toMatch(/not expiring/);
    expect(d.store).not.toHaveBeenCalled();
  });

  it("a false store result counts as a failure (never green-while-dead)", async () => {
    const { d } = deps([permanent("a.myshopify.com")], { store: vi.fn(async () => false) });
    const report = await cycleOfflineTokens(d);
    expect(report.cycled).toEqual([]);
    expect(report.failed[0].error).toMatch(/store/);
  });
});

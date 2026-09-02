import { describe, expect, it } from "vitest";
import { BILLING_METER_SECRET_ENV, meterRequestAuthorized } from "../app/lib/meterAuth.server";

/**
 * The metering trigger endpoint's auth: fail-closed (no secret ⇒ unconfigured,
 * never open), timing-safe, value-blind.
 */
describe("POST /api/billing/meter auth", () => {
  it("is unconfigured (503 path) when the secret is absent or EMPTY", () => {
    expect(meterRequestAuthorized("x", {})).toBe("unconfigured");
    expect(meterRequestAuthorized("x", { [BILLING_METER_SECRET_ENV]: "" })).toBe("unconfigured");
  });
  it("denies a missing, wrong, or length-mismatched header", () => {
    const env = { [BILLING_METER_SECRET_ENV]: "s3cret-value" };
    expect(meterRequestAuthorized(null, env)).toBe("denied");
    expect(meterRequestAuthorized("", env)).toBe("denied");
    expect(meterRequestAuthorized("s3cret-valuX", env)).toBe("denied");
    expect(meterRequestAuthorized("s3cret", env)).toBe("denied");
  });
  it("accepts the exact secret", () => {
    expect(meterRequestAuthorized("s3cret-value", { [BILLING_METER_SECRET_ENV]: "s3cret-value" })).toBe("ok");
  });
});

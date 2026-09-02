import { timingSafeEqual } from "node:crypto";

/**
 * Auth for the metering trigger (`POST /api/billing/meter`): a shared secret in
 * env `BILLING_METER_SECRET`, compared timing-safely against the
 * `x-billing-meter-secret` header. FAIL-CLOSED: no secret configured ⇒
 * "unconfigured" (the route answers 503, never an open endpoint); a missing /
 * wrong / length-mismatched header ⇒ "denied" (401). Value-blind: the secret is
 * never logged or echoed.
 */
export const BILLING_METER_SECRET_ENV = "BILLING_METER_SECRET";
export const BILLING_METER_HEADER = "x-billing-meter-secret";

export function meterRequestAuthorized(
  headerValue: string | null,
  env: NodeJS.ProcessEnv = process.env,
): "ok" | "unconfigured" | "denied" {
  const secret = (env[BILLING_METER_SECRET_ENV] ?? "").trim();
  if (!secret) return "unconfigured";
  const given = (headerValue ?? "").trim();
  if (!given || given.length !== secret.length) return "denied";
  return timingSafeEqual(Buffer.from(given, "utf8"), Buffer.from(secret, "utf8")) ? "ok" : "denied";
}

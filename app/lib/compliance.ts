/**
 * GDPR mandatory-webhook dispatch — the #1 App Store rejection cause, so the
 * handlers must ACTUALLY satisfy the request, not merely 200.
 *
 * Expressed as ONE pure, injectable dispatcher so the real teardown/erase/export
 * effects (which flow through MCP + the app DB) can be unit-tested with mocks and
 * without a live shop. HMAC verification happens BEFORE this runs, in the route
 * (via authenticate.webhook), so an unsigned request never reaches here.
 *
 *   - customers/data_request → export the identified customer's data we hold.
 *   - customers/redact       → erase that customer's data (idempotent).
 *   - shop/redact            → 48h after uninstall: tear the whole tenant down.
 *
 */
export type ComplianceTopic =
  | "CUSTOMERS_DATA_REQUEST"
  | "CUSTOMERS_REDACT"
  | "SHOP_REDACT";

export interface ComplianceSubject {
  shop: string;
  customerId: string | null;
}

export interface ComplianceDeps {
  /** Assemble + deliver the customer's held data (via MCP tenant read). */
  exportCustomerData: (shop: string, customerId: string) => Promise<{ ok: boolean; error?: string }>;
  /** Erase the customer's transcripts/PII from the tenant KB (idempotent, via MCP). */
  redactCustomer: (shop: string, customerId: string) => Promise<{ ok: boolean; error?: string }>;
  /** Full tenant teardown + local purge for the shop. */
  redactShop: (shop: string) => Promise<void>;
}

export interface ComplianceOutcome {
  handled: boolean;
  action: "export" | "redact_customer" | "redact_shop" | "noop";
  ok: boolean;
  error?: string;
}

export async function handleComplianceTopic(
  topic: string,
  subject: ComplianceSubject,
  deps: ComplianceDeps,
): Promise<ComplianceOutcome> {
  switch (topic as ComplianceTopic) {
    case "CUSTOMERS_DATA_REQUEST": {
      if (!subject.customerId) return { handled: true, action: "export", ok: true };
      const r = await deps.exportCustomerData(subject.shop, subject.customerId);
      return { handled: true, action: "export", ok: r.ok, error: r.error };
    }
    case "CUSTOMERS_REDACT": {
      if (!subject.customerId) return { handled: true, action: "redact_customer", ok: true };
      const r = await deps.redactCustomer(subject.shop, subject.customerId);
      return { handled: true, action: "redact_customer", ok: r.ok, error: r.error };
    }
    case "SHOP_REDACT": {
      await deps.redactShop(subject.shop);
      return { handled: true, action: "redact_shop", ok: true };
    }
    default:
      return { handled: false, action: "noop", ok: true };
  }
}

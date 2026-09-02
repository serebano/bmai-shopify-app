import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  exportTenantCustomerData,
  redactTenantCustomer,
  onShopRedact,
} from "../bmai.server";
import { handleComplianceTopic, type ComplianceDeps } from "../lib/compliance";

/**
 * The THREE mandatory GDPR compliance webhooks — the #1 App Store rejection cause.
 * Handlers ACTUALLY satisfy the request (export/erase tenant data; tear the tenant
 * down on shop/redact), they do not merely 200.
 *
 * authenticate.webhook verifies the HMAC; an invalid signature throws before we
 * act (fail-closed). The topic dispatch itself is the pure, unit-tested
 * handleComplianceTopic (app/lib/compliance.ts) with the real MCP + DB effects
 * injected here. A shop with no provisioned tenant holds nothing → 200 no-op.
 */
const deps: ComplianceDeps = {
  hasTenant: async (shop) => {
    const row = await prisma.shopTenant.findUnique({ where: { shop }, select: { bmaiTenantId: true } });
    return Boolean(row?.bmaiTenantId);
  },
  exportCustomerData: exportTenantCustomerData,
  redactCustomer: redactTenantCustomer,
  redactShop: onShopRedact,
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  const customerId =
    (payload?.customer as { id?: number | string } | undefined)?.id?.toString() ?? null;

  const outcome = await handleComplianceTopic(topic, { shop, customerId }, deps);
  if (!outcome.handled) {
    console.warn(`[gdpr] unhandled compliance topic ${topic} for ${shop}`);
  } else if (!outcome.ok) {
    // Surface the failure loudly; Shopify retries the webhook on a non-2xx.
    console.error(`[gdpr] ${outcome.action} failed shop=${shop}: ${outcome.error}`);
    return new Response("compliance action failed", { status: 500 });
  } else if (outcome.noop) {
    console.log(`[gdpr] ${outcome.action} noop shop=${shop} customer=${customerId ?? "-"} (${outcome.noop})`);
  } else {
    console.log(`[gdpr] ${outcome.action} ok shop=${shop} customer=${customerId ?? "-"}`);
  }
  return new Response();
};

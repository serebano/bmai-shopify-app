import type { ToolContext, ToolResult } from "./types";
import { errorResult, textResult } from "./types";

/**
 * Delegated + confirm tools (Admin GraphQL 2026-07). The transport enforces confirm
 * before dispatch; these run scoped to the identified customer + a verified actor
 * token.
 */

const USER_ERRORS = `userErrors { field message }`;

function firstError(errors?: Array<{ message?: string }> | null): string | null {
  return errors?.find((e) => e.message)?.message ?? null;
}

/**
 * Validate a discount code against the store and return the storefront apply link.
 * We deliberately do NOT mutate the store: the customer applies the (verified) code
 * at their own checkout, which is both safer and the correct place for a cart-level
 * discount. An unknown/expired code is a graceful refusal, not an error card.
 */
export async function applyDiscount(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.customerId) return errorResult("Sign in required to apply a discount to your order.");
  const code = String(args.code ?? "").trim();
  if (!code) return errorResult("Tell me the discount code and I'll check it for you.");

  const data = (await ctx.admin.graphql(
    `#graphql
    query DiscountByCode($code: String!) {
      codeDiscountNodeByCode(code: $code) {
        id
        codeDiscount {
          __typename
          ... on DiscountCodeBasic { title status summary }
          ... on DiscountCodeBxgy { title status summary }
          ... on DiscountCodeFreeShipping { title status summary }
        }
      }
    }`,
    { code },
  )) as {
    codeDiscountNodeByCode?: {
      id: string;
      codeDiscount?: { title?: string; status?: string; summary?: string };
    } | null;
  };

  const node = data.codeDiscountNodeByCode;
  if (!node) {
    return textResult(`I couldn't find a discount code “${code}” for this store.`, { code, valid: false });
  }
  const status = (node.codeDiscount?.status ?? "").toUpperCase();
  if (status && status !== "ACTIVE") {
    return textResult(`The code “${code}” isn't active right now (${status.toLowerCase()}).`, {
      code,
      valid: false,
      status,
    });
  }
  const applyUrl = `https://${ctx.shop}/discount/${encodeURIComponent(code)}`;
  const summary = node.codeDiscount?.summary ? ` (${node.codeDiscount.summary})` : "";
  return textResult(
    `“${code}” is valid${summary}. Use this link and it'll be applied at checkout: ${applyUrl}`,
    { code, valid: true, applyUrl, summary: node.codeDiscount?.summary ?? null },
  );
}

interface RawLineItem {
  variant_id?: string;
  variantId?: string;
  quantity?: number;
  title?: string;
}

function draftLineItems(raw: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(raw)) return [];
  const out: Array<Record<string, unknown>> = [];
  for (const item of raw as RawLineItem[]) {
    const quantity = Math.max(1, Number(item.quantity ?? 1) || 1);
    const variantId = item.variantId ?? item.variant_id;
    if (variantId) {
      const gid = String(variantId).startsWith("gid://")
        ? String(variantId)
        : `gid://shopify/ProductVariant/${variantId}`;
      out.push({ variantId: gid, quantity });
    } else if (item.title) {
      out.push({ title: item.title, quantity });
    }
  }
  return out;
}

export async function createDraftOrder(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ctx.customerId) return errorResult("Sign in required to create a draft order.");
  const lineItems = draftLineItems(args.line_items);
  if (lineItems.length === 0) {
    return errorResult("Tell me which products (and quantities) to put on the draft order.");
  }

  const data = (await ctx.admin.graphql(
    `#graphql
    mutation DraftOrderCreate($input: DraftOrderInput!) {
      draftOrderCreate(input: $input) {
        draftOrder { id name invoiceUrl totalPriceSet { presentmentMoney { amount currencyCode } } }
        ${USER_ERRORS}
      }
    }`,
    {
      input: {
        purchasingEntity: { customerId: `gid://shopify/Customer/${ctx.customerId}` },
        lineItems,
      },
    },
  )) as {
    draftOrderCreate?: {
      draftOrder?: {
        id: string;
        name: string;
        invoiceUrl?: string | null;
        totalPriceSet?: { presentmentMoney?: { amount: string; currencyCode: string } };
      } | null;
      userErrors?: Array<{ message?: string }>;
    };
  };

  const err = firstError(data.draftOrderCreate?.userErrors);
  const draft = data.draftOrderCreate?.draftOrder;
  if (err || !draft) {
    return errorResult(`I couldn't create that draft order: ${err ?? "it was rejected"}.`);
  }
  const total = draft.totalPriceSet?.presentmentMoney;
  return textResult(
    `Created draft order ${draft.name}${total ? ` — ${total.amount} ${total.currencyCode}` : ""}.${
      draft.invoiceUrl ? ` Checkout link: ${draft.invoiceUrl}` : ""
    }`,
    { draftId: draft.id, name: draft.name, invoiceUrl: draft.invoiceUrl ?? null },
  );
}

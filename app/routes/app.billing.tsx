import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import {
  Banner,
  BlockStack,
  Button,
  Card,
  Layout,
  List,
  Page,
  Text,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { PLANS } from "../lib/usageBilling";
import { managedPricingUrl, resolveBillingAccess } from "../lib/billingGate";

// The app handle from shopify.app.toml (`handle = "busymate-ai"`); the managed
// pricing page lives at /store/<store>/charges/<handle>/pricing_plans.
const APP_HANDLE = process.env.SHOPIFY_APP_HANDLE || "busymate-ai";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const billing = await prisma.billingState.findUnique({ where: { shop: session.shop } });
  const access = resolveBillingAccess({
    status: billing?.status,
    shop: session.shop,
    appHandle: APP_HANDLE,
  });
  return {
    plans: PLANS,
    status: billing?.status ?? "inactive",
    cappedAmountCents: billing?.cappedAmountCents ?? 5000,
    mustSubscribe: access.mustSubscribe,
    pricingUrl: managedPricingUrl(session.shop, APP_HANDLE),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  // Shopify Billing API only — the App Store forbids an external checkout for app
  // charges. With **Managed Pricing** the merchant picks a plan on Shopify's
  // hosted page, so the billing "check + redirect" is: resolve access, and when
  // there is no active plan, redirect to the managed pricing page.
  const { session } = await authenticate.admin(request);
  const billing = await prisma.billingState.findUnique({ where: { shop: session.shop } });
  const access = resolveBillingAccess({
    status: billing?.status,
    shop: session.shop,
    appHandle: APP_HANDLE,
  });
  if (access.mustSubscribe && access.redirectTo) {
    throw redirect(access.redirectTo);
  }
  return { ok: true, status: billing?.status ?? "inactive" };
};

export default function BillingPage() {
  const data = useLoaderData<typeof loader>();
  return (
    <Page>
      <TitleBar title="Billing" />
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Pay per resolution — capped, never disabled at cap
              </Text>
              <Text as="p" tone="subdued">
                You are billed only for conversations bro actually resolves. Your
                spend cap is a ceiling on charges, not a kill switch — the widget
                keeps working past the cap. Status: {data.status}.
              </Text>
              {data.mustSubscribe ? (
                <Banner
                  tone="warning"
                  title="Choose a plan to start"
                  action={{ content: "Choose a plan", url: data.pricingUrl, external: true }}
                >
                  <p>
                    Pick a plan on Shopify&apos;s secure pricing page. Your
                    storefront assistant keeps working either way.
                  </p>
                </Banner>
              ) : (
                <Button url={data.pricingUrl} external>
                  Manage plan
                </Button>
              )}
              <List>
                {data.plans.map((p) => (
                  <List.Item key={p.id}>
                    <strong>{p.name}</strong> — {p.blurb}
                  </List.Item>
                ))}
              </List>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

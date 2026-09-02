import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  InlineGrid,
  InlineStack,
  Layout,
  Link,
  List,
  Page,
  Text,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { shopToSlug } from "../lib/tenantSlug";
import { onAppInstalled } from "../bmai.server";
import { readTrainingState } from "../lib/retrain.server";
import { resolveBillingAccess } from "../lib/billingGate";
import { planFor } from "../lib/plans";
import { failClosedClientAction } from "../lib/clientAction";
import { AppRouteBoundary } from "../components/AppRouteError";

// Embedded-frame contract (#retrain-500): a failed action FETCH renders an error
// toast (never the root 500 page), and a route error recovers in-frame.
export const clientAction = failClosedClientAction;
export const ErrorBoundary = AppRouteBoundary;
import {
  APP_EMBED_LABEL,
  EMBED_STEPS,
  buildSetupChecklist,
  detectStorefrontEmbed,
  themeEditorActivateUrl,
  themeEditorAppEmbedsUrl,
  trainingSummary,
} from "../lib/themeEmbed";

const APP_HANDLE = process.env.SHOPIFY_APP_HANDLE || "busymate-ai";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const tenant = await prisma.shopTenant.findUnique({ where: { shop }, include: { billing: true } });
  const slug = tenant?.slug ?? shopToSlug(shop);
  const training = readTrainingState(tenant);
  const access = resolveBillingAccess({ status: tenant?.billing?.status, plan: tenant?.billing?.plan, shop, appHandle: APP_HANDLE });
  // Scope-free embed detection from the public storefront (unknown on a
  // password-protected store — the written steps cover that case).
  const embed = await detectStorefrontEmbed(shop);
  const provisionState = tenant?.provisionState ?? "pending";
  const steps = buildSetupChecklist({
    provisionState,
    connectorReady: Boolean(tenant?.connectorId),
    embed,
    trainedAt: training.trainedAt,
    trainError: training.error,
    counts: training.counts,
    fetched: training.fetched,
    truncated: training.truncated,
    planId: access.planId,
    hasSubscription: tenant?.billing?.status === "active" || tenant?.billing?.status === "pending",
    planSelected: access.planSelected,
  });
  return {
    shop,
    planSelected: access.planSelected,
    servingHost: `${slug}.busymate.ai`,
    provisionState,
    provisionError: tenant?.provisionError ?? null,
    connectorReady: Boolean(tenant?.connectorId),
    training: { ...training, summary: trainingSummary(training.counts, training.fetched) },
    embed,
    steps,
    embedSteps: EMBED_STEPS,
    embedLabel: APP_EMBED_LABEL,
    activateUrl: themeEditorActivateUrl(shop),
    appEmbedsUrl: themeEditorAppEmbedsUrl(shop),
    planName: planFor(access.planId).name,
    live: provisionState === "published",
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  if (String(form.get("intent")) === "retry") {
    // Idempotent re-run of the provisioning lifecycle (NEVER PARK an errored install).
    await onAppInstalled(session);
  }
  const tenant = await prisma.shopTenant.findUnique({ where: { shop: session.shop } });
  return { ok: tenant?.provisionState === "published", state: tenant?.provisionState ?? "pending", error: tenant?.provisionError ?? null };
};

function stateBadge(state: string) {
  if (state === "published") return <Badge tone="success">Live</Badge>;
  if (state === "error") return <Badge tone="critical">Needs attention</Badge>;
  if (state === "suspended") return <Badge tone="warning">Suspended</Badge>;
  return <Badge tone="attention">Provisioning</Badge>;
}

export default function Index() {
  const data = useLoaderData<typeof loader>();
  const retry = useFetcher<typeof action>();
  const done = data.steps.filter((s) => s.done).length;
  return (
    <Page>
      <TitleBar title="Busymate AI" />
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            {data.provisionError ? (
              <Banner tone="critical" title="Provisioning needs attention">
                <BlockStack gap="200">
                  <Text as="p">{data.provisionError}</Text>
                  <retry.Form method="post">
                    <input type="hidden" name="intent" value="retry" />
                    <Button submit variant="primary" loading={retry.state !== "idle"}>
                      Retry setup
                    </Button>
                  </retry.Form>
                  {retry.data && !retry.data.ok ? (
                    <Text as="p" tone="critical">
                      Still not live ({retry.data.state}){retry.data.error ? `: ${retry.data.error}` : ""}.
                    </Text>
                  ) : null}
                </BlockStack>
              </Banner>
            ) : null}

            <Card>
              <BlockStack gap="400">
                <InlineGrid columns="1fr auto" alignItems="center">
                  <Text as="h2" variant="headingMd">
                    Set up your AI assistant
                  </Text>
                  <InlineStack gap="200" blockAlign="center">
                    <Text as="span" tone="subdued">
                      {done}/{data.steps.length} done
                    </Text>
                    {stateBadge(data.provisionState)}
                  </InlineStack>
                </InlineGrid>
                <Text as="p" tone="subdued">
                  Busymate AI adds <strong>bro</strong>, your store&apos;s own assistant, to your storefront. It answers
                  only from your products, pages and policies, in your shoppers&apos; languages, and takes order actions
                  only with confirmation.
                </Text>
                <List type="number">
                  {data.steps.map((s) => (
                    <List.Item key={s.id}>
                      <InlineStack gap="200" blockAlign="center" wrap={false}>
                        <Text as="span" fontWeight="semibold">
                          {s.title}
                        </Text>
                        {s.failed ? (
                          <Badge tone="critical">Failed</Badge>
                        ) : s.done ? (
                          <Badge tone="success">Done</Badge>
                        ) : (
                          <Badge tone="attention">To do</Badge>
                        )}
                      </InlineStack>
                      <Text as="p" tone="subdued">
                        {s.detail}
                      </Text>
                    </List.Item>
                  ))}
                </List>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <InlineGrid columns="1fr auto" alignItems="center">
                  <Text as="h2" variant="headingMd">
                    Turn on the storefront assistant
                  </Text>
                  {data.embed === "on" ? <Badge tone="success">On</Badge> : data.embed === "off" ? <Badge tone="attention">Off</Badge> : null}
                </InlineGrid>
                <Text as="p" tone="subdued">
                  The assistant is a theme app embed. Click the button to open your theme editor with{" "}
                  <strong>{data.embedLabel}</strong> already switched on, then click <strong>Save</strong>.
                </Text>
                <InlineStack gap="300">
                  <Button variant="primary" url={data.activateUrl} target="_top">
                    Turn on the storefront assistant
                  </Button>
                  <Button url={data.appEmbedsUrl} target="_top">
                    Open App embeds
                  </Button>
                </InlineStack>
                <Box>
                  <Text as="h3" variant="headingSm">
                    Or do it by hand
                  </Text>
                  <List type="number">
                    {data.embedSteps.map((step) => (
                      <List.Item key={step}>{step}</List.Item>
                    ))}
                  </List>
                </Box>
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <BlockStack gap="400">
            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">
                  Your assistant
                </Text>
                <Text as="p" tone="subdued">
                  {data.live ? "Serving at " : "Will serve at "}
                  <Link url={`https://${data.servingHost}`} target="_blank">
                    {data.servingHost}
                  </Link>
                </Text>
                {data.live ? (
                  <Button url={`https://${data.servingHost}`} target="_blank">
                    Open assistant
                  </Button>
                ) : null}
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">
                  Store connection
                </Text>
                <Text as="p" tone="subdued">
                  {data.connectorReady
                    ? "Connected — the assistant can look up a signed-in shopper's own orders."
                    : "Not connected yet — order lookups are unavailable until the connection registers. Retry from the Store connection page."}
                </Text>
                <Link url="/app/connector">Manage store connection</Link>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">
                  Training
                </Text>
                <Text as="p" tone="subdued">
                  {data.training.error
                    ? `Training failed: ${data.training.error}`
                    : data.training.summary
                      ? `Trained on ${data.training.summary}.`
                      : "Not trained yet — the assistant learns your products, policies and pages when setup completes."}
                </Text>
                <Link url="/app/connector">Re-train</Link>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">
                  Billing
                </Text>
                <Text as="p" tone="subdued">
                  {data.planSelected ? (
                    <>
                      You&apos;re on the <strong>{data.planName}</strong> plan.
                    </>
                  ) : (
                    <>
                      <strong>No plan selected yet</strong> — choose the $0 Free plan or a paid plan on Shopify&apos;s pricing
                      page; Free-plan limits apply until you do.
                    </>
                  )}{" "}
                  Plans include a monthly number of AI resolutions; paid plans charge per extra resolution up to a monthly
                  cap. The assistant is never switched off for billing.
                </Text>
                <Link url="/app/billing">{data.planSelected ? "Manage plan" : "Choose a plan"}</Link>
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

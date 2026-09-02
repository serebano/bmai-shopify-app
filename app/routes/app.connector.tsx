import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import {
  Badge,
  BlockStack,
  Button,
  Card,
  Collapsible,
  InlineGrid,
  InlineStack,
  Layout,
  Page,
  Text,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { onAppInstalled } from "../bmai.server";
import { connectorEndpoint } from "../lib/connector";
import { readTrainingState, runRetrain } from "../lib/retrain.server";
import { trainingSummary } from "../lib/themeEmbed";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const tenant = await prisma.shopTenant.findUnique({ where: { shop: session.shop } });
  const training = readTrainingState(tenant);
  return {
    endpoint: connectorEndpoint(),
    connectorId: tenant?.connectorId ?? null,
    tenantId: tenant?.bmaiTenantId ?? null,
    provisionState: tenant?.provisionState ?? "pending",
    provisionError: tenant?.provisionError ?? null,
    provisionedAt: tenant?.publishedAt ? new Date(tenant.publishedAt).toISOString() : null,
    training: { ...training, summary: trainingSummary(training.counts, training.fetched) },
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  if (intent === "reprovision") {
    // Idempotent re-run of the full lifecycle. NEVER PARK: an errored install is
    // retryable here rather than stuck.
    await onAppInstalled(session);
    const tenant = await prisma.shopTenant.findUnique({ where: { shop: session.shop } });
    return { intent, ok: tenant?.provisionState === "published", state: tenant?.provisionState ?? "pending", error: tenant?.provisionError ?? null };
  }
  if (intent === "retrain") {
    // Synchronous: fetch → compress → publish → persist, then report the REAL state.
    const r = await runRetrain(session.shop);
    return {
      intent,
      ok: r.ok,
      state: r.ok ? "trained" : "failed",
      error: r.error ?? null,
      trainedAt: r.state.trainedAt,
      counts: r.state.counts,
      summary: trainingSummary(r.state.counts, r.state.fetched),
    };
  }
  return { intent, ok: false, state: "unknown", error: "unknown action" };
};

function when(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : "never";
}

export default function ConnectorPage() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const [showTech, setShowTech] = useState(false);
  const busy = (intent: string) => fetcher.state !== "idle" && fetcher.formData?.get("intent") === intent;

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data) {
      const d = fetcher.data;
      if (d.intent === "retrain")
        shopify.toast.show(d.ok ? `Trained on ${"summary" in d && d.summary ? d.summary : "your store"}` : `Re-train failed: ${d.error ?? "unknown"}`, { isError: !d.ok });
      if (d.intent === "reprovision") shopify.toast.show(d.ok ? "Store connection is live" : `Still not live: ${d.error ?? d.state}`, { isError: !d.ok });
    }
  }, [fetcher.state, fetcher.data, shopify]);

  const connected = Boolean(data.connectorId) && data.provisionState === "published";
  return (
    <Page>
      <TitleBar title="Store connection" />
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            <Card>
              <BlockStack gap="300">
                <InlineGrid columns="1fr auto" alignItems="center">
                  <Text as="h2" variant="headingMd">
                    Store connection
                  </Text>
                  {connected ? (
                    <Badge tone="success">Connected</Badge>
                  ) : data.provisionState === "error" ? (
                    <Badge tone="critical">Error</Badge>
                  ) : (
                    <Badge tone="attention">Not connected</Badge>
                  )}
                </InlineGrid>
                <Text as="p" tone="subdued">
                  The connection lets the assistant look up a signed-in shopper&apos;s own orders and, with confirmation,
                  update an address, start a return, cancel or refund. It uses the permissions you approved on install
                  and nothing more.
                </Text>
                <Text as="p">
                  Last set up: {when(data.provisionedAt)}
                  {data.provisionError ? "" : ""}
                </Text>
                {data.provisionError ? (
                  <Text as="p" tone="critical">
                    {data.provisionError}
                  </Text>
                ) : null}
                <InlineStack gap="300">
                  <fetcher.Form method="post">
                    <input type="hidden" name="intent" value="reprovision" />
                    <Button submit variant={connected ? "secondary" : "primary"} loading={busy("reprovision")}>
                      {connected ? "Reconnect" : "Retry connection"}
                    </Button>
                  </fetcher.Form>
                  <Button onClick={() => setShowTech((v) => !v)} disclosure={showTech ? "up" : "down"} variant="plain">
                    Technical details
                  </Button>
                </InlineStack>
                <Collapsible open={showTech} id="connector-technical-details">
                  <BlockStack gap="100">
                    <Text as="p" tone="subdued">
                      Endpoint: <code>{data.endpoint}</code>
                    </Text>
                    <Text as="p" tone="subdued">
                      Connection id: <code>{data.connectorId ?? "—"}</code> · Assistant id: <code>{data.tenantId ?? "—"}</code> ·
                      State: <code>{data.provisionState}</code>
                    </Text>
                    <Text as="p" tone="subdued">
                      Registered with Busymate AI as this store&apos;s private connector; order actions are scoped to the
                      signed-in shopper and confirm-gated.
                    </Text>
                  </BlockStack>
                </Collapsible>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <InlineGrid columns="1fr auto" alignItems="center">
                  <Text as="h2" variant="headingMd">
                    Training data
                  </Text>
                  {data.training.error ? (
                    <Badge tone="critical">Failed</Badge>
                  ) : data.training.trainedAt ? (
                    <Badge tone="success">Trained</Badge>
                  ) : (
                    <Badge tone="attention">Not trained yet</Badge>
                  )}
                </InlineGrid>
                <Text as="p" tone="subdued">
                  The assistant answers only from your products, pages and store policies. Re-train after big catalogue
                  or policy changes; product updates re-train automatically.
                </Text>
                <Text as="p">
                  Last trained: {when(data.training.trainedAt)}
                  {data.training.summary ? ` · trained on ${data.training.summary}` : ""}
                  {data.training.truncated ? " · the catalogue was trimmed to fit the assistant's knowledge limit (most important items first)" : ""}
                </Text>
                {data.training.error ? (
                  <Text as="p" tone="critical">
                    {data.training.error}
                  </Text>
                ) : null}
                <fetcher.Form method="post">
                  <input type="hidden" name="intent" value="retrain" />
                  <Button submit variant="primary" loading={busy("retrain")} disabled={!data.tenantId}>
                    Re-train on my store
                  </Button>
                </fetcher.Form>
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

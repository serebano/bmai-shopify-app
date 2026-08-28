import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import {
  BlockStack,
  Button,
  Card,
  Layout,
  Page,
  Text,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { onAppInstalled } from "../bmai.server";
import { connectorEndpoint } from "../lib/connector";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const tenant = await prisma.shopTenant.findUnique({ where: { shop: session.shop } });
  return {
    endpoint: connectorEndpoint(),
    connectorId: tenant?.connectorId ?? null,
    provisionState: tenant?.provisionState ?? "pending",
    provisionError: tenant?.provisionError ?? null,
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
  }
  const tenant = await prisma.shopTenant.findUnique({ where: { shop: session.shop } });
  return { ok: tenant?.provisionState === "published", state: tenant?.provisionState };
};

export default function ConnectorPage() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  return (
    <Page>
      <TitleBar title="Connector & data" />
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Shopify Admin connector
              </Text>
              <Text as="p" tone="subdued">
                bro reaches your store&apos;s order-aware tools through this
                connector (registered as a per-store MCP server with
                signed-actor-token delegation). Endpoint: <code>{data.endpoint}</code>
              </Text>
              <Text as="p">State: {data.provisionState}</Text>
              {data.provisionError ? (
                <Text as="p" tone="critical">
                  {data.provisionError}
                </Text>
              ) : null}
              <fetcher.Form method="post">
                <input type="hidden" name="intent" value="reprovision" />
                <Button submit variant="primary" loading={fetcher.state !== "idle"}>
                  Re-provision &amp; re-train
                </Button>
              </fetcher.Form>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

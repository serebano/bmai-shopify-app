import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import {
  BlockStack,
  Card,
  FormLayout,
  Layout,
  Page,
  Text,
  TextField,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { callMcpTool } from "../bmai.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const tenant = await prisma.shopTenant.findUnique({ where: { shop: session.shop } });
  return {
    assistantName: "Assistant",
    displayName: tenant?.slug ?? session.shop,
    tenantId: tenant?.bmaiTenantId ?? null,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const tenant = await prisma.shopTenant.findUnique({ where: { shop: session.shop } });
  // set_tenant_branding via MCP (no backdoor). Owner-gated until the provision
  // credential is set; the result is surfaced honestly rather than assumed.
  const res = await callMcpTool("set_tenant_branding", {
    tenant_id: tenant?.bmaiTenantId,
    display_name: String(form.get("displayName") ?? ""),
    assistant_name: String(form.get("assistantName") ?? ""),
  });
  return { ok: res.ok, error: res.error ?? null };
};

export default function SettingsPage() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const [assistantName, setAssistantName] = useState(data.assistantName);
  const [displayName, setDisplayName] = useState(data.displayName);
  return (
    <Page>
      <TitleBar title="Assistant settings" />
      <Layout>
        <Layout.Section>
          <Card>
            <fetcher.Form method="post">
              <FormLayout>
                <Text as="h2" variant="headingMd">
                  Branding
                </Text>
                <TextField
                  label="Assistant name"
                  name="assistantName"
                  autoComplete="off"
                  value={assistantName}
                  onChange={setAssistantName}
                  helpText="Shown on the storefront launcher (i18n across 14 locales)."
                />
                <TextField
                  label="Display name"
                  name="displayName"
                  autoComplete="off"
                  value={displayName}
                  onChange={setDisplayName}
                />
                <button type="submit">Save</button>
                {fetcher.data?.error ? (
                  <Text as="p" tone="critical">
                    {fetcher.data.error}
                  </Text>
                ) : null}
              </FormLayout>
            </fetcher.Form>
          </Card>
        </Layout.Section>
        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm">
                Tool access tiers
              </Text>
              <Text as="p" tone="subdued">
                public (FAQ), identified (own orders/WISMO), delegated + confirm
                (refund/return/cancel/address — capped). Managed on the connector
                page.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

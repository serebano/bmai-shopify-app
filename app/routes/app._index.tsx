import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import {
  Badge,
  BlockStack,
  Box,
  Button,
  Card,
  InlineGrid,
  Layout,
  Link,
  Page,
  Text,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { shopToSlug } from "../lib/tenantSlug";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const tenant = await prisma.shopTenant.findUnique({
    where: { shop },
    include: { billing: true },
  });
  const slug = tenant?.slug ?? shopToSlug(shop);
  return {
    shop,
    slug,
    servingHost: `${slug}.busymate.ai`,
    provisionState: tenant?.provisionState ?? "pending",
    provisionError: tenant?.provisionError ?? null,
    publishedAt: tenant?.publishedAt ?? null,
    connectorReady: Boolean(tenant?.connectorId),
    billingStatus: tenant?.billing?.status ?? "inactive",
  };
};

function stateBadge(state: string) {
  if (state === "published") return <Badge tone="success">Live</Badge>;
  if (state === "error") return <Badge tone="critical">Needs attention</Badge>;
  if (state === "suspended") return <Badge tone="warning">Suspended</Badge>;
  return <Badge tone="attention">Provisioning</Badge>;
}

export default function Index() {
  const data = useLoaderData<typeof loader>();
  return (
    <Page>
      <TitleBar title="Busymate AI" />
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineGrid columns="1fr auto" alignItems="center">
                <Text as="h2" variant="headingMd">
                  Your AI assistant
                </Text>
                {stateBadge(data.provisionState)}
              </InlineGrid>
              <Text as="p" variant="bodyMd" tone="subdued">
                Busymate AI adds <strong>bro</strong>, your store&apos;s own AI
                assistant, to your storefront. bro answers only from your own
                products &amp; policies, in 14 languages, and can take real order
                actions with your confirmation.
              </Text>
              {data.provisionError ? (
                <Box
                  background="bg-surface-critical"
                  padding="300"
                  borderRadius="200"
                >
                  <Text as="p" tone="critical">
                    Provisioning error: {data.provisionError}. Retry from the
                    Connector &amp; data page.
                  </Text>
                </Box>
              ) : null}
              <Text as="p" variant="bodyMd">
                Serving host:{" "}
                <Link url={`https://${data.servingHost}`} target="_blank">
                  {data.servingHost}
                </Link>
              </Text>
              <Button
                variant="primary"
                url={`https://${data.servingHost}`}
                target="_blank"
              >
                Open assistant
              </Button>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <BlockStack gap="400">
            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">
                  Connector
                </Text>
                <Text as="p" tone="subdued">
                  {data.connectorReady
                    ? "Shopify Admin connector registered — order-aware tools available."
                    : "Not yet registered."}
                </Text>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">
                  Billing
                </Text>
                <Text as="p" tone="subdued">
                  Pay per resolution, capped. Status: {data.billingStatus}. The
                  widget is never disabled at the cap.
                </Text>
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

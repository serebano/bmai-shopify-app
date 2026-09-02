import { Banner, BlockStack, Layout, Page, Text } from "@shopify/polaris";
import { isRouteErrorResponse, useNavigate, useRouteError } from "react-router";
import { describeTransportError } from "../lib/clientAction";

/**
 * In-frame recovery for a child route of /app (#retrain-500, part 2).
 *
 * Without a route-level boundary, ANY client-side error on a page — a failed
 * loader revalidation after an action, a render error — bubbles to the root
 * ErrorBoundary, which replaces the whole embedded document with the branded
 * "500 Something went wrong" page (the app nav disappears, the merchant is
 * stranded). This boundary keeps the merchant INSIDE the app shell: the NavMenu
 * stays, the message is merchant-facing, and "Try again" re-runs the route's
 * loaders client-side (which clears the error on success).
 *
 * Thrown Responses / route error responses are CONTROL FLOW — Shopify's
 * session-token bounce (rendered by `boundary.error` in app.tsx), redirects, a
 * 404 — and are re-thrown so the parent boundaries handle them exactly as before.
 *
 * Every `app/routes/app.*.tsx` child route exports `ErrorBoundary = AppRouteBoundary`
 * (test/clientAction.test.ts derives that list from the live route files).
 */
export interface AppRouteErrorViewProps {
  message: string;
  onRetry?: () => void;
}

/** Pure view (testable with renderToStaticMarkup). */
export function AppRouteErrorView({ message, onRetry }: AppRouteErrorViewProps) {
  return (
    <Page>
      <Layout>
        <Layout.Section>
          <Banner title="Something went wrong" tone="critical" action={onRetry ? { content: "Try again", onAction: onRetry } : undefined}>
            <BlockStack gap="200">
              <Text as="p">{message}</Text>
              <Text as="p" tone="subdued">
                Your store and the assistant keep working while this page recovers. Use the menu on the left to
                open another page, or try again.
              </Text>
            </BlockStack>
          </Banner>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

export function AppRouteBoundary() {
  const error = useRouteError();
  const navigate = useNavigate();
  if (error instanceof Response || isRouteErrorResponse(error)) throw error;
  return <AppRouteErrorView message={describeTransportError(error)} onRetry={() => navigate(".", { replace: true })} />;
}

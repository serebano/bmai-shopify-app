import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { AppProvider as PolarisAppProvider } from "@shopify/polaris";
import enPolarisTranslations from "@shopify/polaris/locales/en.json";
import { NavMenu } from "@shopify/app-bridge-react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import { authenticate } from "../shopify.server";
import { PolarisLink } from "../components/PolarisLink";
import { EmbeddedNavigationContext } from "../components/EmbeddedNavigation";
import { embeddedAppUrl, embeddedNavigationForShop } from "../lib/embeddedNavigation";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  return { apiKey: process.env.SHOPIFY_API_KEY || "", navigation: embeddedNavigationForShop(session.shop) };
};

export default function App() {
  const { apiKey, navigation } = useLoaderData<typeof loader>();
  return (
    <AppProvider apiKey={apiKey}>
      <EmbeddedNavigationContext.Provider value={navigation}>
      {/* linkComponent: Polaris <Link url>/<Button url> must stay client-side inside the
          admin iframe (app/components/PolarisLink.tsx) — a raw anchor reloads a bare URL
          the embedded auth cannot serve. */}
      <PolarisAppProvider i18n={enPolarisTranslations} linkComponent={PolarisLink}>
        <NavMenu>
          <Link to={embeddedAppUrl("/app", navigation)} rel="home">
            Home
          </Link>
          <Link to={embeddedAppUrl("/app/conversations", navigation)}>Conversations</Link>
          <Link to={embeddedAppUrl("/app/settings", navigation)}>Assistant settings</Link>
          <Link to={embeddedAppUrl("/app/connector", navigation)}>Store connection</Link>
          <Link to={embeddedAppUrl("/app/billing", navigation)}>Billing</Link>
        </NavMenu>
        <Outlet />
      </PolarisAppProvider>
      </EmbeddedNavigationContext.Provider>
    </AppProvider>
  );
}

// Shopify needs Response headers on thrown boundaries to keep the app embedded.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (args) => boundary.headers(args);

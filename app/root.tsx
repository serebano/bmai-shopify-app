import { Links, Meta, Outlet, Scripts, ScrollRestoration, useLoaderData } from "react-router";

// Expose the Shopify API key so App Bridge can initialize from the document head.
export const loader = () => ({ apiKey: process.env.SHOPIFY_API_KEY || "" });

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();
  return (
    <html lang="en">
      <head>
        {/*
          App Bridge (v4) MUST be the FIRST script in <head> for embedded apps —
          @shopify/app-bridge-react hooks are a thin layer over this global, and
          Built-for-Shopify checks that it loads from the Shopify CDN before any
          other script. data-api-key initializes it.
        */}
        <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js" data-api-key={apiKey} />
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <Meta />
        <Links />
      </head>
      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

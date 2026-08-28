import type { Config } from "@react-router/dev/config";

// Embedded Shopify admin app: server-rendered (SSR on), no static prerender —
// every route is shop-session-scoped. React Router 7 replaces Remix here
// (Remix merged into RR7; @shopify/shopify-app-react-router is the current path).
export default {
  ssr: true,
  future: {
    unstable_optimizeDeps: true,
  },
} satisfies Config;

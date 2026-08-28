import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

// The Shopify CLI (`shopify app dev`) fronts this with a tunnel; HMR runs over
// the tunnel host. See https://shopify.dev/docs/api/shopify-app-react-router
const host = new URL(process.env.SHOPIFY_APP_URL || "https://localhost").hostname;
const hmrConfig =
  host === "localhost"
    ? { protocol: "ws", host: "localhost", port: 64999, clientPort: 64999 }
    : { protocol: "wss", host, port: Number(process.env.FRONTEND_PORT) || 8002, clientPort: 443 };

export default defineConfig({
  server: {
    allowedHosts: [host],
    port: Number(process.env.PORT) || 3000,
    hmr: hmrConfig,
    fs: { allow: ["app", "node_modules"] },
  },
  plugins: [reactRouter(), tsconfigPaths()],
  build: { assetsInlineLimit: 0 },
});

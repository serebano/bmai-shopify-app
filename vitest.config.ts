import { defineConfig } from "vitest/config";

// Unit tests import via relative paths (../app/...), so the `~/*` tsconfig alias
// is not needed here. Keeping vite-tsconfig-paths out of the vitest config also
// avoids a vite major-version type skew between the app's vite and vitest's.
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts", "app/**/*.test.ts"],
  },
});

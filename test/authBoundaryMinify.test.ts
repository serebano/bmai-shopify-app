import { build } from "esbuild";
import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import config from "../vite.config";
import type { UserConfig } from "vite";

/** Execute the installed Router + Shopify boundary after real client minification.
 * Ordinary unminified unit/SSR tests missed this hydration-only failure. */
async function bundleBoundary(keepNames: boolean | undefined) {
  const result = await build({
    stdin: {
      contents: `
        import { UNSAFE_ErrorResponseImpl } from 'react-router';
        import { errorBoundary } from './node_modules/@shopify/shopify-app-react-router/dist/esm/server/boundary/error.mjs';
        const response = new UNSAFE_ErrorResponseImpl(200, '', '<script>fixture recovery</script>', false);
        let recovered = false;
        try { recovered = errorBoundary(response).props.dangerouslySetInnerHTML.__html === response.data; } catch {}
        let unknownRethrown = false;
        const unknown = new Error('unrelated failure');
        try { errorBoundary(unknown); } catch (e) { unknownRethrown = e === unknown; }
        globalThis.result = { recovered, unknownRethrown };
      `,
      resolveDir: process.cwd(),
    },
    bundle: true, minify: true, keepNames, platform: "browser", format: "iife", write: false,
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const context = { TextEncoder, TextDecoder, result: undefined };
  runInNewContext(result.outputFiles[0].text, context);
  return context.result;
}

it("preserves Shopify session recovery through the configured production minifier", async () => {
  const options = (config as UserConfig).esbuild;
  const keepNames = options && typeof options === "object" ? options.keepNames : undefined;
  expect(await bundleBoundary(keepNames)).toEqual({ recovered: true, unknownRethrown: true });
});

it("reproduces the old broken recovery when constructor names are minified", async () => {
  expect(await bundleBoundary(false)).toEqual({ recovered: false, unknownRethrown: true });
});

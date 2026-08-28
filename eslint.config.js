// Flat ESLint config (ESLint 9). Lean, but with the TypeScript parser wired so
// .ts/.tsx actually lint (type annotations, `import type`, `as`, JSX). Extend with
// more @typescript-eslint / react-hooks rules as the app grows.
import js from "@eslint/js";
import tseslint from "typescript-eslint";

// Node runtime globals shared by the .ts/.tsx app code and the .mjs Node scripts.
const nodeGlobals = {
  console: "readonly",
  process: "readonly",
  fetch: "readonly",
  crypto: "readonly",
  Response: "readonly",
  Request: "readonly",
  Buffer: "readonly",
  URL: "readonly",
  URLSearchParams: "readonly",
  setTimeout: "readonly",
};

export default [
  {
    ignores: [
      "build/**",
      ".react-router/**",
      ".shopify/**", // Shopify CLI generated deploy bundle (gitignored, not source)
      "node_modules/**",
      "extensions/**/assets/**",
    ],
  },
  js.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: 2022,
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: nodeGlobals,
    },
    plugins: { "@typescript-eslint": tseslint.plugin },
    rules: {
      // TypeScript itself covers undefined-symbol + type-only-import usage; the
      // core rules misfire on type positions, so defer to the TS-aware ones.
      "no-undef": "off",
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // Node ESM scripts (e.g. scripts/*.mjs) — plain JS with Node runtime globals.
    files: ["**/*.mjs", "scripts/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: nodeGlobals,
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
];

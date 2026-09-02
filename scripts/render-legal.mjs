#!/usr/bin/env node
/**
 * Render docs/legal/*.md → the HTML pages nginx serves at
 * https://store.busymate.ai/legal/{privacy,faq,terms}.
 *
 *   node scripts/render-legal.mjs --out /var/www/bmai-legal   # on the host
 *   node scripts/render-legal.mjs --out ./build/legal          # local preview
 *
 * Exit 0 after writing every page; any read/render error exits 1 (a page must
 * never be silently skipped — the listing links to all three).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderAllLegal } from "./lib/render-legal.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const i = process.argv.indexOf("--out");
const outDir = i >= 0 && process.argv[i + 1] ? resolve(process.argv[i + 1]) : join(ROOT, "build", "legal");

try {
  mkdirSync(outDir, { recursive: true });
  for (const page of renderAllLegal(ROOT)) {
    const file = join(outDir, page.out);
    writeFileSync(file, page.html, "utf8");
    console.log(`wrote ${file} (${page.html.length} bytes) ← docs/legal/${page.file} → ${page.route}`);
  }
} catch (e) {
  console.error(`render-legal failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Theme app extension i18n (i18n-EVERYWHERE, HARD). The launcher label, its
 * aria-label/title and the Theme-editor schema strings must come from
 * `locales/*.json` (storefront strings via the `| t` filter) and
 * `locales/*.schema.json` (editor strings via `t:` keys) across all 14 Tier-1
 * locales — the locale files were dead code before this test. Developer-only
 * settings (serving origin / assistant slug) must not be merchant-editable.
 */
const EXT = join(process.cwd(), "extensions", "storefront-assistant");
const LOCALES_DIR = join(EXT, "locales");
const LIQUID = readFileSync(join(EXT, "blocks", "assistant.liquid"), "utf8");
const ASSET = readFileSync(join(EXT, "assets", "assistant.js"), "utf8");

// Shopify extension locale codes for the 14 Tier-1 locales (zh-Hans → zh-CN).
const TIER1 = ["en.default", "es", "pt-BR", "fr", "de", "it", "ru", "ro", "tr", "ar", "zh-CN", "hi", "ja", "ko"];
const STOREFRONT_KEYS = ["launcher_label", "launcher_aria_label", "launcher_title", "assistant_name"];

function schema(): { name: string; settings: Array<{ id: string; label: string; info?: string }> } {
  const m = LIQUID.match(/\{%\s*schema\s*%\}([\s\S]*?)\{%\s*endschema\s*%\}/);
  expect(m, "assistant.liquid has a {% schema %} block").not.toBeNull();
  return JSON.parse(m![1]);
}

function flatKeys(obj: unknown, prefix = ""): string[] {
  if (!obj || typeof obj !== "object") return [prefix];
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
    typeof v === "object" && v ? flatKeys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

describe("storefront strings come from the locale files", () => {
  it("all 14 storefront locale files exist with the same keys and non-empty values", () => {
    for (const code of TIER1) {
      const file = join(LOCALES_DIR, `${code}.json`);
      const json = JSON.parse(readFileSync(file, "utf8")) as Record<string, string>;
      expect(Object.keys(json).sort(), `${code}.json keys`).toEqual([...STOREFRONT_KEYS].sort());
      for (const k of STOREFRONT_KEYS) expect(json[k]?.trim(), `${code}.json ${k}`).toBeTruthy();
    }
  });

  it("the liquid block reads label/aria/title through the `t` filter (no hard-coded English)", () => {
    expect(LIQUID).toMatch(/'launcher_label'\s*\|\s*t\b/);
    expect(LIQUID).toMatch(/'launcher_aria_label'\s*\|\s*t\b/);
    expect(LIQUID).toMatch(/'launcher_title'\s*\|\s*t\b/);
    expect(LIQUID).not.toMatch(/default:\s*'Ask us'/);
    expect(LIQUID).toMatch(/data-aria-label=/);
    expect(LIQUID).toMatch(/data-title=/);
  });

  it("the mount script forwards the localized aria-label + title to the embed", () => {
    expect(ASSET).toMatch(/data-aria-label/);
    expect(ASSET).toMatch(/data-title/);
  });
});

describe("Theme-editor schema strings are translated (t: keys) and merchant-safe", () => {
  it("schema name + every setting label/info are t: keys", () => {
    const s = schema();
    expect(s.name).toMatch(/^t:/);
    for (const setting of s.settings) {
      expect(setting.label, `${setting.id}.label`).toMatch(/^t:/);
      if (setting.info) expect(setting.info, `${setting.id}.info`).toMatch(/^t:/);
    }
  });

  it("developer-only settings (serving origin, assistant slug) are not merchant-editable", () => {
    const ids = schema().settings.map((s) => s.id);
    expect(ids).not.toContain("origin");
    expect(ids).not.toContain("assistant_slug");
    expect(ids).toContain("launcher_label");
  });

  it("all 14 schema locale files exist and resolve every t: key used by the schema", () => {
    const s = schema();
    const used = [s.name, ...s.settings.flatMap((x) => [x.label, x.info].filter(Boolean) as string[])].map((k) => k.slice(2));
    for (const code of TIER1) {
      const file = join(LOCALES_DIR, `${code}.schema.json`);
      const json = JSON.parse(readFileSync(file, "utf8"));
      const keys = flatKeys(json);
      for (const k of used) expect(keys, `${code}.schema.json resolves ${k}`).toContain(k);
    }
  });

  it("there are exactly 14 storefront + 14 schema locale files (no strays)", () => {
    const files = readdirSync(LOCALES_DIR);
    expect(files.filter((f) => f.endsWith(".schema.json"))).toHaveLength(14);
    expect(files.filter((f) => f.endsWith(".json") && !f.endsWith(".schema.json"))).toHaveLength(14);
  });
});

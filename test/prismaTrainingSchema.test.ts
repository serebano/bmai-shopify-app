import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Training state (#2110 grounding): the install lifecycle, the products webhook
 * and the "Re-train" button persist what the assistant was trained on (counts,
 * time, last error) on ShopTenant, and Home / Store connection render it. The
 * columns must exist in the schema AND in a committed additive migration.
 */
const root = join(__dirname, "..");
const schema = readFileSync(join(root, "prisma/schema.prisma"), "utf8");
const model = schema.match(/model ShopTenant \{([\s\S]*?)\n\}/)?.[1] ?? "";

const migrationsDir = join(root, "prisma/migrations");
const migrations = readdirSync(migrationsDir)
  .filter((d) => /^\d{14}_/.test(d))
  .map((d) => ({ name: d, sql: readFileSync(join(migrationsDir, d, "migration.sql"), "utf8") }));

const COLUMNS: Array<[string, string, string]> = [
  ["kbTrainedAt", "DateTime\\?", 'TIMESTAMP\\(3\\)'],
  ["kbError", "String\\?", "TEXT"],
  ["kbProducts", "Int\\?", "INTEGER"],
  ["kbPolicies", "Int\\?", "INTEGER"],
  ["kbPages", "Int\\?", "INTEGER"],
  ["kbChars", "Int\\?", "INTEGER"],
  ["kbTruncated", "Boolean\\?", "BOOLEAN"],
  ["kbProductsTotal", "Int\\?", "INTEGER"],
  ["kbPagesTotal", "Int\\?", "INTEGER"],
];

describe("prisma ShopTenant model — training columns", () => {
  it.each(COLUMNS)("declares %s %s", (name, type) => {
    expect(model).toMatch(new RegExp(`^\\s*${name}\\s+${type}`, "m"));
  });

  it("has exactly one additive migration adding every training column to \"ShopTenant\"", () => {
    const adding = migrations.filter(
      (m) => /ALTER TABLE "ShopTenant"/.test(m.sql) && COLUMNS.every(([name, , sql]) => new RegExp(`ADD COLUMN\\s+"${name}"\\s+${sql}`).test(m.sql)),
    );
    expect(adding.map((m) => m.name)).toHaveLength(1);
    expect(adding[0].sql).not.toMatch(/DROP|NOT NULL|UPDATE "ShopTenant"/);
  });
});

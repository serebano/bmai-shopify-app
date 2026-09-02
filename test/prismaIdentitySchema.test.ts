import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * #2132 FAIL A — the lifecycle persists the registered visitor identity provider
 * id (idempotent re-target) and the "not live yet" assignment warning on
 * ShopTenant. Both must exist in the schema AND in a committed additive migration.
 */
const root = join(__dirname, "..");
const schema = readFileSync(join(root, "prisma/schema.prisma"), "utf8");
const model = schema.match(/model ShopTenant \{([\s\S]*?)\n\}/)?.[1] ?? "";
const migrations = readdirSync(join(root, "prisma/migrations"))
  .filter((d) => /^\d{14}_/.test(d))
  .map((d) => ({ name: d, sql: readFileSync(join(root, "prisma/migrations", d, "migration.sql"), "utf8") }));

const COLUMNS: Array<[string, string]> = [
  ["identityProviderId", "TEXT"],
  ["provisionWarning", "TEXT"],
];

describe("prisma ShopTenant model — identity provider + assignment warning columns (#2132)", () => {
  it.each(COLUMNS)("declares %s String?", (name) => {
    expect(model).toMatch(new RegExp(`^\\s*${name}\\s+String\\?`, "m"));
  });
  it("has exactly one additive migration adding both columns", () => {
    const adding = migrations.filter(
      (m) => /ALTER TABLE "ShopTenant"/.test(m.sql) && COLUMNS.every(([name, sql]) => new RegExp(`ADD COLUMN\\s+"${name}"\\s+${sql}`).test(m.sql)),
    );
    expect(adding.map((m) => m.name)).toEqual(["20260902210000_shop_tenant_identity_provider"]);
  });
});

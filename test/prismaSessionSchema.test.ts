import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Expiring offline tokens (#2110): @shopify/shopify-app-session-storage-prisma
 * ≥10 writes `refreshToken` / `refreshTokenExpires` on EVERY storeSession and
 * reads them back — the columns must exist in the Prisma schema AND in a
 * committed migration BEFORE the future flag goes live, or the first token
 * exchange after deploy fails on an unknown column.
 */
const root = join(__dirname, "..");
const schema = readFileSync(join(root, "prisma/schema.prisma"), "utf8");
const sessionModel = schema.match(/model Session \{([\s\S]*?)\n\}/)?.[1] ?? "";

const migrationsDir = join(root, "prisma/migrations");
const migrations = readdirSync(migrationsDir)
  .filter((d) => /^\d{14}_/.test(d))
  .map((d) => ({ name: d, sql: readFileSync(join(migrationsDir, d, "migration.sql"), "utf8") }));

describe("prisma Session model — refresh-token columns", () => {
  it("declares refreshToken String? and refreshTokenExpires DateTime?", () => {
    expect(sessionModel).toMatch(/^\s*refreshToken\s+String\?/m);
    expect(sessionModel).toMatch(/^\s*refreshTokenExpires\s+DateTime\?/m);
  });

  it("has exactly one migration adding both columns to \"Session\"", () => {
    const adding = migrations.filter(
      (m) =>
        /ALTER TABLE "Session"/.test(m.sql) &&
        /ADD COLUMN\s+"refreshToken"\s+TEXT/.test(m.sql) &&
        /ADD COLUMN\s+"refreshTokenExpires"\s+TIMESTAMP\(3\)/.test(m.sql),
    );
    expect(adding.map((m) => m.name)).toHaveLength(1);
  });

  it("the migration is additive (nullable, no drops, no rewrites)", () => {
    const m = migrations.find((x) => /"refreshTokenExpires"/.test(x.sql))!;
    expect(m.sql).not.toMatch(/DROP|NOT NULL|UPDATE "Session"/);
  });
});

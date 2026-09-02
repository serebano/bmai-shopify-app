-- Expiring offline access tokens (#2110): @shopify/shopify-app-session-storage-prisma
-- >=10 persists the refresh token and its expiry next to the (now 1-hour) access
-- token. Additive and nullable: existing rows keep loading until they are cycled
-- by scripts/cycle-offline-tokens.ts.

-- AlterTable
ALTER TABLE "Session" ADD COLUMN "refreshToken" TEXT,
ADD COLUMN "refreshTokenExpires" TIMESTAMP(3);

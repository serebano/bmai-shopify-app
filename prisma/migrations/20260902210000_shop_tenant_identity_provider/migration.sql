-- #2132 FAIL A — the lifecycle registers this host as the tenant's visitor
-- identity provider (launch JWT issuer) and proves the connector + provider are
-- ASSIGNED in the published revision. Persist the provider id (idempotent
-- re-target on every run) and the merchant-facing "not live yet" warning.
-- Additive and nullable.

-- AlterTable
ALTER TABLE "ShopTenant" ADD COLUMN "identityProviderId" TEXT,
ADD COLUMN "provisionWarning" TEXT;

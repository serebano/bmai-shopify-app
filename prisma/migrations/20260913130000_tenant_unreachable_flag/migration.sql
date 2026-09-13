-- Edge-triggered "this shop's bmai tenant is unreachable" flag (#19/#2835):
-- set once when the resolution meter's MCP reads are refused with
-- tenant_management_denied (a deprovisioned/archived tenant), cleared once on
-- recovery. Lets the ledger log once per transition instead of every run.
ALTER TABLE "ShopTenant" ADD COLUMN "tenantUnreachableAt" TIMESTAMPTZ;

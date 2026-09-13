-- AI-resolution ledger (#19/#2835): one row per (tenant, conversation) ever
-- counted as billable. `@@unique([tenantId, sessionId])` is the idempotency
-- boundary the producer (app/lib/resolutionLedger.server.ts) relies on — a
-- re-scan of the same recent-conversations window can never double-insert the
-- same conversation. Keyed by the bmai tenantId, not shop (no FK: a tenant can
-- outlive/predate the local ShopTenant row during reactivation cycles).
CREATE TABLE "MeteredResolution" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "occurredAt" TIMESTAMPTZ NOT NULL,
  "countedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("tenantId", "sessionId")
);
CREATE INDEX "MeteredResolution_tenantId_countedAt_idx" ON "MeteredResolution"("tenantId", "countedAt");

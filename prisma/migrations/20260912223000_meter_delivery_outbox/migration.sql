-- Internal, unwired delivery foundation. Acceptance is ingestion, not billing.
CREATE TABLE "MeterDelivery" (
  "id" TEXT PRIMARY KEY,
  "shop" TEXT NOT NULL REFERENCES "BillingState"("shop") ON DELETE CASCADE,
  "payloadHash" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'pending' CHECK ("state" IN ('pending','accepted','reconciliation')),
  "leaseToken" TEXT,
  "leaseUntil" TIMESTAMPTZ,
  "acceptedAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("shop", "payloadHash")
);
CREATE UNIQUE INDEX "MeterDelivery_one_pending_shop" ON "MeterDelivery"("shop") WHERE "state" <> 'accepted';
CREATE FUNCTION meter_delivery_payload_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."shop" IS DISTINCT FROM OLD."shop"
    OR NEW."payloadHash" IS DISTINCT FROM OLD."payloadHash" OR NEW."payload" IS DISTINCT FROM OLD."payload" THEN
    RAISE EXCEPTION 'meter delivery payload is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER meter_delivery_payload_immutable BEFORE UPDATE ON "MeterDelivery"
  FOR EACH ROW EXECUTE FUNCTION meter_delivery_payload_immutable();

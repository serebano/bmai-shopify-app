-- Training state (#2110 grounding): the install lifecycle, the products webhook
-- re-ingest and the "Re-train on my store" button persist what the assistant was
-- trained on (publish_tenant_runtime.knowledge_sources) so Home / Store connection
-- can say "Trained on N products, M policies, K pages" or surface the last error.
-- Additive and nullable: NULL = never trained.

-- AlterTable
ALTER TABLE "ShopTenant" ADD COLUMN "kbTrainedAt" TIMESTAMP(3),
ADD COLUMN "kbError" TEXT,
ADD COLUMN "kbProducts" INTEGER,
ADD COLUMN "kbPolicies" INTEGER,
ADD COLUMN "kbPages" INTEGER,
ADD COLUMN "kbChars" INTEGER,
ADD COLUMN "kbTruncated" BOOLEAN,
ADD COLUMN "kbProductsTotal" INTEGER,
ADD COLUMN "kbPagesTotal" INTEGER;

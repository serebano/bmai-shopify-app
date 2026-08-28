-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopTenant" (
    "shop" TEXT NOT NULL,
    "bmaiTenantId" TEXT,
    "slug" TEXT,
    "connectorId" TEXT,
    "provisionState" TEXT NOT NULL DEFAULT 'pending',
    "provisionError" TEXT,
    "customDomain" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopTenant_pkey" PRIMARY KEY ("shop")
);

-- CreateTable
CREATE TABLE "BillingState" (
    "shop" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "plan" TEXT NOT NULL DEFAULT 'starter',
    "status" TEXT NOT NULL DEFAULT 'inactive',
    "usageLineItemId" TEXT,
    "cappedAmountCents" INTEGER NOT NULL DEFAULT 5000,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "lastMeteredCursor" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingState_pkey" PRIMARY KEY ("shop")
);

-- CreateTable
CREATE TABLE "LaunchKey" (
    "kid" TEXT NOT NULL,
    "publicJwk" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LaunchKey_pkey" PRIMARY KEY ("kid")
);

-- CreateIndex
CREATE INDEX "Session_shop_idx" ON "Session"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "ShopTenant_slug_key" ON "ShopTenant"("slug");

-- AddForeignKey
ALTER TABLE "BillingState" ADD CONSTRAINT "BillingState_shop_fkey" FOREIGN KEY ("shop") REFERENCES "ShopTenant"("shop") ON DELETE CASCADE ON UPDATE CASCADE;


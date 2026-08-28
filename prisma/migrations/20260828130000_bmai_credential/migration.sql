-- Durable Busymate AI provisioning OAuth refresh credential.
-- The refresh token rotates on every use, so the current value is persisted here.
-- CreateTable
CREATE TABLE "BmaiCredential" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BmaiCredential_pkey" PRIMARY KEY ("id")
);

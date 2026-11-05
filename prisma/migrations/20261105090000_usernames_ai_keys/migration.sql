-- Usernames and admin-managed AI keys: additive (a nullable column, two tables).
-- AlterTable
ALTER TABLE "User" ADD COLUMN "username" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateTable
CREATE TABLE "AiKey" (
    "id" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "businessId" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'gemini',
    "model" TEXT,
    "keyEncrypted" TEXT NOT NULL,
    "last4" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiKeyEvent" (
    "id" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "businessId" TEXT,
    "action" TEXT NOT NULL,
    "ok" BOOLEAN,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiKeyEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiKey_scopeKey_key" ON "AiKey"("scopeKey");

-- CreateIndex
CREATE INDEX "AiKey_businessId_idx" ON "AiKey"("businessId");

-- CreateIndex
CREATE INDEX "AiKeyEvent_scopeKey_createdAt_idx" ON "AiKeyEvent"("scopeKey", "createdAt");

-- AddForeignKey
ALTER TABLE "AiKey" ADD CONSTRAINT "AiKey_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

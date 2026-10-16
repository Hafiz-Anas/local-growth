-- Instagram account switching: one login, several Instagram accounts (each its own Business).
-- Additive: User.businessId stays and now means "the active account"; BusinessMember lists
-- every account a login can switch to. Every existing user keeps their current business.

-- AlterEnum
ALTER TYPE "BusinessSource" ADD VALUE 'ACCOUNT_ADDED';

-- CreateTable
CREATE TABLE "BusinessMember" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusinessMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BusinessMember_businessId_idx" ON "BusinessMember"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessMember_userId_businessId_key" ON "BusinessMember"("userId", "businessId");

-- AddForeignKey
ALTER TABLE "BusinessMember" ADD CONSTRAINT "BusinessMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessMember" ADD CONSTRAINT "BusinessMember_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: each user with a business becomes a member of it (that business stays active).
INSERT INTO "BusinessMember" ("id", "userId", "businessId", "createdAt")
SELECT 'bm_' || u."id", u."id", u."businessId", u."createdAt"
FROM "User" u
WHERE u."businessId" IS NOT NULL
ON CONFLICT ("userId", "businessId") DO NOTHING;

-- Notifications are per account: one live row per (user, account, subject).
-- The new unique index is wider than the old one, so existing rows already satisfy it.
CREATE UNIQUE INDEX "Notification_userId_businessId_dedupeKey_key" ON "Notification"("userId", "businessId", "dedupeKey");
CREATE INDEX "Notification_userId_businessId_createdAt_idx" ON "Notification"("userId", "businessId", "createdAt");
DROP INDEX "Notification_userId_dedupeKey_key";
DROP INDEX "Notification_userId_createdAt_idx";

-- Deleting one Instagram account must never delete a login that has others: the active account
-- link is cleared instead (the next request makes the user's oldest remaining account active).
ALTER TABLE "User" DROP CONSTRAINT "User_businessId_fkey";
ALTER TABLE "User" ADD CONSTRAINT "User_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- BE3 publishing jobs: additive only (new enum, new nullable/defaulted columns, two indexes). Existing rows keep working:
-- older Post Generator jobs have no frozen media and are converted when publishing starts.

-- CreateEnum
CREATE TYPE "PublishFormat" AS ENUM ('IMAGE', 'CAROUSEL');

-- AlterTable
ALTER TABLE "ScheduledPost" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedBy" TEXT,
ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "cancelledBy" TEXT,
ADD COLUMN     "caption" TEXT,
ADD COLUMN     "childContainerIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "containerId" TEXT,
ADD COLUMN     "format" "PublishFormat" NOT NULL DEFAULT 'IMAGE',
ADD COLUMN     "igUserId" TEXT,
ADD COLUMN     "leaseUntil" TIMESTAMP(3),
ADD COLUMN     "mediaKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "mediaUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "nextAttemptAt" TIMESTAMP(3),
ADD COLUMN     "permalink" TEXT,
ADD COLUMN     "publishCallAt" TIMESTAMP(3),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "verifyFirst" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "waitingReason" TEXT;

-- CreateIndex
CREATE INDEX "ScheduledPost_status_nextAttemptAt_idx" ON "ScheduledPost"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "ScheduledPost_draftId_status_idx" ON "ScheduledPost"("draftId", "status");


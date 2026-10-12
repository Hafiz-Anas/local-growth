-- AlterEnum
ALTER TYPE "ScheduledPostStatus" ADD VALUE 'PUBLISHING';

-- AlterTable
ALTER TABLE "PostDraft" ADD COLUMN     "publishError" TEXT;

-- AlterTable
ALTER TABLE "ScheduledPost" ADD COLUMN     "failureReason" TEXT,
ADD COLUMN     "publishStartedAt" TIMESTAMP(3),
ADD COLUMN     "publishedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "ScheduledPost_status_scheduledFor_idx" ON "ScheduledPost"("status", "scheduledFor");


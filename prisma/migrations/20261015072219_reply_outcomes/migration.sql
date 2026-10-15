-- CreateEnum
CREATE TYPE "ReplyOutcome" AS ENUM ('AS_IS', 'EDITED', 'MANUAL');

-- AlterEnum
ALTER TYPE "ReplyDraftStatus" ADD VALUE 'UNAVAILABLE';

-- AlterTable
ALTER TABLE "ReplyDraft" ADD COLUMN     "aiReply" TEXT,
ADD COLUMN     "outcome" "ReplyOutcome",
ADD COLUMN     "regenerations" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "sentAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "ReplyDraft_businessId_status_sentAt_idx" ON "ReplyDraft"("businessId", "status", "sentAt");

-- Existing drafts: what is waiting now is what the AI (or the rule) proposed. Replies sent before
-- this migration have no outcome (unknown) and aren't counted in the "sent as-is" figures.
UPDATE "ReplyDraft" SET "aiReply" = "draftReply" WHERE "aiReply" IS NULL AND "status" = 'PENDING';

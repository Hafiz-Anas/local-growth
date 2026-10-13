-- Keyword replies: rules get a public reply, match type, post scope and "send automatically";
-- KeywordReplyTrigger records every comment a rule picked up (dedupe, cooldown, outcome).
-- Additive only: existing rules keep their DM text, need approval (autoSend = false) and only answer new comments.


-- CreateEnum
CREATE TYPE "KeywordMatchType" AS ENUM ('WORD', 'EXACT');

-- CreateEnum
CREATE TYPE "KeywordRuleScope" AS ENUM ('ALL_POSTS', 'SELECTED_POSTS');

-- CreateEnum
CREATE TYPE "KeywordTriggerStatus" AS ENUM ('SENDING', 'AWAITING_APPROVAL', 'SENT', 'PARTIAL', 'FAILED', 'COOLDOWN', 'DISMISSED');

-- AlterTable
ALTER TABLE "EngagementRule" ADD COLUMN     "autoSend" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "commentReply" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "lastTriggeredAt" TIMESTAMP(3),
ADD COLUMN     "matchType" "KeywordMatchType" NOT NULL DEFAULT 'WORD',
ADD COLUMN     "mediaIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "scope" "KeywordRuleScope" NOT NULL DEFAULT 'ALL_POSTS';

-- Rules that existed before this migration were added with autoSend = false above (they never
-- sent anything; they must not start sending DMs on deploy — replies wait for approval). New
-- rules default to sending automatically.
ALTER TABLE "EngagementRule" ALTER COLUMN "autoSend" SET DEFAULT true;

-- AlterTable
ALTER TABLE "ReplyDraft" ADD COLUMN     "commentedAt" TIMESTAMP(3),
ADD COLUMN     "privateReply" TEXT,
ADD COLUMN     "ruleId" TEXT;

-- CreateTable
CREATE TABLE "KeywordReplyTrigger" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "ruleId" TEXT,
    "igCommentId" TEXT NOT NULL,
    "igMediaId" TEXT,
    "commenterKey" TEXT NOT NULL,
    "commenterUsername" TEXT,
    "commentText" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "status" "KeywordTriggerStatus" NOT NULL DEFAULT 'SENDING',
    "replyCommentId" TEXT,
    "dmMessageId" TEXT,
    "failureReason" TEXT,
    "commentedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KeywordReplyTrigger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KeywordReplyTrigger_businessId_ruleId_commenterKey_createdA_idx" ON "KeywordReplyTrigger"("businessId", "ruleId", "commenterKey", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "KeywordReplyTrigger_businessId_igCommentId_key" ON "KeywordReplyTrigger"("businessId", "igCommentId");

-- AddForeignKey
ALTER TABLE "KeywordReplyTrigger" ADD CONSTRAINT "KeywordReplyTrigger_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KeywordReplyTrigger" ADD CONSTRAINT "KeywordReplyTrigger_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "EngagementRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplyDraft" ADD CONSTRAINT "ReplyDraft_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "EngagementRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

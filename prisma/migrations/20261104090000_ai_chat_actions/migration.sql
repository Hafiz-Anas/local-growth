-- AI tab actions (AI4): additive, a new table and two enums.
-- CreateEnum
CREATE TYPE "AiChatActionType" AS ENUM ('SAVE_DRAFT', 'SCHEDULE', 'POST_NOW', 'RESCHEDULE', 'CANCEL');

-- CreateEnum
CREATE TYPE "AiChatActionStatus" AS ENUM ('PROPOSED', 'RUNNING', 'DONE', 'FAILED', 'EXPIRED', 'CANCELLED');

-- CreateTable
CREATE TABLE "AiChatAction" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "messageClientId" TEXT NOT NULL,
    "questionClientId" TEXT,
    "userId" TEXT,
    "decidedBy" TEXT,
    "type" "AiChatActionType" NOT NULL,
    "status" "AiChatActionStatus" NOT NULL,
    "input" JSONB NOT NULL,
    "draftId" TEXT,
    "scheduledPostId" TEXT,
    "result" JSONB,
    "errorCode" TEXT,
    "expiresAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiChatAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiChatAction_businessId_createdAt_idx" ON "AiChatAction"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "AiChatAction_conversationId_idx" ON "AiChatAction"("conversationId");

-- AddForeignKey
ALTER TABLE "AiChatAction" ADD CONSTRAINT "AiChatAction_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiChatAction" ADD CONSTRAINT "AiChatAction_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AssistantConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;


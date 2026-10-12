-- CreateEnum
CREATE TYPE "ReplyChannel" AS ENUM ('COMMENT', 'DM');

-- AlterEnum
ALTER TYPE "ReplyDraftStatus" ADD VALUE 'EXPIRED';

-- AlterTable
ALTER TABLE "InstagramConnection" ADD COLUMN     "webhookSubscribedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ReplyDraft" ADD COLUMN     "channel" "ReplyChannel" NOT NULL DEFAULT 'COMMENT',
ADD COLUMN     "lastMessageAt" TIMESTAMP(3),
ADD COLUMN     "recipientId" TEXT;

-- CreateTable
CREATE TABLE "InstagramDirectMessage" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "igMessageId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "customerUsername" TEXT,
    "fromBusiness" BOOLEAN NOT NULL DEFAULT false,
    "text" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InstagramDirectMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InstagramDirectMessage_businessId_customerId_sentAt_idx" ON "InstagramDirectMessage"("businessId", "customerId", "sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "InstagramDirectMessage_businessId_igMessageId_key" ON "InstagramDirectMessage"("businessId", "igMessageId");

-- CreateIndex
CREATE INDEX "ReplyDraft_businessId_channel_recipientId_status_idx" ON "ReplyDraft"("businessId", "channel", "recipientId", "status");

-- AddForeignKey
ALTER TABLE "InstagramDirectMessage" ADD CONSTRAINT "InstagramDirectMessage_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;


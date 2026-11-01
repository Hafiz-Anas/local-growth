-- AI tab chats saved in the database (AI2): the old assistant tables get the AI tab's fields. Additive only;
-- `mode` becomes optional (AI tab chats have none), nothing is dropped.

-- AlterTable
ALTER TABLE "Business" ADD COLUMN     "aiChatsSeededAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "AssistantConversation" ADD COLUMN     "clientKey" TEXT,
ADD COLUMN     "sample" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "titleAr" TEXT;

-- AlterTable
ALTER TABLE "AssistantMessage" ADD COLUMN     "clientId" TEXT,
ADD COLUMN     "payload" JSONB,
ALTER COLUMN "mode" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "AssistantConversation_businessId_clientKey_key" ON "AssistantConversation"("businessId", "clientKey");

-- CreateIndex
CREATE UNIQUE INDEX "AssistantMessage_conversationId_clientId_key" ON "AssistantMessage"("conversationId", "clientId");

-- CreateEnum
CREATE TYPE "InstagramProvider" AS ENUM ('MOCK', 'META');

-- AlterEnum
ALTER TYPE "ConnectionStatus" ADD VALUE 'NEEDS_RECONNECT';

-- AlterTable
ALTER TABLE "Competitor" ADD COLUMN     "profileCache" JSONB;

-- AlterTable
ALTER TABLE "InstagramConnection" ADD COLUMN     "credentialsEncrypted" TEXT,
ADD COLUMN     "dataAccessExpiresAt" TIMESTAMP(3),
ADD COLUMN     "igAccountKey" TEXT,
ADD COLUMN     "insights" JSONB,
ADD COLUMN     "lastSyncError" TEXT,
ADD COLUMN     "missingPermissions" TEXT[],
ADD COLUMN     "profile" JSONB,
ADD COLUMN     "provider" "InstagramProvider" NOT NULL DEFAULT 'MOCK',
ADD COLUMN     "syncStartedAt" TIMESTAMP(3),
ALTER COLUMN "igUserId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "InstagramMedia" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "igMediaId" TEXT NOT NULL,
    "caption" TEXT NOT NULL DEFAULT '',
    "mediaType" TEXT NOT NULL,
    "mediaProductType" TEXT,
    "mediaUrl" TEXT,
    "thumbnailUrl" TEXT,
    "permalink" TEXT,
    "postedAt" TIMESTAMP(3) NOT NULL,
    "likeCount" INTEGER NOT NULL DEFAULT 0,
    "commentsCount" INTEGER NOT NULL DEFAULT 0,
    "insights" JSONB NOT NULL DEFAULT '{}',
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InstagramMedia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstagramMediaComment" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "igCommentId" TEXT NOT NULL,
    "igMediaId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "likeCount" INTEGER NOT NULL DEFAULT 0,
    "postedAt" TIMESTAMP(3) NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InstagramMediaComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstagramAccountSnapshot" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "followers" INTEGER NOT NULL,
    "follows" INTEGER NOT NULL,
    "mediaCount" INTEGER NOT NULL,
    "takenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InstagramAccountSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetitorSnapshot" (
    "id" TEXT NOT NULL,
    "competitorId" TEXT NOT NULL,
    "followers" INTEGER NOT NULL,
    "mediaCount" INTEGER NOT NULL,
    "engagementRate" DOUBLE PRECISION NOT NULL,
    "takenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompetitorSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationEvent" (
    "id" TEXT NOT NULL,
    "businessId" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'meta',
    "level" TEXT NOT NULL DEFAULT 'error',
    "call" TEXT NOT NULL,
    "errorCode" TEXT,
    "message" TEXT NOT NULL,
    "httpStatus" INTEGER,
    "details" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntegrationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetaPendingConnection" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "returnTo" TEXT NOT NULL,
    "credentialsEncrypted" TEXT NOT NULL,
    "options" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MetaPendingConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InstagramMedia_businessId_postedAt_idx" ON "InstagramMedia"("businessId", "postedAt");

-- CreateIndex
CREATE UNIQUE INDEX "InstagramMedia_businessId_igMediaId_key" ON "InstagramMedia"("businessId", "igMediaId");

-- CreateIndex
CREATE INDEX "InstagramMediaComment_businessId_postedAt_idx" ON "InstagramMediaComment"("businessId", "postedAt");

-- CreateIndex
CREATE UNIQUE INDEX "InstagramMediaComment_businessId_igCommentId_key" ON "InstagramMediaComment"("businessId", "igCommentId");

-- CreateIndex
CREATE UNIQUE INDEX "InstagramAccountSnapshot_businessId_date_key" ON "InstagramAccountSnapshot"("businessId", "date");

-- CreateIndex
CREATE INDEX "CompetitorSnapshot_competitorId_takenAt_idx" ON "CompetitorSnapshot"("competitorId", "takenAt");

-- CreateIndex
CREATE INDEX "IntegrationEvent_businessId_createdAt_idx" ON "IntegrationEvent"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "IntegrationEvent_createdAt_idx" ON "IntegrationEvent"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MetaPendingConnection_businessId_key" ON "MetaPendingConnection"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "InstagramConnection_igAccountKey_key" ON "InstagramConnection"("igAccountKey");

-- AddForeignKey
ALTER TABLE "InstagramMedia" ADD CONSTRAINT "InstagramMedia_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstagramMediaComment" ADD CONSTRAINT "InstagramMediaComment_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstagramAccountSnapshot" ADD CONSTRAINT "InstagramAccountSnapshot_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitorSnapshot" ADD CONSTRAINT "CompetitorSnapshot_competitorId_fkey" FOREIGN KEY ("competitorId") REFERENCES "Competitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationEvent" ADD CONSTRAINT "IntegrationEvent_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetaPendingConnection" ADD CONSTRAINT "MetaPendingConnection_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- CreateEnum
CREATE TYPE "PostMethodSource" AS ENUM ('RULE', 'AI', 'USER');

-- AlterTable
ALTER TABLE "Competitor" ADD COLUMN     "lookupCheckedAt" TIMESTAMP(3),
ADD COLUMN     "lookupIssue" TEXT;

-- CreateTable
CREATE TABLE "CompetitorAnalysis" (
    "id" TEXT NOT NULL,
    "competitorId" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "insight" JSONB,
    "failureReason" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompetitorAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostSnapshot" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "igMediaId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "likes" INTEGER NOT NULL,
    "comments" INTEGER NOT NULL,
    "reach" INTEGER,
    "saves" INTEGER,
    "shares" INTEGER,
    "views" INTEGER,
    "takenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostMethod" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "igMediaId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "source" "PostMethodSource" NOT NULL,
    "promoted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PostMethod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostInsight" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "igMediaId" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "insight" JSONB NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostInsight_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CompetitorAnalysis_competitorId_key" ON "CompetitorAnalysis"("competitorId");

-- CreateIndex
CREATE INDEX "PostSnapshot_businessId_date_idx" ON "PostSnapshot"("businessId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "PostSnapshot_businessId_igMediaId_date_key" ON "PostSnapshot"("businessId", "igMediaId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "PostMethod_businessId_igMediaId_key" ON "PostMethod"("businessId", "igMediaId");

-- CreateIndex
CREATE UNIQUE INDEX "PostInsight_businessId_igMediaId_key" ON "PostInsight"("businessId", "igMediaId");

-- AddForeignKey
ALTER TABLE "CompetitorAnalysis" ADD CONSTRAINT "CompetitorAnalysis_competitorId_fkey" FOREIGN KEY ("competitorId") REFERENCES "Competitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostSnapshot" ADD CONSTRAINT "PostSnapshot_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostMethod" ADD CONSTRAINT "PostMethod_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostInsight" ADD CONSTRAINT "PostInsight_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- New feature keys, ON for every existing business (each plan includes them; a sub-feature
-- only takes effect when its module is ON, e.g. competitors.analysis needs competitors).
INSERT INTO "FeaturePermission" ("id", "businessId", "featureKey", "enabled")
SELECT gen_random_uuid()::text, b."id", k.key, true
FROM "Business" b CROSS JOIN (VALUES ('competitors.analysis'), ('postInsights'), ('methods')) AS k(key)
ON CONFLICT ("businessId", "featureKey") DO UPDATE SET "enabled" = true;

UPDATE "Business" SET "permissionsUpdatedAt" = CURRENT_TIMESTAMP;

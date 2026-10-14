-- AI strategy recommendations: runs (weekly cron / manual refresh, cached by input hash) and
-- recommendations with the owner's decision and the 7-day outcome. Additive, plus the
-- "recommendations" feature key ON for every existing business.

-- CreateEnum
CREATE TYPE "RecommendationTrigger" AS ENUM ('SCHEDULED', 'MANUAL');

-- CreateEnum
CREATE TYPE "RecommendationConfidence" AS ENUM ('STRONG', 'MODERATE', 'EARLY');

-- CreateEnum
CREATE TYPE "RecommendationStatus" AS ENUM ('NEW', 'ACCEPTED', 'DISMISSED', 'DONE');

-- CreateTable
CREATE TABLE "RecommendationRun" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "trigger" "RecommendationTrigger" NOT NULL,
    "inputHash" TEXT NOT NULL,
    "unchanged" BOOLEAN NOT NULL DEFAULT false,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecommendationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recommendation" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "actionEn" TEXT NOT NULL,
    "actionAr" TEXT NOT NULL,
    "rationaleEn" TEXT NOT NULL,
    "rationaleAr" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "confidence" "RecommendationConfidence" NOT NULL,
    "basedOnPosts" INTEGER NOT NULL,
    "status" "RecommendationStatus" NOT NULL DEFAULT 'NEW',
    "statusAt" TIMESTAMP(3),
    "statusBy" TEXT,
    "baseline" JSONB,
    "outcome" JSONB,
    "outcomeAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Recommendation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RecommendationRun_businessId_createdAt_idx" ON "RecommendationRun"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "Recommendation_businessId_status_idx" ON "Recommendation"("businessId", "status");

-- CreateIndex
CREATE INDEX "Recommendation_runId_idx" ON "Recommendation"("runId");

-- AddForeignKey
ALTER TABLE "RecommendationRun" ADD CONSTRAINT "RecommendationRun_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_runId_fkey" FOREIGN KEY ("runId") REFERENCES "RecommendationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Feature key: ON for every existing business (admins can switch it off per client).
INSERT INTO "FeaturePermission" ("id", "businessId", "featureKey", "enabled")
SELECT gen_random_uuid()::text, b."id", 'recommendations', true
FROM "Business" b
ON CONFLICT ("businessId", "featureKey") DO UPDATE SET "enabled" = true;

UPDATE "Business" SET "permissionsUpdatedAt" = CURRENT_TIMESTAMP;

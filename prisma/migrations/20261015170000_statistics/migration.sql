-- CreateTable
CREATE TABLE "StatisticsSummary" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "range" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "summary" JSONB NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StatisticsSummary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StatisticsSummary_businessId_range_key" ON "StatisticsSummary"("businessId", "range");

-- AddForeignKey
ALTER TABLE "StatisticsSummary" ADD CONSTRAINT "StatisticsSummary_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Statistics is ON in every plan: switch it on for the businesses that already exist.
INSERT INTO "FeaturePermission" ("id", "businessId", "featureKey", "enabled")
SELECT gen_random_uuid()::text, b."id", 'statistics', true
FROM "Business" b
ON CONFLICT ("businessId", "featureKey") DO UPDATE SET "enabled" = true;

UPDATE "Business" SET "permissionsUpdatedAt" = CURRENT_TIMESTAMP;

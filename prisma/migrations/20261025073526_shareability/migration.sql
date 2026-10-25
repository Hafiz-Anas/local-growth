-- CreateTable
CREATE TABLE "ShareFindings" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "findings" JSONB NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "failedAt" TIMESTAMP(3),

    CONSTRAINT "ShareFindings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShareFindings_businessId_key" ON "ShareFindings"("businessId");

-- AddForeignKey
ALTER TABLE "ShareFindings" ADD CONSTRAINT "ShareFindings_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- "Most shared" (postInsights.shareability) is ON in every plan: switch it on for the businesses that
-- already exist. Only adds rows (an existing choice is never changed); it only shows where Post
-- performance itself is on.
INSERT INTO "FeaturePermission" ("id", "businessId", "featureKey", "enabled")
SELECT gen_random_uuid()::text, b."id", 'postInsights.shareability', true
FROM "Business" b
ON CONFLICT ("businessId", "featureKey") DO NOTHING;

-- Sessions reload their feature list.
UPDATE "Business" SET "permissionsUpdatedAt" = CURRENT_TIMESTAMP;

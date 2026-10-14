-- In-app notifications (one row per recipient; dedupeKey keeps one live row per recurring subject)
-- and weekly reports (numbers computed in code + optional AI summary). Additive, plus the
-- "notifications" and "reports" feature keys ON for every existing business.

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "params" JSONB NOT NULL DEFAULT '{}',
    "href" TEXT NOT NULL,
    "dedupeKey" TEXT,
    "readAt" TIMESTAMP(3),
    "emailedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeeklyReport" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "numbers" JSONB NOT NULL,
    "summaryEn" TEXT,
    "summaryAr" TEXT,
    "aiStatus" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WeeklyReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_userId_dedupeKey_key" ON "Notification"("userId", "dedupeKey");

-- CreateIndex
CREATE INDEX "WeeklyReport_businessId_createdAt_idx" ON "WeeklyReport"("businessId", "createdAt");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyReport" ADD CONSTRAINT "WeeklyReport_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Feature keys: ON for every existing business (admins can switch them off per client).
INSERT INTO "FeaturePermission" ("id", "businessId", "featureKey", "enabled")
SELECT gen_random_uuid()::text, b."id", k.key, true
FROM "Business" b CROSS JOIN (VALUES ('notifications'), ('reports')) AS k(key)
ON CONFLICT ("businessId", "featureKey") DO UPDATE SET "enabled" = true;

UPDATE "Business" SET "permissionsUpdatedAt" = CURRENT_TIMESTAMP;

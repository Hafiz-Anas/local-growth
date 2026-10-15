-- CreateEnum
CREATE TYPE "MonitorStatus" AS ENUM ('ACTIVE', 'ENDED', 'STOPPED', 'UNAVAILABLE');

-- CreateEnum
CREATE TYPE "MonitorInterval" AS ENUM ('HOURLY', 'DAILY');

-- CreateTable
CREATE TABLE "PostMonitor" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "igMediaId" TEXT NOT NULL,
    "post" JSONB NOT NULL DEFAULT '{}',
    "duration" TEXT NOT NULL,
    "interval" "MonitorInterval" NOT NULL,
    "status" "MonitorStatus" NOT NULL DEFAULT 'ACTIVE',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "nextReadingAt" TIMESTAMP(3) NOT NULL,
    "lastReadingAt" TIMESTAMP(3),
    "lastError" TEXT,
    "alerts" JSONB NOT NULL DEFAULT '{}',
    "baseline" JSONB NOT NULL DEFAULT '{}',
    "outcome" JSONB,
    "summary" JSONB,
    "summaryStatus" TEXT,
    "startedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PostMonitor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonitorSnapshot" (
    "id" TEXT NOT NULL,
    "monitorId" TEXT NOT NULL,
    "takenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "likes" INTEGER NOT NULL,
    "comments" INTEGER NOT NULL,
    "reach" INTEGER,
    "saves" INTEGER,
    "shares" INTEGER,
    "views" INTEGER,

    CONSTRAINT "MonitorSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PostMonitor_businessId_status_idx" ON "PostMonitor"("businessId", "status");

-- CreateIndex
CREATE INDEX "PostMonitor_status_nextReadingAt_idx" ON "PostMonitor"("status", "nextReadingAt");

-- CreateIndex
CREATE INDEX "PostMonitor_businessId_igMediaId_idx" ON "PostMonitor"("businessId", "igMediaId");

-- CreateIndex
CREATE INDEX "MonitorSnapshot_monitorId_takenAt_idx" ON "MonitorSnapshot"("monitorId", "takenAt");

-- AddForeignKey
ALTER TABLE "PostMonitor" ADD CONSTRAINT "PostMonitor_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitorSnapshot" ADD CONSTRAINT "MonitorSnapshot_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "PostMonitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- "Monitor this post" is ON in every plan: switch it on for the businesses that already exist.
INSERT INTO "FeaturePermission" ("id", "businessId", "featureKey", "enabled")
SELECT gen_random_uuid()::text, b."id", 'monitoring', true
FROM "Business" b
ON CONFLICT ("businessId", "featureKey") DO UPDATE SET "enabled" = true;

UPDATE "Business" SET "permissionsUpdatedAt" = CURRENT_TIMESTAMP;

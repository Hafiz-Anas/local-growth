-- AlterTable
ALTER TABLE "InstagramConnection" ADD COLUMN     "connectedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "notificationPrefs" JSONB NOT NULL DEFAULT '{}';

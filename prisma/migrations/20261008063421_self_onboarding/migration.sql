-- CreateEnum
CREATE TYPE "OnboardingStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "BusinessSource" AS ENUM ('ADMIN_CREATED', 'SELF_SIGNUP');

-- CreateEnum
CREATE TYPE "CompetitorValidation" AS ENUM ('READY', 'NOT_BUSINESS', 'PRIVATE', 'NOT_FOUND', 'OWN_ACCOUNT');

-- CreateEnum
CREATE TYPE "BrandPostSource" AS ENUM ('UPLOAD', 'INSTAGRAM');

-- CreateEnum
CREATE TYPE "MediaType" AS ENUM ('IMAGE', 'VIDEO');

-- CreateEnum
CREATE TYPE "PostPurpose" AS ENUM ('MENU_PRODUCT', 'PROMOTION', 'SHOP_LOCATION', 'SERVICE', 'ANNOUNCEMENT', 'BEHIND_THE_SCENES', 'OTHER');

-- CreateEnum
CREATE TYPE "BrandContextStatus" AS ENUM ('BUILDING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "OnboardingEventType" AS ENUM ('STARTED', 'COMPLETED', 'BACK', 'ERROR', 'ABANDONED');

-- AlterTable
ALTER TABLE "BrandVoice" ADD COLUMN     "wordsToAvoid" TEXT[];

-- AlterTable
ALTER TABLE "Business" ADD COLUMN     "brandColors" TEXT[],
ADD COLUMN     "businessType" TEXT,
ADD COLUMN     "businessTypeOther" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "languages" TEXT[],
ADD COLUMN     "logoUrl" TEXT,
ADD COLUMN     "onboardingInvitedAt" TIMESTAMP(3),
ADD COLUMN     "onboardingStatus" "OnboardingStatus" NOT NULL DEFAULT 'COMPLETED',
ADD COLUMN     "onboardingStep" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "products" TEXT[],
ADD COLUMN     "source" "BusinessSource" NOT NULL DEFAULT 'ADMIN_CREATED',
ADD COLUMN     "targetAudience" TEXT,
ALTER COLUMN "instagramHandle" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Competitor" ADD COLUMN     "lastValidatedAt" TIMESTAMP(3),
ADD COLUMN     "validationStatus" "CompetitorValidation" NOT NULL DEFAULT 'READY';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "emailVerifiedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "BrandPost" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "source" "BrandPostSource" NOT NULL,
    "igMediaId" TEXT,
    "mediaUrl" TEXT,
    "mediaType" "MediaType" NOT NULL DEFAULT 'IMAGE',
    "caption" TEXT NOT NULL DEFAULT '',
    "purpose" "PostPurpose" NOT NULL,
    "purposeOther" TEXT,
    "purposeNote" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BrandPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrandContext" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "BrandContextStatus" NOT NULL DEFAULT 'BUILDING',
    "summary" TEXT NOT NULL DEFAULT '',
    "visualStyle" JSONB NOT NULL DEFAULT '{}',
    "captionStyle" JSONB NOT NULL DEFAULT '{}',
    "purposePatterns" JSONB NOT NULL DEFAULT '[]',
    "colors" TEXT[],
    "logoUrl" TEXT,
    "toneLevel" INTEGER NOT NULL DEFAULT 50,
    "wordsToUse" TEXT[],
    "wordsToAvoid" TEXT[],
    "editedByUser" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BrandContext_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnboardingEvent" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "event" "OnboardingEventType" NOT NULL,
    "details" JSONB NOT NULL DEFAULT '{}',
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OnboardingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Feedback" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "userId" TEXT,
    "step" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "context" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "EmailVerificationToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),

    CONSTRAINT "EmailVerificationToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BrandPost_businessId_order_idx" ON "BrandPost"("businessId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "BrandContext_businessId_version_key" ON "BrandContext"("businessId", "version");

-- CreateIndex
CREATE INDEX "OnboardingEvent_businessId_createdAt_idx" ON "OnboardingEvent"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "OnboardingEvent_step_event_idx" ON "OnboardingEvent"("step", "event");

-- CreateIndex
CREATE INDEX "Feedback_businessId_createdAt_idx" ON "Feedback"("businessId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmailVerificationToken_tokenHash_key" ON "EmailVerificationToken"("tokenHash");

-- CreateIndex
CREATE INDEX "EmailVerificationToken_userId_idx" ON "EmailVerificationToken"("userId");

-- AddForeignKey
ALTER TABLE "BrandPost" ADD CONSTRAINT "BrandPost_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandContext" ADD CONSTRAINT "BrandContext_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingEvent" ADD CONSTRAINT "OnboardingEvent_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailVerificationToken" ADD CONSTRAINT "EmailVerificationToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill ---------------------------------------------------------------------
-- Accounts that existed before self sign-up were created by Raid's team: treat them as verified.
UPDATE "User" SET "emailVerifiedAt" = "createdAt" WHERE "emailVerifiedAt" IS NULL;
-- New list columns start empty (not NULL) on existing rows.
UPDATE "Business" SET "products" = '{}' WHERE "products" IS NULL;
UPDATE "Business" SET "languages" = '{}' WHERE "languages" IS NULL;
UPDATE "Business" SET "brandColors" = '{}' WHERE "brandColors" IS NULL;
UPDATE "BrandVoice" SET "wordsToAvoid" = '{}' WHERE "wordsToAvoid" IS NULL;
-- Existing competitors were validated when they were added.
UPDATE "Competitor" SET "lastValidatedAt" = "lastFetchedAt" WHERE "lastValidatedAt" IS NULL;
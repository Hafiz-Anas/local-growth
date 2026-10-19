-- Sign-up connects Instagram; onboarding becomes five skippable steps: your business, your style,
-- your goals, your location, your competitors. Additive only: new nullable columns, a new table and
-- a remap of the wizard position of businesses still in onboarding. No data is removed.

-- CreateEnum
CREATE TYPE "StyleGuideStatus" AS ENUM ('BUILDING', 'READY', 'FAILED');

-- AlterTable
ALTER TABLE "Business" ADD COLUMN     "area" TEXT,
ADD COLUMN     "competitorSuggestions" JSONB,
ADD COLUMN     "feelingOther" TEXT,
ADD COLUMN     "feelings" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "governorate" TEXT,
ADD COLUMN     "serviceMode" TEXT,
ADD COLUMN     "setupPromptDoneAt" TIMESTAMP(3),
ADD COLUMN     "targets" JSONB;

-- CreateTable
CREATE TABLE "StyleGuide" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "photos" JSONB NOT NULL DEFAULT '[]',
    "status" "StyleGuideStatus" NOT NULL DEFAULT 'BUILDING',
    "basis" TEXT,
    "palette" TEXT,
    "angle" TEXT,
    "lighting" TEXT,
    "closeness" TEXT,
    "background" TEXT,
    "mood" TEXT,
    "summary" TEXT,
    "summaryEditedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "analyzedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StyleGuide_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StyleGuide_businessId_key" ON "StyleGuide"("businessId");

-- AddForeignKey
ALTER TABLE "StyleGuide" ADD CONSTRAINT "StyleGuide_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Businesses still in onboarding resume in the new order (old: 1 instagram, 2 brand, 3 goals,
-- 4 competitors → new: 1 business, 2 style, 3 goals, 4 location, 5 competitors). Instagram is now
-- part of sign-up, and "Confirm your brand" became "Your business".
UPDATE "Business" SET "onboardingStep" = CASE "onboardingStep" WHEN 2 THEN 1 WHEN 3 THEN 3 WHEN 4 THEN 5 ELSE 1 END
WHERE "onboardingStatus" = 'IN_PROGRESS';
-- Finished businesses: the last step of the new wizard (they get a one-time prompt for the new steps).
UPDATE "Business" SET "onboardingStep" = 5 WHERE "onboardingStatus" = 'COMPLETED';

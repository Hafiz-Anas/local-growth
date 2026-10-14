-- Simpler onboarding: 4 steps (instagram, brand, goals, competitors) instead of 7
-- (instagram, business, competitors, posts, brand, review, result). Adds the brand focus
-- and goals fields, "Finish later", the stored AI pre-fill and the one-time goals prompt.

-- AlterTable
ALTER TABLE "Business" ADD COLUMN     "aim" TEXT,
ADD COLUMN     "exampleCaption" TEXT,
ADD COLUMN     "goals" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "goalsPromptDoneAt" TIMESTAMP(3),
ADD COLUMN     "niche" TEXT,
ADD COLUMN     "onboardingDeferredAt" TIMESTAMP(3),
ADD COLUMN     "onboardingPrefill" JSONB,
ADD COLUMN     "timeline" TEXT;

-- Businesses still in onboarding resume in the new order: the old business / competitors /
-- posts / brand / review steps (2–6) all become "Confirm your brand" (2), whose fields they
-- have mostly filled already; the old result screen (7) becomes the last step (4).
UPDATE "Business" SET "onboardingStep" = 2 WHERE "onboardingStatus" = 'IN_PROGRESS' AND "onboardingStep" BETWEEN 2 AND 6;
UPDATE "Business" SET "onboardingStep" = 4 WHERE "onboardingStatus" = 'IN_PROGRESS' AND "onboardingStep" >= 7;
-- Finished businesses: the last step of the new wizard.
UPDATE "Business" SET "onboardingStep" = 4 WHERE "onboardingStatus" = 'COMPLETED';

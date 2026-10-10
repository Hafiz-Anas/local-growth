-- Onboarding now starts with "Connect Instagram" (step 1) and asks for the business
-- details second (step 2); steps 3–7 are unchanged. Businesses mid-way under the old
-- order (1 = business, 2 = instagram) resume on step 1, the Instagram step, which
-- they had either not reached or were on. Their saved business details are kept.
UPDATE "Business" SET "onboardingStep" = 1 WHERE "onboardingStatus" = 'IN_PROGRESS' AND "onboardingStep" = 2;

-- The posting language is no longer asked: new businesses default to both, and the
-- brand-profile build learns it from the captions.
ALTER TABLE "Business" ALTER COLUMN "languages" SET DEFAULT ARRAY['ar', 'en']::TEXT[];
UPDATE "Business" SET "languages" = ARRAY['ar', 'en']::TEXT[] WHERE cardinality("languages") = 0;

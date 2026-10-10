-- Post Generator images: each draft can carry one image, either AI-generated or
-- uploaded by the user. Additive only (nullable columns, a new enum).
CREATE TYPE "DraftImageSource" AS ENUM ('GENERATED', 'UPLOADED');

ALTER TABLE "PostDraft" ADD COLUMN "imageUrl" TEXT,
ADD COLUMN "imageSource" "DraftImageSource",
ADD COLUMN "imagePrompt" TEXT;

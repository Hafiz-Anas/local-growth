-- Weekly tips: the growth signal's expected impact and the order within an analysis.
-- Additive only: existing recommendations keep impact NULL and rank 0.
ALTER TABLE "Recommendation" ADD COLUMN "impact" TEXT;
ALTER TABLE "Recommendation" ADD COLUMN "rank" INTEGER NOT NULL DEFAULT 0;

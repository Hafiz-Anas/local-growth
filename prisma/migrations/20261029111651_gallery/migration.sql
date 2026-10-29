-- CreateEnum
CREATE TYPE "DraftOrigin" AS ENUM ('GENERATOR', 'AI_CHAT', 'GALLERY');

-- CreateEnum
CREATE TYPE "GalleryPhotoSource" AS ENUM ('UPLOADED', 'INSTAGRAM', 'AI_GENERATED', 'SAMPLE');

-- CreateEnum
CREATE TYPE "GalleryPhotoStatus" AS ENUM ('PENDING', 'READY');

-- AlterTable
ALTER TABLE "PostDraft" ADD COLUMN     "captionAr" TEXT,
ADD COLUMN     "captionEn" TEXT,
ADD COLUMN     "captionVersions" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "hashtags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "origin" "DraftOrigin" NOT NULL DEFAULT 'GENERATOR',
ADD COLUMN     "suggestedFor" TIMESTAMP(3),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "category" SET DEFAULT '',
ALTER COLUMN "angle" SET DEFAULT '';

-- CreateTable
CREATE TABLE "PostDraftPhoto" (
    "draftId" TEXT NOT NULL,
    "photoId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PostDraftPhoto_pkey" PRIMARY KEY ("draftId","photoId")
);

-- CreateTable
CREATE TABLE "GalleryPhoto" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "source" "GalleryPhotoSource" NOT NULL,
    "status" "GalleryPhotoStatus" NOT NULL DEFAULT 'READY',
    "storageKey" TEXT,
    "url" TEXT,
    "thumbKey" TEXT,
    "thumbUrl" TEXT,
    "contentType" TEXT,
    "bytes" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "title" TEXT,
    "igMediaId" TEXT,
    "sampleKey" TEXT,
    "favorite" BOOLEAN NOT NULL DEFAULT false,
    "removedAt" TIMESTAMP(3),
    "uploadedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GalleryPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GalleryAlbum" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GalleryAlbum_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GalleryAlbumPhoto" (
    "albumId" TEXT NOT NULL,
    "photoId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GalleryAlbumPhoto_pkey" PRIMARY KEY ("albumId","photoId")
);

-- CreateIndex
CREATE INDEX "PostDraftPhoto_photoId_idx" ON "PostDraftPhoto"("photoId");

-- CreateIndex
CREATE INDEX "GalleryPhoto_businessId_status_createdAt_idx" ON "GalleryPhoto"("businessId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "GalleryPhoto_status_createdAt_idx" ON "GalleryPhoto"("status", "createdAt");

-- CreateIndex
CREATE INDEX "GalleryPhoto_removedAt_idx" ON "GalleryPhoto"("removedAt");

-- CreateIndex
CREATE UNIQUE INDEX "GalleryPhoto_businessId_igMediaId_key" ON "GalleryPhoto"("businessId", "igMediaId");

-- CreateIndex
CREATE UNIQUE INDEX "GalleryPhoto_businessId_sampleKey_key" ON "GalleryPhoto"("businessId", "sampleKey");

-- CreateIndex
CREATE INDEX "GalleryAlbum_businessId_position_idx" ON "GalleryAlbum"("businessId", "position");

-- CreateIndex
CREATE INDEX "GalleryAlbumPhoto_photoId_idx" ON "GalleryAlbumPhoto"("photoId");

-- CreateIndex
CREATE INDEX "PostDraft_businessId_origin_status_idx" ON "PostDraft"("businessId", "origin", "status");

-- AddForeignKey
ALTER TABLE "PostDraftPhoto" ADD CONSTRAINT "PostDraftPhoto_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "PostDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostDraftPhoto" ADD CONSTRAINT "PostDraftPhoto_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "GalleryPhoto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GalleryPhoto" ADD CONSTRAINT "GalleryPhoto_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GalleryAlbum" ADD CONSTRAINT "GalleryAlbum_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GalleryAlbumPhoto" ADD CONSTRAINT "GalleryAlbumPhoto_albumId_fkey" FOREIGN KEY ("albumId") REFERENCES "GalleryAlbum"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GalleryAlbumPhoto" ADD CONSTRAINT "GalleryAlbumPhoto_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "GalleryPhoto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

/**
 * One-off: puts the photos businesses uploaded before this change — onboarding "Your style" photos and
 * Settings → brand-post photos — into their Gallery as Uploaded photos (lib/server/gallery-import.ts).
 * Safe to run again: a file already in a business's Gallery is skipped, so nothing is ever added twice.
 * Nothing is deleted or changed; it only adds GalleryPhoto rows and their thumbnails.
 *
 *   npm run backfill-gallery-uploads                 dry run: how many photos each business would get
 *   npm run backfill-gallery-uploads -- --apply      adds them
 *
 * It reads the files and writes thumbnails through the app's StorageService, so run it with the same
 * DATABASE_URL, STORAGE_PROVIDER (and BLOB_READ_WRITE_TOKEN / UPLOAD_DIR) as the app whose data it is.
 * A hosted database (Neon, Vercel, NODE_ENV=production) also needs --production — see DEPLOY.md.
 */
import "dotenv/config";
import { db } from "../lib/db";
import { backfillBusinessUploads } from "../lib/server/gallery-import";
import { getStorageService } from "../lib/services/storage";
import { describeDatabase, isProductionTarget } from "./db-target";

async function main() {
  const apply = process.argv.includes("--apply");
  const production = isProductionTarget(process.env.DATABASE_URL);
  console.info(`Database: ${describeDatabase(process.env.DATABASE_URL)} · storage: ${process.env.STORAGE_PROVIDER ?? "local"} · ${apply ? "APPLY" : "dry run"}`);
  if (apply && production && !process.argv.includes("--production")) {
    console.error("✖ This looks like a hosted / production database. Add --production to confirm (see DEPLOY.md).");
    process.exit(1);
  }

  const storage = getStorageService();
  const businesses = await db.business.findMany({ select: { id: true, name: true }, orderBy: { createdAt: "asc" } });
  let total = 0;
  for (const business of businesses) {
    if (apply) {
      const added = await backfillBusinessUploads(business.id);
      if (added) console.info(`  ${business.name || business.id}: added ${added}`);
      total += added;
      continue;
    }
    // Dry run: our own image uploads not in the Gallery yet (files aren't read).
    const [style, posts] = await Promise.all([
      db.styleGuide.findUnique({ where: { businessId: business.id }, select: { photos: true } }),
      db.brandPost.findMany({ where: { businessId: business.id, source: "UPLOAD", mediaType: "IMAGE" }, select: { mediaUrl: true } }),
    ]);
    const stylePhotos = Array.isArray(style?.photos) ? (style.photos as Array<{ source?: unknown; url?: unknown }>) : [];
    const urls = new Set([...stylePhotos.flatMap((p) => (p?.source === "upload" && typeof p.url === "string" ? [p.url] : [])), ...posts.flatMap((p) => (p.mediaUrl ? [p.mediaUrl] : []))]);
    let missing = 0;
    for (const url of urls) {
      const key = storage.keyFromUrl(url);
      if (key && !(await db.galleryPhoto.count({ where: { businessId: business.id, OR: [{ storageKey: key }, { url }] } }))) missing += 1;
    }
    if (missing) console.info(`  ${business.name || business.id}: would add ${missing}`);
    total += missing;
  }
  console.info(apply ? `✔ Added ${total} photo(s) to Galleries.` : `Dry run: ${total} photo(s) would be added. Run again with --apply to add them.`);
  await db.$disconnect();
}

main().catch(async (error) => {
  console.error("✖", (error as Error)?.message ?? error);
  await db.$disconnect().catch(() => undefined);
  process.exit(1);
});

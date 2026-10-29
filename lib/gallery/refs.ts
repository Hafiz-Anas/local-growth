/**
 * Gallery photo ids, shared by the server (lib/server/gallery.ts) and the Gallery screens. Pure (no
 * server-only) so the tests import it.
 *
 *  - an own photo (uploaded, AI-generated): its GalleryPhoto id (a cuid)
 *  - an Instagram post (synced into InstagramMedia): "ig:<Instagram media id>"
 *  - a demo business's sample photo: "sample:<key>", the key being the sample photo's id ("mathanet-07"),
 *    plus "~<look>" for a sample AI image made from it ("mathanet-07~2")
 *
 * Instagram and sample photos keep the same id once the owner favourites, files, hides or drafts them
 * (a GalleryPhoto row then holds that state), so the screens never see the row's own id.
 */

export type PhotoRef = { kind: "own"; id: string } | { kind: "instagram"; igMediaId: string } | { kind: "sample"; key: string };

export const IG_PREFIX = "ig:";
export const SAMPLE_PREFIX = "sample:";

const OWN_ID = /^c[a-z0-9]{20,32}$/;
const IG_MEDIA_ID = /^[A-Za-z0-9_.-]{1,80}$/;
const SAMPLE_KEY = /^[a-z]{2,20}-\d{2}(~[1-3])?$/;

export function parsePhotoRef(id: string): PhotoRef | null {
  if (id.startsWith(IG_PREFIX)) {
    const igMediaId = id.slice(IG_PREFIX.length);
    return IG_MEDIA_ID.test(igMediaId) ? { kind: "instagram", igMediaId } : null;
  }
  if (id.startsWith(SAMPLE_PREFIX)) {
    const key = id.slice(SAMPLE_PREFIX.length);
    return SAMPLE_KEY.test(key) ? { kind: "sample", key } : null;
  }
  return OWN_ID.test(id) ? { kind: "own", id } : null;
}

export const igPhotoId = (igMediaId: string) => `${IG_PREFIX}${igMediaId}`;
export const samplePhotoId = (key: string) => `${SAMPLE_PREFIX}${key}`;

/** The sample key behind a sample image path ("/photos/mathanet/07.jpg" → "mathanet-07"), with its AI look. */
export function sampleKeyFromSrc(src: string, look?: number): string | null {
  const match = /^\/photos\/([a-z]{2,20})\/(\d{2})\.jpg$/.exec(src);
  if (!match) return null;
  return `${match[1]}-${match[2]}${look ? `~${look}` : ""}`;
}

/** "mathanet-07~2" → the sample photo's id ("mathanet-07") and its look (2). */
export function splitSampleKey(key: string): { photoId: string; look?: number } {
  const [photoId, look] = key.split("~");
  return look ? { photoId, look: Number(look) } : { photoId };
}

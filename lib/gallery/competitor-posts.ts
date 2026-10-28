import type { CompetitorDto, CompetitorPost } from "@/types";

/**
 * A competitor's post as the Gallery viewer, the AI chat and the Inspiration tab carry it: the post
 * plus who posted it, copied when it's opened or saved so it still shows after the competitor changes.
 * Front-end only, like the rest of the Gallery store (lib/gallery/store.ts).
 */
export interface CompetitorPostRef {
  /** `${competitorId}:${post.id}` — unique across competitors. */
  key: string;
  competitorId: string;
  handle: string;
  /** Display name (the business's own name for it, else the profile name). */
  name: string;
  avatarUrl: string | null;
  post: CompetitorPost;
}

export interface SavedInspiration extends CompetitorPostRef {
  savedAt: string;
}

/** Saved inspiration lives in this browser, one list per business (one browser can hold several logins). */
export const inspirationStorageKey = (businessId: string) => `lge_inspiration:${businessId}`;
export const MAX_SAVED_INSPIRATION = 100;

/** The stored list, keeping only well-formed items; anything unreadable is an empty list. */
export function parseSavedInspiration(raw: string | null): SavedInspiration[] {
  if (!raw) return [];
  try {
    const list: unknown = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list
      .filter(
        (x): x is SavedInspiration =>
          !!x &&
          typeof x === "object" &&
          typeof x.key === "string" &&
          typeof x.competitorId === "string" &&
          typeof x.handle === "string" &&
          typeof x.name === "string" &&
          typeof x.savedAt === "string" &&
          !!x.post &&
          typeof x.post === "object" &&
          typeof x.post.id === "string" &&
          typeof x.post.likes === "number" &&
          typeof x.post.comments === "number",
      )
      .slice(0, MAX_SAVED_INSPIRATION);
  } catch {
    return [];
  }
}

export const competitorPostKey =(competitorId: string, postId: string) => `${competitorId}:${postId}`;

/** Every recent post of a competitor, in the order the profile shows them. */
export function competitorPostRefs(c: Pick<CompetitorDto, "id" | "handle" | "displayName" | "name" | "avatarUrl" | "recentPosts">): CompetitorPostRef[] {
  const name = c.displayName || c.name || c.handle;
  return c.recentPosts.map((post) => ({ key: competitorPostKey(c.id, post.id), competitorId: c.id, handle: c.handle, name, avatarUrl: c.avatarUrl, post }));
}

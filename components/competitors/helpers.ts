import type { CompetitorDto, CompetitorPost } from "@/types";

/** The name the business chose, else the Instagram profile name, else the handle. */
export function competitorName(c: Pick<CompetitorDto, "displayName" | "name" | "handle">): string {
  return c.displayName || c.name || c.handle;
}

/** Their best-performing recent post (most likes), if any. */
export function bestPost(c: Pick<CompetitorDto, "recentPosts">): CompetitorPost | null {
  return c.recentPosts.reduce<CompetitorPost | null>((best, post) => (!best || post.likes > best.likes ? post : best), null);
}

export const HANDLE_PATTERN = /^[a-z0-9._]{1,30}$/;

export function normalizeHandle(value: string): string {
  return value.trim().replace(/^@/, "").toLowerCase();
}

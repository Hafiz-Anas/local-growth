import type { AnalysisPost, PostFormat } from "../../lib/analysis/posts";

/** Posts for the growth-signal and weekly-tip tests (tests/growth-signals.test.ts, tests/gemini/strategy.test.ts). */

let seq = 0;
const post = (postedAt: string, format: PostFormat, n: { reach: number; shares: number; saves: number; comments: number }): AnalysisPost => ({
  id: `p${++seq}`,
  caption: "Fresh kunafa",
  format,
  postedAt,
  likes: 50,
  comments: n.comments,
  reach: n.reach,
  saves: n.saves,
  shares: n.shares,
  views: null,
});

/**
 * 5 Reels on Thursday 20:00 Kuwait time (17:00 UTC), 5 photos on Monday 10:00, 2 carousels on
 * Wednesday 15:00. Reels: most shares and reach; carousels: most saves and comments.
 */
export function growthPosts(): AnalysisPost[] {
  const reel = { reach: 2000, shares: 100, saves: 40, comments: 12 };
  const photo = { reach: 1000, shares: 10, saves: 30, comments: 4 };
  const carousel = { reach: 1200, shares: 12, saves: 60, comments: 20 };
  return [
    ...["2026-09-24", "2026-10-01", "2026-10-08", "2026-10-15", "2026-10-22"].map((d) => post(`${d}T17:00:00Z`, "reel", reel)),
    ...["2026-09-21", "2026-09-28", "2026-10-05", "2026-10-12", "2026-10-19"].map((d) => post(`${d}T07:00:00Z`, "photo", photo)),
    ...["2026-10-14", "2026-10-21"].map((d) => post(`${d}T12:00:00Z`, "carousel", carousel)),
  ];
}

export const GROWTH_TZ = "Asia/Kuwait";

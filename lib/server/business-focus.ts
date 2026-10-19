import "server-only";
import { locationLabel } from "@/config/kuwait";
import { db } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { readTargets } from "@/lib/onboarding-answers";
import type { BusinessFocus } from "@/lib/services/text/focus";

/**
 * The business's focus for every AI call (captions, replies, assistant and recommendations data
 * block, brand profile): niche and goals from onboarding / Settings → Goals, plus the five-step
 * onboarding's products / menu categories, targets, feeling, location and the photo style guide.
 * One query; turned into prompt lines by focusLines() (lib/services/text/focus.ts).
 */

export const FOCUS_SELECT = {
  niche: true,
  aim: true,
  goals: true,
  timeline: true,
  exampleCaption: true,
  products: true,
  targets: true,
  feelings: true,
  feelingOther: true,
  governorate: true,
  area: true,
  serviceMode: true,
  styleGuide: { select: { status: true, summary: true, palette: true, angle: true, lighting: true, closeness: true, background: true, mood: true } },
} satisfies Prisma.BusinessSelect;

type FocusRow = Prisma.BusinessGetPayload<{ select: typeof FOCUS_SELECT }>;

/** `withProducts: false` where the data block already lists the products (assistant, brand profile). */
export function toBusinessFocus(row: FocusRow, { withProducts = true }: { withProducts?: boolean } = {}): BusinessFocus {
  const guide = row.styleGuide;
  // A guide still building may already carry the owner's own line; a failed one may too.
  const style = guide && (guide.status === "READY" || guide.summary) ? { summary: guide.summary, palette: guide.palette, angle: guide.angle, lighting: guide.lighting, closeness: guide.closeness, background: guide.background, mood: guide.mood } : null;
  return {
    niche: row.niche,
    aim: row.aim,
    goals: row.goals,
    timeline: row.timeline,
    exampleCaption: row.exampleCaption,
    ...(withProducts && { products: row.products }),
    targets: readTargets(row.targets),
    feelings: row.feelings,
    feelingOther: row.feelingOther,
    location: locationLabel(row.governorate, row.area) || null,
    serviceMode: row.serviceMode,
    style,
  };
}

export async function loadBusinessFocus(businessId: string, options?: { withProducts?: boolean }): Promise<BusinessFocus | null> {
  const row = await db.business.findUnique({ where: { id: businessId }, select: FOCUS_SELECT });
  return row ? toBusinessFocus(row, options) : null;
}

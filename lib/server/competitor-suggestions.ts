import "server-only";
import { locationLabel } from "@/config/kuwait";
import { db } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { getAIService } from "@/lib/services/ai";
import { getInstagramService } from "@/lib/services/instagram";
import type { CompetitorSuggestionsDto } from "@/types";
import { ApiError } from "./http";
import { getInstagramAccount } from "./instagram-account";
import { recordError } from "./onboarding";
import { COMPETITOR_SUGGEST_LIMIT, getRateLimiter } from "./rate-limit";

/**
 * Onboarding's competitors step: the AI suggests similar local accounts; each one is checked with
 * Instagram (business discovery, the same check as adding one by hand) and only real, public
 * business accounts are offered. Stored on Business.competitorSuggestions once it worked, so the
 * AI and Instagram are asked once per business. Adding a suggestion goes through the normal
 * competitor validation again.
 */

/** Instagram checks per run (each is a business-discovery call). */
const MAX_LOOKUPS = 6;

interface StoredSuggestions {
  at: string;
  items: CompetitorSuggestionsDto["items"];
}

function readStored(json: Prisma.JsonValue | null): StoredSuggestions | null {
  const value = json as unknown as StoredSuggestions | null;
  return value && Array.isArray(value.items) ? value : null;
}

/** Stored suggestions without the accounts already on the list. */
export async function getCompetitorSuggestions(businessId: string): Promise<CompetitorSuggestionsDto> {
  const [business, listed] = await Promise.all([
    db.business.findUniqueOrThrow({ where: { id: businessId }, select: { competitorSuggestions: true } }),
    db.competitor.findMany({ where: { businessId }, select: { handle: true } }),
  ]);
  const stored = readStored(business.competitorSuggestions);
  const taken = new Set(listed.map((c) => c.handle));
  return { status: stored ? "ready" : "none", items: (stored?.items ?? []).filter((s) => !taken.has(s.handle)) };
}

/**
 * Asks the AI (once) and checks its suggestions with Instagram. A failure never blocks the step:
 * the answer is just "unavailable" and the owner adds accounts themselves.
 */
export async function suggestCompetitors(businessId: string): Promise<CompetitorSuggestionsDto> {
  const current = await getCompetitorSuggestions(businessId);
  if (current.status === "ready") return current;
  if (!(await getRateLimiter().consume(COMPETITOR_SUGGEST_LIMIT, businessId))) {
    throw new ApiError(429, "rate_limited", "Suggestions were asked for a few times already. Add accounts yourself, or try again later.");
  }

  const [business, listed, account] = await Promise.all([
    db.business.findUniqueOrThrow({
      where: { id: businessId },
      select: { name: true, instagramHandle: true, businessType: true, businessTypeOther: true, niche: true, products: true, governorate: true, area: true },
    }),
    db.competitor.findMany({ where: { businessId }, select: { handle: true } }),
    getInstagramAccount(businessId),
  ]);
  const ig = getInstagramService();
  const bio = account.connected ? ((await ig.getProfile(account).catch(() => null))?.bio ?? "") : "";
  const answer = await getAIService().suggestCompetitors({
    businessId,
    prompt: {
      businessName: business.name,
      username: business.instagramHandle,
      businessType: business.businessType === "other" ? business.businessTypeOther : business.businessType,
      niche: business.niche,
      products: business.products,
      location: locationLabel(business.governorate, business.area),
      bio,
      exclude: listed.map((c) => c.handle),
    },
  });
  if (!answer.ok) {
    await recordError(businessId, "competitors", { kind: "competitor_suggestions", reason: answer.reason });
    return { status: "unavailable", items: [] };
  }

  const items: CompetitorSuggestionsDto["items"] = [];
  for (const handle of answer.handles.slice(0, MAX_LOOKUPS)) {
    const lookup = await ig.lookupBusinessAccount(account, handle).catch(() => null);
    if (lookup?.status !== "ready" || !lookup.profile) continue;
    items.push({ handle, name: lookup.profile.name ?? null, avatarUrl: lookup.profile.avatarUrl ?? null, followers: lookup.profile.followers ?? 0 });
  }
  const stored: StoredSuggestions = { at: new Date().toISOString(), items };
  await db.business.update({ where: { id: businessId }, data: { competitorSuggestions: stored as unknown as Prisma.InputJsonObject } });
  return getCompetitorSuggestions(businessId);
}

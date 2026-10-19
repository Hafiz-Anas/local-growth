import "server-only";
import { db } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { inferPostingLanguages } from "@/lib/brand-language";
import { getAIService } from "@/lib/services/ai";
import { getInstagramService } from "@/lib/services/instagram";
import { extractHashtags } from "@/lib/services/text/prefill";
import type { BusinessType } from "@/config/onboarding";
import type { OnboardingPrefillDto } from "@/types";
import { getInstagramAccount } from "./instagram-account";
import { recordError } from "./onboarding";

/**
 * "Your business": suggestions from the connected account's bio and recent posts, so the owner
 * confirms instead of typing. Hashtags are read in code (always there); type, niche, tone, products
 * and menu categories come from the AI when it's available — otherwise those stay empty and the
 * wizard carries on. Runs once per business (stored on Business.onboardingPrefill).
 */

const RECENT_POSTS = 12;

export function readPrefill(stored: Prisma.JsonValue | null): OnboardingPrefillDto | null {
  return stored && typeof stored === "object" && !Array.isArray(stored) ? (stored as unknown as OnboardingPrefillDto) : null;
}

export async function prefillBrand(businessId: string, locale: "en" | "ar"): Promise<OnboardingPrefillDto> {
  const business = await db.business.findUniqueOrThrow({ where: { id: businessId }, select: { name: true, onboardingPrefill: true } });
  const stored = readPrefill(business.onboardingPrefill);
  if (stored) return stored;

  const account = await getInstagramAccount(businessId);
  let bio = "";
  let captions: string[] = [];
  if (account.connected) {
    try {
      const ig = getInstagramService();
      const [profile, media] = await Promise.all([ig.getProfile(account), ig.getMedia(account, { limit: RECENT_POSTS })]);
      bio = profile.bio ?? "";
      captions = [...media].sort((a, b) => b.postedAt.localeCompare(a.postedAt)).map((m) => m.caption).filter((c) => c.trim());
    } catch (error) {
      await recordError(businessId, "business", { kind: "prefill_instagram", message: (error as Error).message.slice(0, 200) });
    }
  }

  const hashtags = extractHashtags([bio, ...captions]);
  const result: OnboardingPrefillDto = { aiUsed: false, postsWithCaptions: captions.length, businessType: null, niche: null, toneLevel: null, hashtags, products: [], categories: [] };

  if (bio.trim() || captions.length) {
    const answer = await getAIService().brandPrefill({
      businessId,
      prompt: { businessName: business.name, username: account.username, bio, captions, hashtagCandidates: hashtags, locale },
    });
    if (answer.ok) {
      const s = answer.suggestion;
      Object.assign(result, {
        aiUsed: true,
        businessType: s.businessType as BusinessType | null,
        niche: s.niche,
        toneLevel: s.toneLevel,
        // The AI's pick first, then the rest the account uses.
        hashtags: [...new Set([...s.hashtags, ...hashtags])].slice(0, 8),
        products: s.products,
        categories: s.categories,
      });
    } else {
      await recordError(businessId, "business", { kind: "prefill_ai", reason: answer.reason });
    }
  }

  const languages = inferPostingLanguages(captions);
  await db.business.update({
    where: { id: businessId },
    data: { onboardingPrefill: result as unknown as Prisma.InputJsonObject, ...(languages && { languages }) },
  });
  return result;
}

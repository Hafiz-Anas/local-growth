import "server-only";
import { db } from "@/lib/db";
import { getAIService } from "@/lib/services/ai";
import { getContentCatalog } from "@/lib/services/catalog";
import { brandContextForCaptions, catalogProfile } from "./brand";
import { ApiError, notFound } from "./http";

/** Shared by the post-draft routes: a draft of the caller's business, or 404. */
export async function findOwnDraft(businessId: string, id: string) {
  const draft = await db.postDraft.findFirst({ where: { id, businessId }, select: { id: true, status: true, category: true, angle: true, language: true, imageUrl: true } });
  if (!draft) throw notFound("Draft");
  return draft;
}

export function assertFuture(date: Date) {
  if (date.getTime() <= Date.now() + 60 * 1000) throw new ApiError(400, "validation_error", "Choose a time in the future.");
}

/**
 * Runs the AI service with the business's brand voice and, once onboarding has
 * built one, its brand context — so the generator doesn't ask for the same
 * inputs again. A business that posts in one language gets captions in it.
 */
export async function generateCaptions(
  businessId: string,
  input: { categoryId: string; occasionId: string; language?: "en" | "ar"; count: number; variant: number; vocabulary?: string[] },
) {
  const business = await db.business.findUniqueOrThrow({
    where: { id: businessId },
    select: { name: true, nameAr: true, instagramHandle: true, languages: true, brandVoice: { select: { toneLevel: true, brandWords: true, defaultHashtags: true } } },
  });
  const [profile, brandContext] = await Promise.all([catalogProfile(businessId), brandContextForCaptions(businessId)]);
  const catalog = getContentCatalog(businessId, business.name, profile);
  if (!catalog.categories.some((c) => c.id === input.categoryId)) throw new ApiError(400, "validation_error", "Unknown category.");
  if (!catalog.occasions.some((o) => o.id === input.occasionId)) throw new ApiError(400, "validation_error", "Unknown occasion.");
  const onlyLanguage = business.languages.length === 1 && (business.languages[0] === "ar" || business.languages[0] === "en") ? business.languages[0] : undefined;

  return getAIService().generateCaptions({
    businessId,
    businessName: business.name,
    businessNameAr: business.nameAr,
    handle: business.instagramHandle ?? business.name,
    categoryId: input.categoryId,
    occasionId: input.occasionId,
    language: input.language ?? onlyLanguage,
    count: input.count,
    variant: input.variant,
    brandVoice: {
      ...(business.brandVoice ?? { toneLevel: 50, brandWords: [], defaultHashtags: [] }),
      ...(input.vocabulary && { brandWords: input.vocabulary }),
    },
    brandContext,
    profile,
  });
}

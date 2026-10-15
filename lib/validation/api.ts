import { z } from "zod";
import { FEATURE_KEYS } from "@/config/features";
import {
  BUSINESS_AIMS,
  BUSINESS_GOALS,
  BUSINESS_TYPES,
  EVENT_STEPS,
  GOAL_TIMELINES,
  HEX_COLOR,
  INSTAGRAM_LANGUAGES,
  MAX_BRAND_COLORS,
  ONBOARDING_STEPS,
  POST_PURPOSES,
} from "@/config/onboarding";
import { DM_REPLY_MAX, REGENERATE_TONES } from "@/lib/replies";
import { MAX_COMPETITORS_LIMIT } from "@/config/plans";
import { METHODS } from "@/lib/analysis/methods";
import { MAX_RULE_KEYWORDS, MAX_RULE_POSTS, PRIVATE_REPLY_MAX, PUBLIC_REPLY_MAX, normalizeText } from "@/lib/keyword-replies";
import { ASSISTANT_MAX_QUESTION, ASSISTANT_MODES } from "@/lib/services/text/assistant";
import { normalizeTheme } from "@/lib/theme-script";
import { emailSchema, newPasswordSchema } from "./auth";

/** Input schemas for the API routes (shared with the UI for form validation). */

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).nullish().transform((v) => (v ? v : null));
const isoDate = z.iso.datetime({ offset: true }).transform((v) => new Date(v));
const tag = z.string().trim().min(1).max(60);
export const planSchema = z.enum(["starter", "growth", "pro"]);
export const handleSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/^@/, "").toLowerCase())
  .pipe(z.string().regex(/^[a-z0-9._]{1,30}$/, "Use letters, numbers, dots and underscores (max 30)."));

// Me ---------------------------------------------------------------------------

export const uiPreferencesSchema = z.object({
  sidebarCollapsed: z.boolean().default(false),
  // "system" (the old default) and anything missing are read as dark.
  theme: z.enum(["light", "dark", "system"]).default("dark").transform(normalizeTheme),
  language: z.enum(["en", "ar"]).default("en"),
});

export const uiPreferencesPatchSchema = z
  .object({
    sidebarCollapsed: z.boolean(),
    theme: z.enum(["light", "dark", "system"]).transform(normalizeTheme),
    language: z.enum(["en", "ar"]),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update.");

const notificationFields = {
  newComments: z.boolean(),
  approvalNeeded: z.boolean(),
  weeklyReport: z.boolean(),
  competitorAlerts: z.boolean(),
  experimentResults: z.boolean(),
  recommendationsReady: z.boolean(),
  instagramReconnect: z.boolean(),
  scheduledPosts: z.boolean(),
};

/** Stored User.notificationPrefs, with defaults for missing keys. */
export const notificationPrefsSchema = z.object({
  newComments: notificationFields.newComments.default(true),
  approvalNeeded: notificationFields.approvalNeeded.default(true),
  weeklyReport: notificationFields.weeklyReport.default(true),
  competitorAlerts: notificationFields.competitorAlerts.default(false),
  experimentResults: notificationFields.experimentResults.default(true),
  recommendationsReady: notificationFields.recommendationsReady.default(true),
  instagramReconnect: notificationFields.instagramReconnect.default(true),
  scheduledPosts: notificationFields.scheduledPosts.default(true),
});

export const notificationPrefsPatchSchema = z
  .object(notificationFields)
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update.");

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: newPasswordSchema,
});

// Competitors --------------------------------------------------------------------

const competitorLabels = {
  /** Shown instead of the Instagram profile name. Empty → null (use the profile name). */
  displayName: optionalText(60),
  /** Free-text label, e.g. "main rival". */
  note: optionalText(80),
};

export const addCompetitorSchema = z.object({ handle: handleSchema, ...competitorLabels });

export const updateCompetitorSchema = z
  .object({ handle: handleSchema, ...competitorLabels })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update.");

// Content ----------------------------------------------------------------------

export const draftStatusQuery = z.object({ status: z.enum(["draft", "queued", "published", "rejected"]).optional() });

export const generateDraftsSchema = z.object({
  categoryId: text(60),
  occasionId: text(60),
  language: z.enum(["en", "ar"]).optional(),
  count: z.number().int().min(1).max(5).default(3),
  /** Brand words to weave in for this run (used when postGenerator.brandVocabulary is on). */
  vocabulary: z.array(tag).max(30).optional(),
});

export const editDraftSchema = z.object({ caption: text(2200) });

export const queueDraftSchema = z.object({
  scheduledFor: isoDate,
  mediaUrl: z.url().max(2000).nullish(),
});

export const scheduledStatusQuery = z.object({ status: z.enum(["scheduled", "published", "cancelled", "failed"]).optional() });

export const createScheduledSchema = z.object({
  draftId: z.string().min(1).max(64),
  scheduledFor: isoDate,
  mediaUrl: z.url().max(2000).nullish(),
});

export const rescheduleSchema = z.object({ scheduledFor: isoDate });

export const applyWindowSchema = z.object({
  /** Defaults to the experiment's suggested window. */
  window: z.enum(["morning", "afternoon", "evening"]).optional(),
});

// Engagement -------------------------------------------------------------------

/** Keywords of a keyword reply rule: each must keep a letter or digit once punctuation and emojis are ignored; duplicates are dropped. */
const keywords = z
  .array(tag.refine((k) => normalizeText(k).length > 0, "Use letters or numbers."))
  .min(1)
  .max(MAX_RULE_KEYWORDS)
  .transform((list) => list.filter((k, i) => list.findIndex((other) => normalizeText(other) === normalizeText(k)) === i));

const ruleFields = {
  keywords,
  matchType: z.enum(["word", "exact"]),
  /** Public reply under the comment. */
  commentReply: text(PUBLIC_REPLY_MAX),
  /** Private DM to the commenter; "" for none. */
  dmMessage: z.string().trim().max(PRIVATE_REPLY_MAX),
  scope: z.enum(["all", "selected"]),
  /** Instagram media ids, for scope "selected". */
  mediaIds: z.array(z.string().trim().min(1).max(64)).max(MAX_RULE_POSTS),
  autoSend: z.boolean(),
  active: z.boolean(),
};

const selectedNeedsPosts = (v: { scope?: "all" | "selected"; mediaIds?: string[] }) => v.scope !== "selected" || (v.mediaIds?.length ?? 0) > 0;

export const createRuleSchema = z
  .object({
    ...ruleFields,
    matchType: ruleFields.matchType.default("word"),
    dmMessage: ruleFields.dmMessage.default(""),
    scope: ruleFields.scope.default("all"),
    mediaIds: ruleFields.mediaIds.default([]),
    autoSend: ruleFields.autoSend.default(true),
    active: ruleFields.active.default(true),
  })
  .refine(selectedNeedsPosts, { message: "Pick at least one post.", path: ["mediaIds"] });

export const updateRuleSchema = z
  .object(ruleFields)
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update.");

export const replyStatusQuery = z.object({ status: z.enum(["pending", "approved", "dismissed", "posted", "expired", "unavailable"]).optional() });

export const editReplySchema = z.object({ draftReply: text(DM_REPLY_MAX) });

/** PATCH /api/methods/:mediaId */
export const postMethodPatchSchema = z
  .object({ method: z.enum(METHODS), promoted: z.boolean() })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update.");

/** POST /api/reply-drafts/:id/regenerate */
export const regenerateReplySchema = z.object({ tone: z.enum(REGENERATE_TONES).nullish() });

/** Approve may carry the final text (e.g. edited, or the WhatsApp price reply). */
export const approveReplySchema = z.object({ draftReply: z.string().max(DM_REPLY_MAX).optional() });

export const engagementSettingsSchema = z
  .object({ autoReply: z.boolean(), priceQuestionsToWhatsApp: z.boolean() })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update.");

export const brandVoiceSchema = z
  .object({
    toneLevel: z.number().int().min(0).max(100),
    defaultHashtags: z.array(tag).max(30),
    brandWords: z.array(tag).max(30),
    whatsappNumber: optionalText(30),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update.");

// Admin ------------------------------------------------------------------------

const businessFields = {
  name: text(120),
  nameAr: optionalText(120),
  instagramHandle: handleSchema,
  category: optionalText(120),
  categoryAr: optionalText(120),
  location: text(120),
  locationAr: optionalText(120),
  avatarUrl: z.string().trim().max(2000).nullish(),
  timezone: z
    .string()
    .refine((tz) => Intl.supportedValuesOf("timeZone").includes(tz) || tz === "UTC", "Unknown time zone."),
};

export const createBusinessSchema = z.object({
  ...businessFields,
  timezone: businessFields.timezone.default("Asia/Kuwait"),
  plan: planSchema,
  /** Optionally create the business's login in the same step. */
  owner: z.object({ email: emailSchema, name: text(120), password: newPasswordSchema }).optional(),
});

export const updateBusinessSchema = z
  .object({ ...businessFields, plan: planSchema })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update.");

export const adminListBusinessesQuery = z.object({
  q: z.string().trim().max(100).optional(),
  plan: planSchema.optional(),
});

export const featureKeySchema = z.enum(FEATURE_KEYS);

export const updatePermissionsSchema = z.object({
  changes: z.partialRecord(featureKeySchema, z.boolean()).refine((v) => Object.keys(v).length > 0, "Nothing to update."),
});

export const applyPresetSchema = z.object({
  plan: planSchema,
  /** Also switch the business to this plan (default true). */
  setPlan: z.boolean().default(true),
});

export const adminListUsersQuery = z.object({
  q: z.string().trim().max(100).optional(),
  role: z.enum(["admin", "user"]).optional(),
  status: z.enum(["active", "suspended"]).optional(),
  businessId: z.string().max(64).optional(),
});

export const createUserSchema = z
  .object({
    email: emailSchema,
    name: text(120),
    password: newPasswordSchema,
    role: z.enum(["admin", "user"]),
    businessId: z.string().max(64).nullish(),
    avatarUrl: z.string().trim().max(2000).nullish(),
  })
  .refine((v) => (v.role === "user" ? Boolean(v.businessId) : !v.businessId), {
    message: "Users need a business; admins must not have one.",
    path: ["businessId"],
  });

export const updateUserSchema = z
  .object({
    email: emailSchema,
    name: text(120),
    role: z.enum(["admin", "user"]),
    businessId: z.string().max(64).nullable(),
    avatarUrl: z.string().trim().max(2000).nullable(),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update.");

export const adminResetPasswordSchema = z.union([
  /** Set a new password directly. */
  z.object({ password: newPasswordSchema }),
  /** Email the user a reset link instead. */
  z.object({ sendEmail: z.literal(true) }),
]);

/** Per-plan limits an admin can set (System page). */
export const planLimitsSchema = z
  .object({ starter: z.object({ competitors: z.number().int().min(1).max(MAX_COMPETITORS_LIMIT) }), growth: z.object({ competitors: z.number().int().min(1).max(MAX_COMPETITORS_LIMIT) }), pro: z.object({ competitors: z.number().int().min(1).max(MAX_COMPETITORS_LIMIT) }) })
  .partial();

export const adminSettingsPatchSchema = z.object({ selfSignupPlan: planSchema, requireInstagramConnection: z.boolean(), planLimits: planLimitsSchema }).partial().strict().refine((v) => Object.keys(v).length > 0, "Nothing to update.");

// Onboarding & brand profile -----------------------------------------------------

export const businessTypeSchema = z.enum(BUSINESS_TYPES);
export const postPurposeSchema = z.enum(POST_PURPOSES);
export const onboardingStepSchema = z.enum(ONBOARDING_STEPS);
export const eventStepSchema = z.enum(EVENT_STEPS);
const chip = z.string().trim().min(1).max(60);
const hexColor = z.string().trim().regex(HEX_COLOR, "Use a colour like #c08552.").transform((v) => v.toLowerCase());

/** Step 2 — Your business. (The posting language is learned from the captions, not asked.) */
export const businessProfileSchema = z
  .object({
    businessType: businessTypeSchema,
    businessTypeOther: optionalText(60),
    location: text(120),
    description: text(600),
    products: z.array(chip).min(1, "Add at least one product or service.").max(20),
    targetAudience: optionalText(300),
  })
  .refine((v) => v.businessType !== "other" || Boolean(v.businessTypeOther), { message: "Describe your business type.", path: ["businessTypeOther"] });

export const onboardingCompetitorSchema = z.object({ handle: handleSchema, displayName: optionalText(60) });

/** Wizard navigation. `direction` says whether the user moved on, went back, or jumped (Edit links). */
export const onboardingProgressSchema = z.object({
  step: onboardingStepSchema,
  direction: z.enum(["forward", "back", "jump"]),
  /** e.g. { skipped: true } when Instagram was skipped. */
  details: z.record(z.string(), z.unknown()).optional(),
});

/** Events the browser reports (step opened, client-side validation, leaving the page). */
export const onboardingEventSchema = z.object({
  step: eventStepSchema,
  event: z.enum(["started", "error", "abandoned"]),
  details: z.record(z.string().max(60), z.unknown()).optional(),
});

export const feedbackSchema = z.object({
  step: eventStepSchema,
  note: text(2000),
  /** Screenshot-free context collected by the browser (locale, theme, viewport, step state). */
  context: z.record(z.string().max(60), z.unknown()).optional(),
});

const purposeFields = {
  purpose: postPurposeSchema,
  purposeOther: optionalText(60),
  purposeNote: optionalText(140),
};
const requireOtherLabel = <T extends { purpose?: string; purposeOther?: string | null }>(v: T) => v.purpose !== "other" || Boolean(v.purposeOther);
const otherLabelIssue = { message: "Describe the purpose.", path: ["purposeOther"] };

/** A brand post picked from the connected Instagram account (uploads use multipart, see brandPostUploadFields). */
export const brandPostFromInstagramSchema = z
  .object({ igMediaId: z.string().trim().min(1).max(120), caption: z.string().trim().max(2200).optional(), ...purposeFields, order: z.number().int().min(0).max(50).optional() })
  .refine(requireOtherLabel, otherLabelIssue);

/** The text fields that travel with an uploaded brand post (multipart form fields). */
export const brandPostUploadFields = z
  .object({ caption: z.string().trim().max(2200).default(""), ...purposeFields, order: z.coerce.number().int().min(0).max(50).optional() })
  .refine(requireOtherLabel, otherLabelIssue);

export const updateBrandPostSchema = z
  .object({ caption: z.string().trim().max(2200), ...purposeFields })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update.")
  .refine((v) => v.purpose === undefined || requireOtherLabel(v), otherLabelIssue);

/** Replace a post's media with another Instagram post (uploads use multipart). */
export const replaceBrandMediaSchema = z.object({ igMediaId: z.string().trim().min(1).max(120) });

/** Step 5 — Brand basics. */
/** Step 5 sends everything but `languages`; Settings → Brand profile sends `languages` alone. */
export const brandBasicsSchema = z
  .object({
    colors: z.array(hexColor).max(MAX_BRAND_COLORS),
    languages: z.array(z.enum(INSTAGRAM_LANGUAGES)).min(1, "Pick at least one language.").max(2),
    toneLevel: z.number().int().min(0).max(100),
    wordsToUse: z.array(chip).max(30),
    wordsToAvoid: z.array(chip).max(30),
  })
  .partial()
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: "Nothing to save." });

export const styleNotesSchema = z.object({ summary: z.string().trim().max(1000).default(""), traits: z.array(z.string().trim().min(1).max(120)).max(12).default([]) });
export const captionStyleSchema = styleNotesSchema.extend({ hashtags: z.array(z.string().trim().min(1).max(60)).max(15).default([]) });
export const purposePatternSchema = z.object({ purpose: postPurposeSchema, label: z.string().trim().max(60).nullable().default(null), description: z.string().trim().max(600) });

/** Edits to the brand context ("Here's what we learned" and Settings → Brand profile). */
export const brandContextPatchSchema = z
  .object({
    summary: z.string().trim().min(1).max(1500),
    visualStyle: styleNotesSchema,
    captionStyle: captionStyleSchema,
    purposePatterns: z.array(purposePatternSchema).max(14),
    colors: z.array(hexColor).max(MAX_BRAND_COLORS),
    toneLevel: z.number().int().min(0).max(100),
    wordsToUse: z.array(chip).max(30),
    wordsToAvoid: z.array(chip).max(30),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update.");

export const signupSchema = z.object({
  name: text(120),
  email: emailSchema,
  password: newPasswordSchema,
  businessName: text(120),
});

export const activityQuery = z.object({
  businessId: z.string().max(64).optional(),
  action: z.string().max(60).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

/** POST /api/assistant/messages — a question for the AI assistant (no conversationId = a new chat). */
export const assistantMessageSchema = z.object({
  conversationId: z.string().min(1).max(64).regex(/^[\w-]+$/).optional(),
  mode: z.enum(ASSISTANT_MODES),
  text: text(ASSISTANT_MAX_QUESTION),
});

/** PATCH /api/recommendations/:id — the owner's decision ("new" undoes accept/dismiss). */
export const recommendationStatusSchema = z.object({ status: z.enum(["new", "accepted", "dismissed", "done"]) });

const hashtagItem = z.string().trim().min(2).max(60).transform((v) => `#${v.replace(/^#+/, "")}`);

/** PUT /api/onboarding/brand — "Confirm your brand" (everything optional but the name). */
export const onboardingBrandSchema = z.object({
  businessName: text(120),
  businessType: z.enum(BUSINESS_TYPES).nullable(),
  niche: optionalText(80),
  toneLevel: z.number().int().min(0).max(100),
  hashtags: z.array(hashtagItem).max(12),
  products: z.array(z.string().trim().min(1).max(60)).max(10),
  exampleCaption: optionalText(2200),
});

/** Aim, goals and timeline (onboarding "Goals", Settings → Goals, the one-time prompt). */
export const goalsSchema = z.object({
  aim: z.enum(BUSINESS_AIMS),
  goals: z.array(z.enum(BUSINESS_GOALS)).min(1).max(BUSINESS_GOALS.length),
  timeline: z.enum(GOAL_TIMELINES),
  /** Settings and the prompt also edit the niche. */
  niche: optionalText(80).optional(),
});

/** POST /api/onboarding/prefill — the language the niche is suggested in. */
export const prefillSchema = z.object({ locale: z.enum(["en", "ar"]).default("en") });

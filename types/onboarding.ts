import type { BusinessType, EventStepId, InstagramLanguage, OnboardingStepId, PostPurpose } from "@/config/onboarding";
import type { ConnectFlow, InstagramConnectionDto, IntegrationEventDto } from "./api";
import type { PlanId } from "./permissions";

export type { BusinessType, EventStepId, InstagramLanguage, OnboardingStepId, PostPurpose };

export type OnboardingStatus = "in_progress" | "completed";
export type BusinessSource = "admin_created" | "self_signup";
export type CompetitorValidation = "ready" | "not_business" | "private" | "not_found" | "own_account";
export type OnboardingEventType = "started" | "completed" | "back" | "error" | "abandoned";

// ─── Brand profile ───────────────────────────────────────────────────────────

export interface BrandPostDto {
  id: string;
  source: "upload" | "instagram";
  igMediaId: string | null;
  mediaUrl: string | null;
  mediaType: "image" | "video";
  caption: string;
  purpose: PostPurpose;
  purposeOther: string | null;
  purposeNote: string | null;
  order: number;
}

/** Step 5 inputs: what the business told us, before (and besides) the AI's take. */
export interface BrandBasicsDto {
  colors: string[];
  /** Posting language(s), learned from the captions when the profile is built; editable in Settings. */
  languages: InstagramLanguage[];
  logoUrl: string | null;
  /** 0 = formal Arabic … 100 = casual Kuwaiti. */
  toneLevel: number;
  wordsToUse: string[];
  wordsToAvoid: string[];
}

export interface StyleNotes {
  summary: string;
  traits: string[];
}

export interface CaptionStyle extends StyleNotes {
  hashtags: string[];
}

export interface PurposePattern {
  purpose: PostPurpose;
  /** The business's own words when purpose is "other". */
  label: string | null;
  description: string;
}

export interface BrandContextDto extends Omit<BrandBasicsDto, "languages"> {
  id: string;
  version: number;
  status: "building" | "ready" | "failed";
  summary: string;
  visualStyle: StyleNotes;
  captionStyle: CaptionStyle;
  purposePatterns: PurposePattern[];
  editedByUser: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Editable fields of a brand context. */
export type BrandContextPatch = Partial<
  Pick<BrandContextDto, "summary" | "visualStyle" | "captionStyle" | "purposePatterns" | "colors" | "toneLevel" | "wordsToUse" | "wordsToAvoid">
>;

/** Settings → Brand profile, and the admin's read-only view. */
export interface BrandProfileDto {
  context: BrandContextDto | null;
  versions: Array<{ version: number; status: BrandContextDto["status"]; editedByUser: boolean; createdAt: string }>;
  posts: BrandPostDto[];
  basics: BrandBasicsDto;
}

// ─── Onboarding wizard ───────────────────────────────────────────────────────

export interface BusinessProfileDto {
  name: string;
  businessType: BusinessType | null;
  businessTypeOther: string | null;
  location: string;
  description: string | null;
  products: string[];
  targetAudience: string | null;
}

export interface OnboardingCompetitorDto {
  id: string;
  handle: string;
  displayName: string | null;
  status: CompetitorValidation;
  /** Instagram profile name (Ready accounts only). */
  name: string | null;
  avatarUrl: string | null;
  followers: number;
  lastValidatedAt: string | null;
}

export interface OnboardingStateDto {
  status: OnboardingStatus;
  step: OnboardingStepId;
  email: string;
  emailVerified: boolean;
  business: BusinessProfileDto;
  /** `required`: admins require a connection to finish onboarding (System setting). */
  instagram: InstagramConnectionDto & { handle: string | null; required: boolean };
  competitors: OnboardingCompetitorDto[];
  posts: BrandPostDto[];
  brand: BrandBasicsDto;
  brandContext: BrandContextDto | null;
}

/** Instagram media offered in the post picker. */
export interface PickableMediaDto {
  id: string;
  mediaUrl: string | null;
  mediaType: "image" | "video";
  caption: string;
  postedAt: string;
  likes: number;
}

// ─── Admin ───────────────────────────────────────────────────────────────────

export interface AdminOnboardingBusinessDto {
  id: string;
  name: string;
  avatarUrl: string | null;
  owner: { name: string; email: string; emailVerified: boolean } | null;
  source: BusinessSource;
  status: OnboardingStatus;
  step: OnboardingStepId;
  /** Furthest step reached. */
  reached: OnboardingStepId;
  plan: PlanId;
  createdAt: string;
  completedAt: string | null;
  lastEventAt: string | null;
  /** Milliseconds spent per step (sum of completed, back and abandoned visits). */
  timePerStep: Partial<Record<OnboardingStepId, number>>;
  errorCount: number;
  errors: Array<{ id: string; step: EventStepId; details: unknown; createdAt: string }>;
  feedback: Array<{ id: string; step: EventStepId; note: string; userName: string | null; createdAt: string }>;
  /** Recent Meta integration events (newest first) — lab testing of real connections. */
  integrationEvents: IntegrationEventDto[];
}

export interface AdminOnboardingDto {
  /** Self sign-ups that reached each step, ending with those that finished. */
  funnel: Array<{ step: EventStepId | "completed"; reached: number }>;
  totals: { signups: number; completed: number; inProgress: number; withErrors: number; feedback: number };
  businesses: AdminOnboardingBusinessDto[];
}

export interface AdminSettingsDto {
  selfSignupPlan: PlanId;
  /** Onboarding can't be finished without connecting Instagram (default off). */
  requireInstagramConnection: boolean;
  /** Read-only: the Meta integration's state (for the System page). */
  meta: { flow: ConnectFlow; configured: boolean; graphVersion: string | null; missing: string[] };
}

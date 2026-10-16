import "server-only";
import { hashPassword } from "@/lib/auth/password";
import { db } from "@/lib/db";
import { Prisma, type Plan } from "@/lib/generated/prisma/client";
import { EmailSendError } from "@/lib/services/email";
import { logActivity } from "./activity";
import { sendVerificationEmail } from "./email-verification";
import { recordEvent } from "./onboarding";
import { presetRows } from "./permissions";
import { getSelfSignupPlan } from "./settings";

export interface SignupInput {
  name: string;
  email: string;
  password: string;
  businessName: string;
  /** Language the sign-up page was shown in; saved so the app stays in it. */
  language: "en" | "ar";
}

export class EmailTakenError extends Error {}

/**
 * Public sign-up: a USER and their Business (self sign-up, onboarding in
 * progress) on the admin-configured default plan, with that plan's preset
 * permissions. Sends the verification link; the user can onboard before
 * clicking it (`emailSent` is false when that email failed). Throws
 * EmailTakenError for an address that already has an account.
 */
export async function createSelfSignup(input: SignupInput, baseUrl: string): Promise<{ userId: string; businessId: string; emailSent: boolean }> {
  if (await db.user.findUnique({ where: { email: input.email }, select: { id: true } })) throw new EmailTakenError();
  const plan = await getSelfSignupPlan();
  const passwordHash = await hashPassword(input.password);

  let created: { userId: string; businessId: string };
  try {
    created = await db.$transaction(async (tx) => {
      const business = await tx.business.create({
        data: {
          name: input.businessName,
          location: "",
          plan: plan.toUpperCase() as Plan,
          source: "SELF_SIGNUP",
          onboardingStatus: "IN_PROGRESS",
          onboardingStep: 1,
          permissions: { create: presetRows(plan) },
          brandVoice: { create: { defaultHashtags: [], brandWords: [], wordsToAvoid: [] } },
        },
        select: { id: true },
      });
      const user = await tx.user.create({
        data: {
          email: input.email,
          name: input.name,
          passwordHash,
          role: "USER",
          businessId: business.id,
          memberships: { create: { businessId: business.id } },
          uiPreferences: { sidebarCollapsed: false, theme: "dark", language: input.language },
        },
        select: { id: true },
      });
      await logActivity({ businessId: business.id, userId: user.id, action: "business.self_signup", details: { name: input.businessName, plan } }, tx);
      await recordEvent(business.id, "signup", "completed", { details: { plan } }, tx);
      return { userId: user.id, businessId: business.id };
    });
  } catch (error) {
    // Two sign-ups racing for the same address.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new EmailTakenError();
    throw error;
  }

  // A failed email shouldn't undo the account — the banner says so and offers "Resend".
  // (EmailSendError is already logged without secrets by the email service.)
  const emailSent = await sendVerificationEmail(created.userId, baseUrl).then(
    () => true,
    (error) => {
      if (!(error instanceof EmailSendError)) console.error("[signup] verification email failed", error);
      return false;
    },
  );
  return { ...created, emailSent };
}

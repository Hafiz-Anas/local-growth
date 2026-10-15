/**
 * Development seed: `npm run db:seed` (also runs after `npm run db:reset`).
 *
 * Wipes every table, then creates the demo admin, three businesses with their
 * users, permissions (plan preset + a few overrides) and sample data for every
 * model, taken from the same mock packs the UI shows. Mock timestamps are
 * shifted so "now" in the mock data is the moment the seed runs.
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { FEATURE_KEYS } from "../config/features";
import { DEMO_ACCOUNTS } from "../config/demo";
import { PLAN_PRESETS } from "../config/plans";
import { encrypt } from "../lib/crypto";
import { Plan, PrismaClient, type ConnectionStatus as DbConnectionStatus } from "../lib/generated/prisma/client";
import { MOCK_ACTIVITY } from "../mock-data/admin";
import { CLIENT_DATA } from "../mock-data/client-data";
import { MOCK_CLIENTS } from "../mock-data/clients";
import { MOCK_PERMISSIONS } from "../mock-data/permissions";
import { generatedMedia, growthShare } from "../mock-data/posts";
import type { ActivityKind, Client } from "../types";
import { describeDatabase, isProductionTarget } from "../scripts/db-target";

// The seed wipes every table: it must never run against production (Neon / Vercel).
if (isProductionTarget(process.env.DATABASE_URL)) {
  console.error(`Refusing to seed ${describeDatabase(process.env.DATABASE_URL)}: it looks like a production database. The seed is for local development only.`);
  process.exit(1);
}

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

const DAY = 24 * 60 * 60 * 1000;
/** The moment the mock data was written for. */
const MOCK_NOW = Date.parse("2026-10-06T12:00:00+03:00");
const offset = Date.now() - MOCK_NOW;
const shift = (iso: string) => new Date(Date.parse(iso) + offset);
const isArabic = (text: string) => /[؀-ۿ]/.test(text);

/** Stable seed ids so the remaining mock screen data (until step 3) lines up with the database. */
const USER_IDS: Record<string, string> = {
  "admin@localgrowth.dev": "usr_admin",
  "user@mathanetbaity.dev": "usr_mathanet",
  "cafe@localgrowth.dev": "usr_cafe",
  "boutique@localgrowth.dev": "usr_boutique",
};

const ACTIONS: Record<ActivityKind, string> = {
  post_published: "post.published",
  reply_approved: "reply.approved",
  dm_rule_triggered: "dm_rule.triggered",
  connection_issue: "instagram.connection_issue",
  plan_changed: "business.plan_changed",
  experiment_finished: "experiment.finished",
};

async function wipe() {
  await db.activityLog.deleteMany();
  await db.feedback.deleteMany();
  await db.onboardingEvent.deleteMany();
  await db.brandContext.deleteMany();
  await db.brandPost.deleteMany();
  await db.emailVerificationToken.deleteMany();
  await db.systemSetting.deleteMany();
  await db.passwordResetToken.deleteMany();
  await db.replyDraft.deleteMany();
  await db.engagementRule.deleteMany();
  await db.postingExperiment.deleteMany();
  await db.scheduledPost.deleteMany();
  await db.postDraft.deleteMany();
  await db.competitor.deleteMany();
  await db.brandVoice.deleteMany();
  await db.instagramConnection.deleteMany();
  await db.featurePermission.deleteMany();
  await db.user.deleteMany();
  await db.business.deleteMany();
}

function connectionFor(client: Client, index: number) {
  const base = { igUserId: `1784140000000${index + 1}`, username: client.handle };
  const token = (days: number) => ({
    accessTokenEncrypted: encrypt(`mock-ig-token-${client.handle}`),
    tokenExpiresAt: new Date(Date.now() + days * DAY),
    lastSyncAt: new Date(Date.now() - 10 * 60 * 1000),
    connectedAt: client.connectedAt ? shift(client.connectedAt) : new Date(Date.now() - 90 * DAY),
  });
  switch (client.connection) {
    case "connected":
      return { ...base, ...token(50), status: "CONNECTED" as DbConnectionStatus };
    case "needs_attention":
      // Still connected, but the token runs out in 3 days → shown as "needs attention".
      return { ...base, ...token(3), status: "CONNECTED" as DbConnectionStatus };
    default:
      return { ...base, accessTokenEncrypted: null, tokenExpiresAt: null, connectedAt: null, lastSyncAt: shift(client.lastActivityAt), status: "DISCONNECTED" as DbConnectionStatus };
  }
}

async function seedBusiness(client: Client, index: number, passwordHash: string, adminId: string) {
  const pack = CLIENT_DATA[client.id];
  const account = DEMO_ACCOUNTS.find((a) => a.email === client.email)!;
  const ownerId = USER_IDS[account.email];

  await db.business.create({
    data: {
      id: client.id,
      name: client.businessName,
      nameAr: client.businessNameAr,
      instagramHandle: client.handle,
      category: client.category,
      categoryAr: client.categoryAr,
      location: client.location,
      locationAr: client.locationAr,
      avatarUrl: client.avatarUrl,
      plan: client.plan.toUpperCase() as Plan,
      createdAt: new Date(Date.now() - (120 - index * 30) * DAY),
      users: {
        create: {
          id: ownerId,
          email: account.email,
          passwordHash,
          name: account.name,
          avatarUrl: account.avatarUrl,
          role: "USER",
          notificationPrefs: { ...pack.settings.notifications },
          lastLoginAt: shift(client.lastActivityAt),
          emailVerifiedAt: new Date(Date.now() - (120 - index * 30) * DAY),
        },
      },
      permissions: {
        create: FEATURE_KEYS.map((featureKey) => ({ featureKey, enabled: MOCK_PERMISSIONS[client.id][featureKey] })),
      },
      instagramConnection: { create: connectionFor(client, index) },
      brandVoice: {
        create: {
          toneLevel: pack.settings.tone,
          defaultHashtags: pack.settings.defaultHashtags,
          brandWords: pack.settings.brandWords,
          priceQuestionsToWhatsApp: pack.engagement.settings.priceQuestionsToWhatsapp,
          whatsappNumber: client.whatsappNumber,
          autoReply: pack.engagement.settings.autoReply,
        },
      },
      competitors: {
        create: pack.competitors.competitors.map((c, i) => ({
          handle: c.handle,
          note: i === 0 ? "Main rival" : null,
          avatarUrl: c.avatarUrl,
          followers: c.followers,
          engagementRate: c.engagementRate,
          lastFetchedAt: shift(pack.competitors.updatedAt),
          lastValidatedAt: shift(pack.competitors.updatedAt),
        })),
      },
      engagementRules: {
        create: pack.engagement.rules.map((r) => ({
          keywords: r.keywords,
          commentReply: r.reply,
          dmMessage: r.message,
          active: r.active,
          timesTriggered: r.timesTriggered,
        })),
      },
      replyDrafts: {
        create: pack.engagement.replyQueue.map((c) => ({
          commentId: `ig_comment_${client.id}_${c.id}`,
          commentText: c.text,
          commenterUsername: c.author,
          commenterAvatarUrl: c.authorAvatarUrl,
          draftReply: c.draftReply,
          aiReply: c.draftReply,
          status: "PENDING" as const,
          createdAt: shift(c.postedAt),
        })),
      },
    },
  });

  // Content: the top post (published), the queue (scheduled), and a few drafts.
  const { categories, occasions, templates, brandVocabulary } = pack.generator;
  const categoryFor = (icon: string) => categories.find((c) => c.icon === icon)?.id ?? categories[0].id;

  const top = pack.dashboard.topPost;
  await db.postDraft.create({
    data: {
      businessId: client.id,
      category: categoryFor(top.icon),
      angle: occasions[0].id,
      caption: top.caption,
      language: isArabic(top.caption) ? "ar" : "en",
      status: "PUBLISHED",
      createdBy: ownerId,
      createdAt: new Date(shift(top.postedAt).getTime() - DAY),
      scheduledPosts: {
        create: {
          businessId: client.id,
          scheduledFor: shift(top.postedAt),
          status: "PUBLISHED",
          publishedMediaId: `ig_media_${top.id}`,
        },
      },
    },
  });

  for (const item of pack.experiment.queue) {
    await db.postDraft.create({
      data: {
        businessId: client.id,
        category: categoryFor(item.icon),
        angle: item.source === "manual" ? "manual" : occasions[0].id,
        caption: item.caption,
        language: isArabic(item.caption) ? "ar" : "en",
        status: "QUEUED",
        createdBy: ownerId,
        scheduledPosts: { create: { businessId: client.id, scheduledFor: shift(item.scheduledFor), status: "SCHEDULED" } },
      },
    });
  }

  const fill = (text: string, product: string) =>
    text.replaceAll("{product}", product).replaceAll("{word}", brandVocabulary[0] ?? "").replaceAll("{handle}", client.handle);
  for (const [i, template] of templates.slice(0, 3).entries()) {
    const category = categories[i % categories.length];
    await db.postDraft.create({
      data: {
        businessId: client.id,
        category: category.id,
        angle: template.occasionId === "*" ? occasions[0].id : template.occasionId,
        caption: `${fill(template.text, category.productNames[0])}\n\n${template.hashtags.join(" ")}`,
        language: template.language,
        status: i === 2 ? "REJECTED" : "DRAFT",
        createdBy: ownerId,
        createdAt: new Date(Date.now() - (i + 1) * 60 * 60 * 1000),
      },
    });
  }

  const exp = pack.experiment;
  await db.postingExperiment.create({
    data: {
      businessId: client.id,
      startDate: new Date(Date.now() - exp.daysSampled * DAY),
      dailyTarget: exp.dailyTarget,
      windows: exp.windows.map(({ id, startHour, endHour }) => ({ id, startHour, endHour })),
      status: exp.daysSampled >= exp.daysPlanned ? "COMPLETED" : "RUNNING",
    },
  });

  // Admin's customisations on top of the plan preset, as audit entries.
  const overrides = FEATURE_KEYS.filter((key) => MOCK_PERMISSIONS[client.id][key] !== PLAN_PRESETS[client.plan][key]);
  if (overrides.length) {
    await db.activityLog.create({
      data: {
        businessId: client.id,
        userId: adminId,
        action: "permissions.updated",
        details: { changes: Object.fromEntries(overrides.map((key) => [key, MOCK_PERMISSIONS[client.id][key]])) },
        createdAt: new Date(Date.now() - 2 * DAY),
      },
    });
  }

  await seedAnalysisHistory(client, pack);
}

/**
 * History for the analysis pages, so the demo charts aren't empty on day one: daily snapshots of
 * the mock posts for the last two weeks (growing like real posts do), and eight weekly snapshots
 * per competitor. The daily cron adds today's from then on.
 */
async function seedAnalysisHistory(client: Client, pack: (typeof CLIENT_DATA)[string]) {
  const now = Date.now();
  const top = pack.dashboard.topPost;
  const posts = [
    { id: top.id, postedAt: shift(top.postedAt).toISOString(), likes: top.likes, comments: top.comments, reach: top.reach, saves: top.saves, shares: Math.round(top.saves * 0.4), views: null as number | null },
    ...generatedMedia(client.handle, 12, now).map((m) => ({ ...m, shares: m.shares ?? null, views: m.views ?? null })),
  ];
  const scaled = (value: number | null, share: number) => (value === null ? null : Math.round(value * share));
  const snapshots = posts.flatMap((p) =>
    Array.from({ length: 14 }, (_, i) => i).flatMap((i) => {
      const day = new Date(now - (i + 1) * DAY);
      const age = (day.getTime() - Date.parse(p.postedAt)) / DAY;
      if (age < 0) return [];
      const share = growthShare(age);
      return [{ businessId: client.id, igMediaId: p.id, date: day.toISOString().slice(0, 10), likes: Math.round(p.likes * share), comments: Math.round(p.comments * share), reach: scaled(p.reach, share), saves: scaled(p.saves, share), shares: scaled(p.shares, share), views: scaled(p.views, share), takenAt: day }];
    }),
  );
  await db.postSnapshot.createMany({ data: snapshots, skipDuplicates: true });

  const competitors = await db.competitor.findMany({ where: { businessId: client.id }, select: { id: true, handle: true, followers: true, engagementRate: true } });
  for (const c of competitors) {
    const monthlyPct = pack.competitors.competitors.find((x) => x.handle === c.handle)?.followerChangePct ?? 2;
    const weekly = Math.pow(1 + monthlyPct / 100, 1 / 4.3);
    await db.competitorSnapshot.createMany({
      data: Array.from({ length: 8 }, (_, i) => {
        const weeksAgo = i + 1;
        return {
          competitorId: c.id,
          followers: Math.round(c.followers / Math.pow(weekly, weeksAgo)),
          mediaCount: 120 - weeksAgo * 3,
          engagementRate: Math.round((c.engagementRate + Math.sin(weeksAgo + c.handle.length) * 0.4) * 10) / 10,
          takenAt: new Date(now - weeksAgo * 7 * DAY),
        };
      }),
    });
  }
}

const SELF_SIGNUP_EMAIL = "bakery@localgrowth.dev";

/**
 * A self sign-up that stopped halfway through onboarding (step 3, competitors),
 * with the event trail and a problem report — so the admin Onboarding page has
 * data, and logging in as this user resumes the wizard at step 3.
 */
async function seedSelfSignup(passwordHash: string) {
  const account = DEMO_ACCOUNTS.find((a) => a.email === SELF_SIGNUP_EMAIL)!;
  const start = Date.now() - 2 * DAY;
  const at = (minutes: number) => new Date(start + minutes * 60 * 1000);
  const businessId = "cl_fereej";
  const userId = "usr_fereej";

  await db.business.create({
    data: {
      id: businessId,
      name: account.name,
      location: "Salmiya, Kuwait",
      plan: "STARTER",
      createdAt: at(0),
      source: "SELF_SIGNUP",
      onboardingStatus: "IN_PROGRESS",
      onboardingStep: 2,
      businessType: "bakery",
      description: "Fresh Kuwaiti and Levantine bakes every morning — fatayer, maamoul and celebration cakes, with delivery in Salmiya.",
      products: ["Cheese fatayer", "Date maamoul", "Saffron cake"],
      targetAudience: "Families and office breakfast orders in Salmiya",
      languages: ["ar", "en"],
      users: {
        create: { id: userId, email: account.email, passwordHash, name: account.name, role: "USER", createdAt: at(0), lastLoginAt: at(24 * 60) },
      },
      permissions: { create: FEATURE_KEYS.map((featureKey) => ({ featureKey, enabled: PLAN_PRESETS.starter[featureKey] })) },
      brandVoice: { create: { defaultHashtags: [], brandWords: [], wordsToAvoid: [] } },
      competitors: {
        create: [
          { handle: "salmiya.bakehouse", followers: 12400, engagementRate: 4.1, validationStatus: "READY", lastValidatedAt: at(8), lastFetchedAt: at(8) },
          { handle: "oven.and.co", followers: 8650, engagementRate: 3.6, validationStatus: "READY", lastValidatedAt: at(9), lastFetchedAt: at(9) },
          { handle: "private_breadclub", validationStatus: "PRIVATE", lastValidatedAt: at(10) },
          { handle: "personal_umm.ali", displayName: "Umm Ali's kitchen", validationStatus: "NOT_BUSINESS", lastValidatedAt: at(12) },
        ],
      },
    },
  });

  // signup → instagram skipped → business (one validation error) → competitors, abandoned twice.
  const events: Array<{ minute: number; step: string; event: "STARTED" | "COMPLETED" | "BACK" | "ERROR" | "ABANDONED"; durationMs?: number; details?: object }> = [
    { minute: 0, step: "signup", event: "COMPLETED", details: { plan: "starter" } },
    { minute: 0.5, step: "instagram", event: "STARTED" },
    { minute: 1.2, step: "instagram", event: "COMPLETED", durationMs: 42_000, details: { skipped: true } },
    { minute: 1.2, step: "business", event: "STARTED" },
    { minute: 3, step: "business", event: "ERROR", details: { kind: "validation", fields: ["products"], source: "browser" } },
    { minute: 5.7, step: "business", event: "COMPLETED", durationMs: 270_000 },
    { minute: 5.7, step: "competitors", event: "STARTED" },
    { minute: 10, step: "competitors", event: "ERROR", details: { kind: "competitor_lookup", handle: "private_breadclub", reason: "private" } },
    { minute: 12, step: "competitors", event: "ERROR", details: { kind: "competitor_lookup", handle: "personal_umm.ali", reason: "not_business" } },
    { minute: 15.5, step: "competitors", event: "ABANDONED", durationMs: 588_000, details: { reason: "page_closed" } },
    { minute: 24 * 60, step: "competitors", event: "STARTED" },
    { minute: 24 * 60 + 3, step: "competitors", event: "ABANDONED", durationMs: 186_000, details: { reason: "logged_out" } },
  ];
  await db.onboardingEvent.createMany({
    data: events.map((e) => ({ businessId, step: e.step, event: e.event, durationMs: e.durationMs ?? null, details: e.details ?? {}, createdAt: at(e.minute) })),
  });

  await db.feedback.create({
    data: {
      businessId,
      userId,
      step: "competitors",
      note: "Two of the bakeries I compete with are private or personal accounts. I only know 3 public ones in Salmiya — can I add bakeries from other areas?",
      context: { locale: "en", theme: "light", viewport: "390×844", path: "/onboarding", ready: 2, listed: 4 },
      createdAt: at(14),
    },
  });

  await db.activityLog.createMany({
    data: [
      { businessId, userId, action: "business.self_signup", details: { name: account.name, plan: "starter" }, createdAt: at(0) },
      { businessId, userId, action: "onboarding.instagram_skipped", createdAt: at(1.2) },
      { businessId, userId, action: "competitor.added", details: { handle: "salmiya.bakehouse" }, createdAt: at(8) },
      { businessId, userId, action: "competitor.added", details: { handle: "oven.and.co" }, createdAt: at(9) },
    ],
  });
}

async function main() {
  if (!process.env.ENCRYPTION_KEY) throw new Error("ENCRYPTION_KEY is not set — copy .env.example to .env first.");

  console.log("Seeding database…");
  await wipe();

  const hashes = new Map<string, string>();
  for (const account of DEMO_ACCOUNTS) hashes.set(account.email, await bcrypt.hash(account.password, 12));

  const adminAccount = DEMO_ACCOUNTS.find((a) => a.role === "admin")!;
  const admin = await db.user.create({
    data: {
      id: USER_IDS[adminAccount.email],
      email: adminAccount.email,
      passwordHash: hashes.get(adminAccount.email)!,
      name: adminAccount.name,
      avatarUrl: adminAccount.avatarUrl,
      role: "ADMIN",
      lastLoginAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
      emailVerifiedAt: new Date(Date.now() - 200 * DAY),
    },
  });

  // Default plan for self sign-ups (admin System page).
  await db.systemSetting.create({ data: { key: "selfSignupPlan", value: "starter" } });

  for (const [index, client] of MOCK_CLIENTS.entries()) {
    await seedBusiness(client, index, hashes.get(client.email)!, admin.id);
  }
  await seedSelfSignup(hashes.get(SELF_SIGNUP_EMAIL)!);

  await db.activityLog.createMany({
    data: MOCK_ACTIVITY.map((item) => ({
      businessId: item.clientId,
      userId: item.kind === "plan_changed" ? admin.id : MOCK_CLIENTS.find((c) => c.id === item.clientId)!.userId,
      action: ACTIONS[item.kind],
      details: { message: item.message, messageAr: item.messageAr },
      createdAt: shift(item.at),
    })),
  });

  const counts = {
    users: await db.user.count(),
    businesses: await db.business.count(),
    featurePermissions: await db.featurePermission.count(),
    instagramConnections: await db.instagramConnection.count(),
    brandVoices: await db.brandVoice.count(),
    competitors: await db.competitor.count(),
    postDrafts: await db.postDraft.count(),
    scheduledPosts: await db.scheduledPost.count(),
    postingExperiments: await db.postingExperiment.count(),
    engagementRules: await db.engagementRule.count(),
    replyDrafts: await db.replyDraft.count(),
    onboardingEvents: await db.onboardingEvent.count(),
    feedback: await db.feedback.count(),
    activityLogs: await db.activityLog.count(),
  };
  console.table(counts);
  console.log("Demo logins:");
  for (const a of DEMO_ACCOUNTS) console.log(`  ${a.role.padEnd(5)}  ${a.email.padEnd(26)}  ${a.password}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());

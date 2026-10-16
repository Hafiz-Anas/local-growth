import { db } from "@/lib/db";
import type { Plan } from "@/lib/generated/prisma/client";
import { logActivity } from "@/lib/server/activity";
import { getAdminBusiness } from "@/lib/server/admin";
import { requireRole } from "@/lib/server/guards";
import { handler, notFound, ok, readJson, readParams } from "@/lib/server/http";
import { getStorageService } from "@/lib/services/storage";
import { updateBusinessSchema } from "@/lib/validation/api";

type Ctx = RouteContext<"/api/admin/businesses/[id]">;

/** GET /api/admin/businesses/:id */
export const GET = handler(async (_request, context: Ctx) => {
  await requireRole("ADMIN");
  const { id } = await readParams(context, "id");
  return ok(await getAdminBusiness(id));
});

/**
 * PATCH /api/admin/businesses/:id  { name?, instagramHandle?, location?, plan?, … }
 * Changing the plan does not touch permissions — apply a preset for that.
 */
export const PATCH = handler(async (request, context: Ctx) => {
  const session = await requireRole("ADMIN");
  const { id } = await readParams(context, "id");
  const before = await db.business.findUnique({ where: { id }, select: { plan: true } });
  if (!before) throw notFound("Business");
  const { plan, ...fields } = await readJson(request, updateBusinessSchema);

  await db.$transaction(async (tx) => {
    await tx.business.update({ where: { id }, data: { ...fields, ...(plan && { plan: plan.toUpperCase() as Plan }) } });
    if (Object.keys(fields).length) {
      await logActivity({ businessId: id, userId: session.userId, action: "business.updated", details: { fields: Object.keys(fields) } }, tx);
    }
    if (plan && plan.toUpperCase() !== before.plan) {
      await logActivity({ businessId: id, userId: session.userId, action: "business.plan_changed", details: { from: before.plan.toLowerCase(), to: plan } }, tx);
    }
  });
  return ok(await getAdminBusiness(id));
});

/**
 * DELETE /api/admin/businesses/:id — removes the business (one Instagram account) and all of its
 * data, and the logins that have no other Instagram account. Logins with other accounts keep
 * them: if this one was active, their oldest other account becomes active.
 */
export const DELETE = handler(async (_request, context: Ctx) => {
  const session = await requireRole("ADMIN");
  const { id } = await readParams(context, "id");
  const business = await db.business.findUnique({
    where: { id },
    select: {
      name: true,
      instagramHandle: true,
      avatarUrl: true,
      members: { select: { user: { select: { id: true, avatarUrl: true, businessId: true, memberships: { where: { businessId: { not: id } }, select: { businessId: true }, orderBy: { createdAt: "asc" }, take: 1 } } } } },
    },
  });
  if (!business) throw notFound("Business");

  const users = business.members.map((m) => m.user);
  // Logins with another account switch to it; logins with only this one are removed with it.
  const staying = users.filter((u) => u.memberships.length > 0);
  await db.$transaction(async (tx) => {
    for (const u of staying) if (u.businessId === id) await tx.user.update({ where: { id: u.id }, data: { businessId: u.memberships[0].businessId } });
    await tx.user.deleteMany({ where: { id: { in: users.filter((u) => u.memberships.length === 0).map((u) => u.id) } } });
    await tx.business.delete({ where: { id } });
    // The business row is gone, so the entry is platform-level; details keep the reference.
    await logActivity({ userId: session.userId, action: "business.deleted", details: { businessId: id, name: business.name, handle: business.instagramHandle } }, tx);
  });

  const storage = getStorageService();
  const stayingAvatars = new Set(staying.map((u) => u.avatarUrl));
  for (const url of new Set([business.avatarUrl, ...users.map((u) => u.avatarUrl).filter((url) => !stayingAvatars.has(url))])) {
    const key = url ? storage.keyFromUrl(url) : null;
    if (key) await storage.delete(key);
  }
  return ok({ deleted: true });
});

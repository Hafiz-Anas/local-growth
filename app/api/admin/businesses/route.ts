import { db } from "@/lib/db";
import type { Plan } from "@/lib/generated/prisma/client";
import { hashPassword } from "@/lib/auth/password";
import { assertIdentityFree } from "@/lib/server/user-identity";
import { resolveIdentity } from "@/lib/usernames";
import { logActivity } from "@/lib/server/activity";
import { ADMIN_BUSINESS_SELECT, getAdminBusiness, toAdminBusiness } from "@/lib/server/admin";
import { requireRole } from "@/lib/server/guards";
import { handler, ok, readJson, readQuery } from "@/lib/server/http";
import { presetRows } from "@/lib/server/permissions";
import { adminListBusinessesQuery, createBusinessSchema } from "@/lib/validation/api";

/** GET /api/admin/businesses?q=&plan= */
export const GET = handler(async (request) => {
  await requireRole("ADMIN");
  const { q, plan } = readQuery(request, adminListBusinessesQuery);
  const rows = await db.business.findMany({
    where: {
      ...(plan && { plan: plan.toUpperCase() as Plan }),
      ...(q && {
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { nameAr: { contains: q, mode: "insensitive" } },
          { instagramHandle: { contains: q.replace(/^@/, ""), mode: "insensitive" } },
        ],
      }),
    },
    select: ADMIN_BUSINESS_SELECT,
    orderBy: { createdAt: "asc" },
  });
  return ok(rows.map(toAdminBusiness));
});

/**
 * POST /api/admin/businesses  { name, instagramHandle, location, plan, …, owner? }
 * Creates the business with its plan's preset permissions, an empty brand
 * voice, and optionally its login.
 */
export const POST = handler(async (request) => {
  const session = await requireRole("ADMIN");
  const { owner, plan, ...fields } = await readJson(request, createBusinessSchema);
  const identity = owner ? resolveIdentity(owner) : null;
  if (identity) await assertIdentityFree(identity);
  const passwordHash = owner ? await hashPassword(owner.password) : null;

  const business = await db.$transaction(async (tx) => {
    const created = await tx.business.create({
      data: {
        ...fields,
        avatarUrl: fields.avatarUrl ?? null,
        plan: plan.toUpperCase() as Plan,
        permissions: { create: presetRows(plan) },
        brandVoice: { create: { defaultHashtags: [], brandWords: [] } },
      },
      select: { id: true },
    });
    await logActivity({ businessId: created.id, userId: session.userId, action: "business.created", details: { name: fields.name, plan } }, tx);
    if (owner && passwordHash && identity) {
      const user = await tx.user.create({
        data: { username: identity.username, email: identity.email, name: owner.name, passwordHash, role: "USER", businessId: created.id, avatarUrl: fields.avatarUrl ?? null, memberships: { create: { businessId: created.id } } },
        select: { id: true },
      });
      await logActivity({ businessId: created.id, userId: session.userId, action: "user.created", details: { targetUserId: user.id, login: identity.username ?? identity.email } }, tx);
    }
    return created;
  });
  return ok(await getAdminBusiness(business.id), { status: 201 });
});

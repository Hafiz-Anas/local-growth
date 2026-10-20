import "server-only";
import { hashPassword } from "@/lib/auth/password";
import { db } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { logActivity } from "./activity";

/**
 * Sets a user's password and ends ALL of their existing sessions: bumping
 * `sessionVersion` makes every JWT issued before this point fail the
 * per-request check in auth.ts. Unused reset links and the logins remembered on devices
 * (RememberedLogin, lib/server/device-logins.ts) are discarded too.
 */
export async function setPassword(
  userId: string,
  password: string,
  audit: { actorId: string | null; action: "user.password_reset" | "user.password_changed" | "admin.user_password_reset" },
  client?: Prisma.TransactionClient,
) {
  const passwordHash = await hashPassword(password);
  const run = async (tx: Prisma.TransactionClient) => {
    const user = await tx.user.update({
      where: { id: userId },
      data: { passwordHash, sessionVersion: { increment: 1 } },
      select: { businessId: true },
    });
    await tx.passwordResetToken.deleteMany({ where: { userId, usedAt: null } });
    await tx.rememberedLogin.deleteMany({ where: { userId } });
    await logActivity({ businessId: user.businessId, userId: audit.actorId, action: audit.action, details: { targetUserId: userId } }, tx);
  };
  if (client) await run(client);
  else await db.$transaction(run);
}

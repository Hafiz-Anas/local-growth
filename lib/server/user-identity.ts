import "server-only";
import { db } from "@/lib/db";
import { ApiError } from "./http";

/** Refuses a username or email another login already has (a username also blocks its placeholder address). */
export async function assertIdentityFree(identity: { username: string | null; email: string }) {
  const taken = await db.user.findFirst({
    where: { OR: [{ email: identity.email }, ...(identity.username ? [{ username: identity.username }] : [])] },
    select: { username: true },
  });
  if (taken) {
    const field = identity.username && taken.username === identity.username ? "username" : "email";
    throw new ApiError(409, "conflict", `That ${field} is already in use.`, [{ path: field, message: "taken" }]);
  }
}

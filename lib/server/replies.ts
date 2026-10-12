import "server-only";
import { db } from "@/lib/db";
import { ApiError, notFound } from "./http";

/** A pending reply draft (comment or DM) of the caller's business, or 404 / 409. */
export async function findPendingReply(businessId: string, id: string) {
  const reply = await db.replyDraft.findFirst({
    where: { id, businessId },
    select: { id: true, status: true, channel: true, commentId: true, draftReply: true, recipientId: true, lastMessageAt: true },
  });
  if (!reply) throw notFound("Reply draft");
  if (reply.status === "EXPIRED") throw new ApiError(409, "dm_window_closed", "Instagram only allows replies within 24 hours of the customer's last message.");
  if (reply.status !== "PENDING") throw new ApiError(409, "conflict", "This reply has already been handled.");
  return reply;
}

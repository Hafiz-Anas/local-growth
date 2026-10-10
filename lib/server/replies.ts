import "server-only";
import { db } from "@/lib/db";
import { ApiError, notFound } from "./http";

/** A pending reply draft of the caller's business, or 404 / 409. */
export async function findPendingReply(businessId: string, id: string) {
  const reply = await db.replyDraft.findFirst({ where: { id, businessId }, select: { id: true, status: true, commentId: true, draftReply: true } });
  if (!reply) throw notFound("Reply draft");
  if (reply.status !== "PENDING") throw new ApiError(409, "conflict", "This reply has already been handled.");
  return reply;
}

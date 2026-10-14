import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@/lib/generated/prisma/client";
import { EmailSendError } from "@/lib/services/mail/types";

/**
 * Consistent JSON envelope for every API route:
 *   success → { ok: true, data }
 *   failure → { ok: false, error: { code, message, details? } }
 */
export type ApiErrorCode =
  | "validation_error"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "invalid_token"
  | "invalid_password"
  | "payload_too_large"
  | "unsupported_media_type"
  | "instagram_not_connected"
  | "instagram_permission"
  | "instagram_unavailable"
  | "instagram_error"
  | "ai_error"
  | "image_unavailable"
  | "email_unavailable"
  /** details: [{ path: "reason", message: PublishReason }] (lib/server/publishing.ts) */
  | "publish_failed"
  /** A DM reply after Instagram's 24-hour window (lib/server/instagram-dm.ts). */
  | "dm_window_closed"
  /** details: [{ path: "reason", message: "recipient_unavailable" | "message_rejected" | "too_long" }] */
  | "dm_failed"
  /** The AI assistant couldn't answer; details: [{ path: "reason", message: TextFailureReason }] (lib/server/assistant.ts). */
  | "assistant_unavailable"
  /** The business asked the assistant its daily number of questions. */
  | "assistant_limit"
  /** Recommendations couldn't be generated; details: [{ path: "reason", message: TextFailureReason }] (lib/server/recommendations.ts). */
  | "recommendations_unavailable"
  /** The business refreshed its recommendations the allowed number of times today. */
  | "recommendations_limit"
  | "internal_error";

/** Throw from route code (or guards); `handler()` turns it into the JSON error response. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what = "Resource") => new ApiError(404, "not_found", `${what} not found.`);

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ ok: true as const, data }, init);
}

export function fail(status: number, code: ApiErrorCode, message: string, details?: unknown) {
  return NextResponse.json({ ok: false as const, error: { code, message, ...(details !== undefined && { details }) } }, { status });
}

function zodDetails(error: z.ZodError) {
  return error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
}

/**
 * Wraps a route handler: maps ApiError, Zod errors and common Prisma errors to
 * the JSON envelope, and hides anything unexpected behind a generic 500.
 */
export function handler<C>(fn: (request: Request, context: C) => Promise<Response>) {
  return async (request: Request, context: C): Promise<Response> => {
    try {
      return await fn(request, context);
    } catch (error) {
      if (error instanceof ApiError) return fail(error.status, error.code, error.message, error.details);
      // Already logged (without secrets) by the email service.
      if (error instanceof EmailSendError) return fail(503, "email_unavailable", "We couldn't send the email right now.", { reason: error.reason });
      if (error instanceof z.ZodError) return fail(400, "validation_error", "Invalid input.", zodDetails(error));
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === "P2002") return fail(409, "conflict", "A record with these values already exists.");
        if (error.code === "P2025") return fail(404, "not_found", "Resource not found.");
      }
      console.error(`[api] ${request.method} ${new URL(request.url).pathname}`, error);
      return fail(500, "internal_error", "Something went wrong.");
    }
  };
}

/** Parses a JSON body with a Zod schema; throws a 400 ApiError on bad input. */
export async function readJson<S extends z.ZodType>(request: Request, schema: S): Promise<z.infer<S>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new ApiError(400, "validation_error", "Request body must be JSON.");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", "Invalid input.", zodDetails(parsed.error));
  return parsed.data;
}

/** Parses URL search params with a Zod schema; throws a 400 ApiError on bad input. */
export function readQuery<S extends z.ZodType>(request: Request, schema: S): z.infer<S> {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = schema.safeParse(params);
  if (!parsed.success) throw new ApiError(400, "validation_error", "Invalid query.", zodDetails(parsed.error));
  return parsed.data;
}

/** Route ids are cuid() or the seed's readable ids (e.g. "cl_mathanet"). */
export const idSchema = z.string().min(1).max(64).regex(/^[\w-]+$/);

/** Reads and validates the `[id]`-style params of a dynamic route. */
export async function readParams<K extends string>(context: { params: Promise<Record<K, string | string[]>> }, ...keys: K[]) {
  const params = await context.params;
  const out = {} as Record<K, string>;
  for (const key of keys) {
    const parsed = idSchema.safeParse(params[key]);
    if (!parsed.success) throw notFound();
    out[key] = parsed.data;
  }
  return out;
}

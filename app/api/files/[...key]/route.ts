import { requireAuth } from "@/lib/server/guards";
import { fail, handler } from "@/lib/server/http";
import { getStorageService, signedUrlTtl } from "@/lib/services/storage";
import { SPACES_KEY_PATTERN, businessOfKey } from "@/lib/services/spaces-storage";

export const dynamic = "force-dynamic";

/**
 * GET /api/files/<key> — a file in private Spaces storage (STORAGE_PROVIDER="spaces"): checks who's asking,
 * then redirects to a short-lived signed link. A business's files ("b/<businessId>/…") open only for that
 * business and for admins (preview); other files (avatars) for anyone signed in. Other businesses' files and
 * unknown keys are 404, like every other cross-business lookup. With another STORAGE_PROVIDER this route 404s.
 */
export const GET = handler(async (_request: Request, context: RouteContext<"/api/files/[...key]">) => {
  if (process.env.STORAGE_PROVIDER !== "spaces") return fail(404, "not_found", "Not found.");
  const session = await requireAuth();
  const key = (await context.params).key.join("/");
  if (!SPACES_KEY_PATTERN.test(key)) return fail(404, "not_found", "Not found.");
  const owner = businessOfKey(key);
  if (owner && session.role !== "admin" && owner !== session.businessId) return fail(404, "not_found", "Not found.");

  const storage = getStorageService();
  const ttl = signedUrlTtl();
  const url = await storage.signedUrl!(key, ttl);
  return new Response(null, {
    status: 302,
    headers: {
      Location: url,
      // The browser may reuse the redirect while the signed link is still valid; never shared caches.
      "Cache-Control": `private, max-age=${Math.max(0, Math.min(300, ttl - 60))}`,
      "Referrer-Policy": "no-referrer",
    },
  });
});

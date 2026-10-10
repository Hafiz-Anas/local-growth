import { fail } from "@/lib/server/http";
import { readLocalFile } from "@/lib/services/storage";

/**
 * GET /api/uploads/<key> — serves files saved by the local StorageService.
 * Uploaded files are profile photos, logos and brand posts, which are public
 * like seeded avatars (keys are random UUIDs). Supports single byte ranges so
 * uploaded videos can seek and play in Safari.
 * With another STORAGE_PROVIDER the URLs point elsewhere and this route 404s.
 */
export async function GET(request: Request, context: RouteContext<"/api/uploads/[...key]">) {
  if ((process.env.STORAGE_PROVIDER ?? "local") !== "local") return fail(404, "not_found", "Not found.");
  const { key } = await context.params;
  const file = await readLocalFile(key.join("/"));
  if (!file) return fail(404, "not_found", "Not found.");

  const headers: Record<string, string> = {
    "Content-Type": file.contentType,
    // Keys are random and never reused, so the file at a URL never changes.
    "Cache-Control": "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
    "Accept-Ranges": "bytes",
  };
  const size = file.data.length;
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("range") ?? "");
  if (range && (range[1] || range[2])) {
    // "bytes=a-b", "bytes=a-" or the suffix form "bytes=-n".
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) {
      return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } });
    }
    return new Response(new Uint8Array(file.data.subarray(start, end + 1)), {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
    });
  }
  return new Response(new Uint8Array(file.data), { headers: { ...headers, "Content-Length": String(size) } });
}

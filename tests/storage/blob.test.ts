import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { VercelBlobStorageService, type BlobClient } from "../../lib/services/blob-storage";

const STORE = "https://abc123xyz.public.blob.vercel-storage.com";

/** In-memory stand-in for the Blob SDK that records every call (never calls Vercel). */
function stubClient() {
  const blobs = new Map<string, { data: Buffer; contentType: string }>();
  const calls: Array<{ fn: string; args: unknown[] }> = [];
  const client: BlobClient = {
    async put(pathname, body, options) {
      calls.push({ fn: "put", args: [pathname, options] });
      blobs.set(pathname, { data: body, contentType: options.contentType });
      return { url: `${STORE}/${pathname}`, pathname };
    },
    async del(pathname, options) {
      calls.push({ fn: "del", args: [pathname, options] });
      blobs.delete(pathname);
    },
    async head(pathname, options) {
      calls.push({ fn: "head", args: [pathname, options] });
      if (!blobs.has(pathname)) throw new Error("BlobNotFoundError");
      return { url: `${STORE}/${pathname}` };
    },
  };
  const fetchStub = (async (input: string | URL | Request) => {
    const pathname = new URL(String(input)).pathname.slice(1);
    const blob = blobs.get(pathname);
    return blob ? new Response(new Uint8Array(blob.data)) : new Response("not found", { status: 404 });
  }) as typeof fetch;
  return { client, calls, blobs, fetch: fetchStub };
}

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

describe("VercelBlobStorageService", () => {
  it("stores post images publicly under a random key and returns the HTTPS Blob URL", async () => {
    const stub = stubClient();
    const storage = new VercelBlobStorageService({ client: stub.client, token: "vercel_blob_rw_test", fetch: stub.fetch });
    const stored = await storage.save({ data: png, contentType: "image/png", prefix: "post-images", extension: "png" });

    assert.match(stored.key, /^post-images\/[a-f0-9-]{36}\.png$/);
    assert.equal(stored.url, `${STORE}/${stored.key}`);
    assert.ok(stored.url.startsWith("https://"));
    const [pathname, options] = stub.calls[0].args as [string, Record<string, unknown>];
    assert.equal(pathname, stored.key);
    assert.deepEqual(options, { access: "public", contentType: "image/png", addRandomSuffix: false, cacheControlMaxAge: 31_536_000, token: "vercel_blob_rw_test" });
    assert.deepEqual(stub.blobs.get(stored.key)?.data, png);
  });

  it("gives every save a new key", async () => {
    const stub = stubClient();
    const storage = new VercelBlobStorageService({ client: stub.client, fetch: stub.fetch });
    const a = await storage.save({ data: png, contentType: "image/png", prefix: "post-images", extension: "png" });
    const b = await storage.save({ data: png, contentType: "image/png", prefix: "post-images", extension: "png" });
    assert.notEqual(a.key, b.key);
  });

  it("leaves the token to the SDK when none is configured", async () => {
    const stub = stubClient();
    const storage = new VercelBlobStorageService({ client: stub.client, fetch: stub.fetch });
    await storage.save({ data: png, contentType: "image/png", prefix: "avatars", extension: "png" });
    assert.equal("token" in (stub.calls[0].args[1] as object), false);
  });

  it("maps its own URLs back to keys and ignores every other URL", async () => {
    const stub = stubClient();
    const storage = new VercelBlobStorageService({ client: stub.client, fetch: stub.fetch });
    const { key, url } = await storage.save({ data: png, contentType: "image/png", prefix: "brand-logos", extension: "png" });

    assert.equal(storage.keyFromUrl(url), key);
    assert.equal(storage.keyFromUrl(`/api/uploads/${key}`), null); // local provider URL
    assert.equal(storage.keyFromUrl("/avatars/people/dana-kw.svg"), null); // seeded asset
    assert.equal(storage.keyFromUrl(`http://abc123xyz.public.blob.vercel-storage.com/${key}`), null);
    assert.equal(storage.keyFromUrl(`https://evil.example.com/${key}`), null);
    assert.equal(storage.keyFromUrl(`https://abc.public.blob.vercel-storage.com.evil.com/${key}`), null);
    assert.equal(storage.keyFromUrl(`${STORE}/${key}?download=1`), null);
    assert.equal(storage.keyFromUrl("https://scontent.cdninstagram.com/v/t51/123.jpg"), null);
    assert.equal(storage.keyFromUrl("not a url"), null);
  });

  it("reads stored bytes back through head + fetch, and null when missing", async () => {
    const stub = stubClient();
    const storage = new VercelBlobStorageService({ client: stub.client, fetch: stub.fetch });
    const { key } = await storage.save({ data: png, contentType: "image/png", prefix: "post-images", extension: "png" });

    assert.deepEqual(await storage.read(key), png);
    assert.equal(await storage.read("post-images/00000000-0000-0000-0000-000000000000.png"), null);
    assert.equal(await storage.read("../etc/passwd"), null);
  });

  it("deletes by key and rejects invalid keys", async () => {
    const stub = stubClient();
    const storage = new VercelBlobStorageService({ client: stub.client, token: "t", fetch: stub.fetch });
    const { key } = await storage.save({ data: png, contentType: "image/png", prefix: "avatars", extension: "png" });

    await storage.delete(key);
    assert.equal(stub.blobs.has(key), false);
    assert.deepEqual(stub.calls.at(-1), { fn: "del", args: [key, { token: "t" }] });
    await assert.rejects(storage.delete("../../secret.png"), /Invalid storage key/);
  });

  it("refuses a URL that isn't from a public Blob store (e.g. a private store)", async () => {
    const stub = stubClient();
    stub.client.put = async (pathname) => ({ url: `https://abc123xyz.private.blob.vercel-storage.com/${pathname}`, pathname });
    const storage = new VercelBlobStorageService({ client: stub.client, fetch: stub.fetch });
    await assert.rejects(storage.save({ data: png, contentType: "image/png", prefix: "post-images", extension: "png" }), /public/);
  });
});

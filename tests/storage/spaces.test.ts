import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { FILE_ROUTE, SPACES_KEY_PATTERN, SpacesStorageService, businessOfKey, newSpacesKey, type S3Like, type SpacesOptions } from "../../lib/services/spaces-storage";

const BUSINESS = "cmbiz0000000000000000001";

function fake(objects = new Map<string, Buffer>()) {
  const sent: unknown[] = [];
  const presigned: Array<{ key: string; expiresIn: number }> = [];
  const posts: Array<Parameters<SpacesOptions["presignPost"]>[0]> = [];
  const client: S3Like = {
    async send(command) {
      sent.push(command);
      const input = command.input as { Key: string; Body?: Buffer };
      if (command instanceof PutObjectCommand) {
        objects.set(input.Key, input.Body as Buffer);
        return {};
      }
      if (command instanceof GetObjectCommand) {
        const data = objects.get(input.Key);
        if (!data) throw Object.assign(new Error("The specified key does not exist."), { name: "NoSuchKey" });
        return { Body: { transformToByteArray: async () => new Uint8Array(data) } };
      }
      objects.delete(input.Key);
      return {};
    },
  };
  const storage = new SpacesStorageService({
    client,
    bucket: "lge-test",
    presignGet: async (command, expiresIn) => {
      presigned.push({ key: command.input.Key!, expiresIn });
      return `https://lge-test.fra1.digitaloceanspaces.com/${command.input.Key}?X-Amz-Signature=abc&X-Amz-Expires=${expiresIn}`;
    },
    presignPost: async (input) => {
      posts.push(input);
      return { url: "https://lge-test.fra1.digitaloceanspaces.com/", fields: { key: input.Key, Policy: "p", "X-Amz-Signature": "s", ...input.Fields } };
    },
  });
  return { storage, sent, presigned, posts, objects };
}

describe("Spaces keys", () => {
  it("a business's files carry its id; other files don't", () => {
    const key = newSpacesKey("gallery", "jpg", BUSINESS);
    assert.match(key, new RegExp(`^b/${BUSINESS}/gallery/[a-f0-9-]{36}\\.jpg$`));
    assert.equal(businessOfKey(key), BUSINESS);
    const avatar = newSpacesKey("avatars", "webp");
    assert.match(avatar, /^avatars\/[a-f0-9-]{36}\.webp$/);
    assert.equal(businessOfKey(avatar), null);
  });

  it("refuses anything that isn't one of our keys", () => {
    for (const bad of ["../etc/passwd", "b/x/gallery/a.jpg", "gallery/not-a-uuid.jpg", `b/${BUSINESS}/../gallery/x.jpg`]) assert.equal(SPACES_KEY_PATTERN.test(bad), false, bad);
    // An unusable business id is left out of the key rather than breaking it.
    assert.equal(businessOfKey(newSpacesKey("gallery", "jpg", "Not An Id!")), null);
  });
});

describe("SpacesStorageService", () => {
  it("saves privately under the business's key and answers the app's own file link", async () => {
    const { storage, sent } = fake();
    const file = await storage.save({ data: Buffer.from("img"), contentType: "image/jpeg", prefix: "gallery", extension: "jpg", businessId: BUSINESS });
    assert.equal(file.url, `${FILE_ROUTE}${file.key}`);
    assert.equal(businessOfKey(file.key), BUSINESS);
    const put = sent[0] as PutObjectCommand;
    assert.ok(put instanceof PutObjectCommand);
    assert.equal(put.input.Bucket, "lge-test");
    assert.equal(put.input.ContentType, "image/jpeg");
    // Private: no ACL is ever set (the bucket is private).
    assert.equal(put.input.ACL, undefined);
  });

  it("reads a stored file, and null when it's missing", async () => {
    const { storage } = fake();
    const file = await storage.save({ data: Buffer.from("hello"), contentType: "image/png", prefix: "avatars", extension: "png" });
    assert.equal((await storage.read(file.key))?.toString(), "hello");
    assert.equal(await storage.read("avatars/00000000-0000-0000-0000-000000000000.png"), null);
    assert.equal(await storage.read("../secret"), null);
  });

  it("deletes our keys only", async () => {
    const { storage, sent, objects } = fake();
    const file = await storage.save({ data: Buffer.from("x"), contentType: "image/png", prefix: "avatars", extension: "png" });
    await storage.delete(file.key);
    assert.ok(sent.at(-1) instanceof DeleteObjectCommand);
    assert.equal(objects.size, 0);
    await assert.rejects(storage.delete("../x"));
  });

  it("finds the key in its own links (relative or absolute) and nowhere else", () => {
    const { storage } = fake();
    const key = `b/${BUSINESS}/gallery/3f2c1a2b-1111-4222-8333-944455556666.jpg`;
    assert.equal(storage.keyFromUrl(`/api/files/${key}`), key);
    assert.equal(storage.keyFromUrl(`https://app.example.com/api/files/${key}`), key);
    assert.equal(storage.keyFromUrl("/api/uploads/gallery/3f2c1a2b-1111-4222-8333-944455556666.jpg"), null);
    assert.equal(storage.keyFromUrl("https://x.public.blob.vercel-storage.com/gallery/3f2c1a2b-1111-4222-8333-944455556666.jpg"), null);
    assert.equal(storage.keyFromUrl("/api/files/../../etc/passwd"), null);
  });

  it("signs short-lived download links for the file route and Instagram", async () => {
    const { storage, presigned } = fake();
    const url = await storage.signedUrl!(`b/${BUSINESS}/ig-publish/3f2c1a2b-1111-4222-8333-944455556666.jpg`, 3600);
    assert.match(url, /^https:\/\/.+X-Amz-Signature=/);
    assert.deepEqual(presigned, [{ key: `b/${BUSINESS}/ig-publish/3f2c1a2b-1111-4222-8333-944455556666.jpg`, expiresIn: 3600 }]);
    await assert.rejects(storage.signedUrl!("not/a-key", 60));
  });

  it("presigned browser uploads accept one content type up to a size, under the business's key", async () => {
    const { storage, posts } = fake();
    const upload = await storage.presignUpload!({ prefix: "gallery", extension: "jpg", contentType: "image/jpeg", maxBytes: 10 * 1024 * 1024, businessId: BUSINESS, ttlSeconds: 900 });
    assert.equal(businessOfKey(upload.key), BUSINESS);
    assert.equal(upload.url, `${FILE_ROUTE}${upload.key}`);
    assert.equal(upload.upload.fields.key, upload.key);
    const post = posts[0];
    assert.equal(post.Expires, 900);
    assert.deepEqual(post.Conditions[0], ["content-length-range", 1, 10 * 1024 * 1024]);
    assert.deepEqual(post.Conditions[1], ["eq", "$Content-Type", "image/jpeg"]);
    assert.equal(post.Fields["Content-Type"], "image/jpeg");
  });
});

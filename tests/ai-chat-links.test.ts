import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isAllowedImageUrl, isAllowedLink, sanitizeChatPayload } from "../lib/ai-chat-links";

describe("AI chat: links in saved messages", () => {
  it("keeps images from our own storage and Instagram's CDN only", () => {
    for (const ok of [
      "/api/uploads/gallery/biz_1/photo.jpg",
      "/photos/mathanet/04-t.jpg",
      "/avatars/noor.svg",
      "/mock-media/reel-1.svg",
      "https://abc123.public.blob.vercel-storage.com/gallery/biz_1/photo.webp",
      "https://scontent-fra5-1.cdninstagram.com/v/t51.2885-15/123_n.jpg?stp=dst-jpg",
      "https://scontent.xx.fbcdn.net/v/t51/abc.jpg",
    ])
      assert.ok(isAllowedImageUrl(ok), ok);
    for (const bad of [
      "https://evil.example/pixel.gif",
      "http://abc.public.blob.vercel-storage.com/x.jpg",
      "https://cdninstagram.com.evil.example/x.jpg",
      "https://user:pass@scontent.cdninstagram.com/x.jpg",
      "//evil.example/x.jpg",
      "/api/ai-chats/x",
      "/photos/../api/logout",
      "data:image/svg+xml;base64,PHN2Zz4=",
      "javascript:alert(1)",
      "blob:https://localhost/1",
    ])
      assert.equal(isAllowedImageUrl(bad), false, bad);
  });

  it("keeps https links and paths on this site; drops other schemes", () => {
    assert.ok(isAllowedLink("https://www.instagram.com/p/abc/"));
    assert.ok(isAllowedLink("/gallery"));
    for (const bad of ["javascript:alert(1)", "http://example.com", "//evil.example", "data:text/html,hi"]) assert.equal(isAllowedLink(bad), false, bad);
  });

  it("removes disallowed image and link fields anywhere in a message, leaving the rest", () => {
    const message = {
      id: "a1",
      role: "ai",
      kind: "post",
      text: { en: "Here's a post", ar: "إليكم منشور" },
      post: {
        photoIds: ["p1"],
        caption: { en: "New abayas", ar: "عبايات جديدة" },
        aiImage: { src: "https://evil.example/a.jpg", thumb: "/photos/tannour/02-t.jpg", credit: { author: "A", link: "javascript:alert(1)" } },
        variants: [{ src: "/photos/tannour/03.jpg", thumb: "https://tracker.example/t.gif" }],
      },
      reference: { avatarUrl: null, post: { mediaUrl: "https://scontent.cdninstagram.com/x.jpg", permalink: "https://www.instagram.com/p/x/" } },
      thumbs: ["/photos/qahwa/07-t.jpg", "https://evil.example/x.png"],
    };
    assert.deepEqual(sanitizeChatPayload(message), {
      id: "a1",
      role: "ai",
      kind: "post",
      text: { en: "Here's a post", ar: "إليكم منشور" },
      post: {
        photoIds: ["p1"],
        caption: { en: "New abayas", ar: "عبايات جديدة" },
        aiImage: { thumb: "/photos/tannour/02-t.jpg", credit: { author: "A" } },
        variants: [{ src: "/photos/tannour/03.jpg" }],
      },
      reference: { avatarUrl: null, post: { mediaUrl: "https://scontent.cdninstagram.com/x.jpg", permalink: "https://www.instagram.com/p/x/" } },
      thumbs: ["/photos/qahwa/07-t.jpg"],
    });
  });
});

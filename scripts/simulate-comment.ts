/**
 * Simulates a new Instagram comment without Meta:
 *   npm run simulate-comment -- --handle <instagram handle> --text "MENU"
 *
 * Builds the "comments" webhook body Meta sends, signs it with META_APP_SECRET
 * (X-Hub-Signature-256) and POSTs it to /api/webhooks/instagram on the running app,
 * so the real path runs: signature check → business lookup → feature check →
 * keyword rules (match, dedupe, cooldown) → public reply + private DM, or a draft in
 * the Engagement approval queue when the rule needs approval. Results show on the
 * rule (times triggered) and in the admin integration log.
 *
 * Options:
 *   --handle      the business's connected Instagram username (required)
 *   --text        the comment (default "MENU")
 *   --from        the commenter's username (default "sim_customer"); reuse it to test the 24-hour cooldown
 *   --from-id     the commenter's Instagram-scoped id (default derived from --from)
 *   --media       the post's Instagram media id (default: the newest synced post, else "sim_media_1")
 *   --comment-id  reuse an id to test that a comment is never answered twice (default: a new id)
 *   --url         the app (default AUTH_URL, else http://localhost:3000)
 *
 * Mock connections "send" through the mock service. On a Meta connection the app calls the
 * real Graph API, which rejects a simulated comment id (logged as a failure) — use a real
 * comment for that. Refuses to run against anything but a local app and database.
 */
import { randomUUID } from "node:crypto";
import { arg, deliver, fail, openTarget } from "./webhook-sim";

async function main() {
  const handle = arg("handle")?.replace(/^@/, "");
  if (!handle) fail('Missing --handle. Example: npm run simulate-comment -- --handle mybusiness --text "MENU"');
  const text = arg("text") ?? "MENU";
  const from = (arg("from") ?? "sim_customer").replace(/^@/, "");
  const fromId = arg("from-id") ?? `sim_${from}`;
  const commentId = arg("comment-id") ?? `sim_c_${randomUUID()}`;

  const target = await openTarget("simulate-comment", handle);
  try {
    const newest = await target.db.instagramMedia.findFirst({ where: { businessId: target.businessId }, orderBy: { postedAt: "desc" }, select: { igMediaId: true } });
    const mediaId = arg("media") ?? newest?.igMediaId ?? "sim_media_1";
    if (target.provider === "META") console.warn("⚠ This is a Meta connection: the app will call the real Graph API, which rejects a simulated comment (you'll see the failure in the integration log).");

    await deliver(target, {
      object: "instagram",
      entry: [
        {
          id: target.accountId,
          time: Math.floor(Date.now() / 1000),
          changes: [{ field: "comments", value: { id: commentId, text, from: { id: fromId, username: from }, media: { id: mediaId, media_product_type: "FEED" } } }],
        },
      ],
    });
    console.log(`✔ Sent a simulated comment "${text}" from @${from} on post ${mediaId} to @${handle} (${target.businessName}). Comment id: ${commentId}`);
    console.log("  Matching keyword rules reply in a moment (Engagement → Keyword replies shows the count; Admin → client → Integration log shows each send).");
  } finally {
    await target.db.$disconnect();
  }
}

main().catch((error) => fail((error as Error).message));

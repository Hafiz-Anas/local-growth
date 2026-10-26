/**
 * Engagement → Reply settings' "Auto-reply" switch is hidden: nothing sends AI replies on its own yet,
 * so every reply waits for approval. The switch, its route (PATCH /api/engagement/settings) and the
 * saved BrandVoice.autoReply value stay; set this to true once auto-sending works.
 */
export const SHOW_AUTO_REPLY = false;

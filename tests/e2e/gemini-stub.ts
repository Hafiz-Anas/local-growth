import { createServer } from "node:http";

/**
 * A local stand-in for Gemini's generateContent, for the e2e app started with
 * GEMINI_API_BASE=http://127.0.0.1:<port>/v1beta (see playwright.config.ts). Google is never called.
 * - recommendations requests (responseSchema with "recommendations") get 3 numbered recommendations;
 * - weekly report summaries (responseSchema with "summary_en") get a summary without numbers, or —
 *   for the business named in `state.inventNumbersFor` — one with an invented number (must be rejected);
 * - onboarding pre-fill (responseSchema with "business_type") gets a bakery niche, tone 70 and the first
 *   two hashtag candidates;
 * - reply drafts (system prompt "You reply on behalf of") get a short reply; "Regenerate" requests (with a
 *   <previous_draft>) get "New draft (<tone>) v<n>", where tone is shorter / formal / friendly / new;
 * - competitor comparisons (schema with "tactics_en") get a comparison quoting only numbers from the data
 *   (or, for the handle in `state.inventFor`, one with an invented number that must be rejected);
 * - post classifications (schema with "posts") mark every post as "giveaway";
 * - post explanations (schema with "learn_en") get a summary without numbers;
 * - chat requests get an answer echoing the question (Arabic for an Arabic question);
 * - a question containing "[down]", or `state.fail`, gets a 503.
 */

export interface StubCall {
  system: string;
  turns: Array<{ role: string; text: string }>;
  kind: "strategy" | "report" | "prefill" | "reply" | "competitor" | "classify" | "postInsight" | "chat";
}

export const STUB_PORT = Number(process.env.E2E_GEMINI_STUB_PORT ?? 4010);

interface RequestBody {
  systemInstruction?: { parts: Array<{ text: string }> };
  contents?: Array<{ role: string; parts: Array<{ text: string }> }>;
  generationConfig?: { responseSchema?: { properties?: Record<string, unknown> } };
}

/** The n-th analysis: three recommendations whose confidence the app must cap by the post counts. */
export function stubRecommendations(n: number) {
  const rec = (action: string, actionAr: string, posts: number, category: string, metric: string) => ({
    action_en: `${action} (#${n})`,
    action_ar: `${actionAr} (#${n})`,
    rationale_en: `Your Thursday evening Reels averaged 120 likes and comments, based on ${posts} posts. This is a pattern, not proof.`,
    rationale_ar: `حققت الريلز مساء الخميس متوسط ١٢٠ إعجاباً وتعليقاً، بناءً على ${posts} منشورات. هذا نمط وليس دليلاً.`,
    category,
    metric,
    confidence: "strong",
    based_on_posts: posts,
  });
  return {
    recommendations: [
      rec("Post a Reel on Thursday evening", "انشروا ريل مساء الخميس", 12, "timing", "interactions"),
      rec("Reply to every comment within an hour", "ردّوا على كل تعليق خلال ساعة", 3, "engagement", "reach"),
      rec("Show the roasting process in a carousel", "اعرضوا مراحل التحميص في منشور متعدد الصور", 7, "format", "interactions"),
    ],
  };
}

export async function startGeminiStub(port = STUB_PORT) {
  const calls: StubCall[] = [];
  const state = { fail: false, analyses: 0, inventNumbersFor: "", rewrites: 0, inventFor: "" };
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const body = JSON.parse(raw || "{}") as RequestBody;
      const turns = (body.contents ?? []).map((c) => ({ role: c.role, text: c.parts.map((p) => p.text).join("") }));
      const props = body.generationConfig?.responseSchema?.properties ?? {};
      const system = body.systemInstruction?.parts[0]?.text ?? "";
      const kind = props.recommendations
        ? "strategy"
        : props.summary_en && props.learn_en
          ? "postInsight"
          : props.summary_en
            ? "report"
            : props.business_type
              ? "prefill"
              : props.tactics_en
                ? "competitor"
                : props.posts
                  ? "classify"
                  : system.includes("You reply on behalf of")
                    ? "reply"
                    : "chat";
      calls.push({ system, turns, kind });
      const question = turns.at(-1)?.text ?? "";
      res.setHeader("content-type", "application/json");
      if (state.fail || question.includes("[down]")) {
        res.statusCode = 503;
        res.end(JSON.stringify({ error: { code: 503, status: "UNAVAILABLE", message: "The model is overloaded." } }));
        return;
      }
      let text: string;
      if (kind === "strategy") {
        state.analyses += 1;
        text = JSON.stringify(stubRecommendations(state.analyses));
      } else if (kind === "prefill") {
        const system = body.systemInstruction?.parts[0]?.text ?? "";
        const candidates = (system.match(/<hashtag_candidates>\n([^<]*)\n<\/hashtag_candidates>/)?.[1] ?? "").split(/\s+/).filter((t) => t.startsWith("#"));
        text = JSON.stringify({ business_type: "bakery", niche: "Home bakery for celebration cakes", tone_level: 70, hashtags: candidates.slice(0, 2), products: [] });
      } else if (kind === "report") {
        const system = body.systemInstruction?.parts[0]?.text ?? "";
        const invent = Boolean(state.inventNumbersFor) && system.includes(state.inventNumbersFor);
        text = JSON.stringify(
          invent
            ? { summary_en: "Reach jumped 987654% this week.", summary_ar: "قفز الوصول ٩٨٧٦٥٤٪ هذا الأسبوع." }
            : { summary_en: "A steady week compared with the one before. Your top post led the way; keep posting at your strongest times.", summary_ar: "أسبوع مستقر مقارنة بالأسبوع السابق. تصدّر أفضل منشور لديكم؛ استمروا في النشر في أفضل أوقاتكم." },
        );
      } else if (kind === "competitor") {
        const handle = system.match(/competitors \(@([^)]+)\)/)?.[1] ?? "";
        const invent = Boolean(state.inventFor) && handle === state.inventFor;
        text = JSON.stringify({
          tactics_en: invent ? "They gained 987654 followers with Reels." : `@${handle} seems to post mostly Reels in the evening and leans on offers.`,
          tactics_ar: "يبدو أنهم ينشرون غالباً ريلز في المساء ويعتمدون على العروض.",
          they_better_en: ["They post more often."],
          they_better_ar: ["ينشرون بشكل أكثر تكراراً."],
          you_better_en: ["Your engagement per follower is higher."],
          you_better_ar: ["تفاعلكم لكل متابع أعلى."],
          ideas_en: ["Try one offer as a Reel this week.", "Post in the evening twice."],
          ideas_ar: ["جربوا عرضاً واحداً كريل هذا الأسبوع.", "انشروا مساءً مرتين."],
        });
      } else if (kind === "classify") {
        const ids = [...system.matchAll(/- id (\S+) \|/g)].map((m) => m[1]);
        text = JSON.stringify({ posts: ids.map((id) => ({ id, method: "giveaway" })) });
      } else if (kind === "postInsight") {
        text = JSON.stringify({
          summary_en: "This post did better than your usual posts.",
          summary_ar: "أداء هذا المنشور أفضل من منشوراتكم المعتادة.",
          learn_en: "Posts like this seem to work for you.",
          learn_ar: "يبدو أن منشورات كهذه تناسبكم.",
        });
      } else if (kind === "reply") {
        if (question.includes("<previous_draft>")) {
          state.rewrites += 1;
          const tone = /noticeably shorter/.test(question) ? "shorter" : /more formal/.test(question) ? "formal" : /warmer and friendlier/.test(question) ? "friendly" : "new";
          text = `New draft (${tone}) v${state.rewrites}`;
        } else text = "Thanks for your message! 🤍 We'll get back to you shortly.";
      } else {
        const arabic = /[؀-ۿ]/.test(question);
        text = arabic ? `إجابة تجريبية (${turns.length}): ${question}` : `**Stub answer** (${turns.length} turns) to: ${question}`;
      }
      res.end(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { role: "model", parts: [{ text }] } }] }));
    });
  });
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  return { calls, state, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

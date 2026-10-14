import { createServer } from "node:http";

/**
 * A local stand-in for Gemini's generateContent, for the e2e app started with
 * GEMINI_API_BASE=http://127.0.0.1:<port>/v1beta (see playwright.config.ts). Google is never called.
 * - recommendations requests (responseSchema with "recommendations") get 3 numbered recommendations;
 * - chat requests get an answer echoing the question (Arabic for an Arabic question);
 * - a question containing "[down]", or `state.fail`, gets a 503.
 */

export interface StubCall {
  system: string;
  turns: Array<{ role: string; text: string }>;
  kind: "strategy" | "chat";
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
  const state = { fail: false, analyses: 0 };
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const body = JSON.parse(raw || "{}") as RequestBody;
      const turns = (body.contents ?? []).map((c) => ({ role: c.role, text: c.parts.map((p) => p.text).join("") }));
      const kind = body.generationConfig?.responseSchema?.properties?.recommendations ? "strategy" : "chat";
      calls.push({ system: body.systemInstruction?.parts[0]?.text ?? "", turns, kind });
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

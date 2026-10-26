import { createServer } from "node:http";

/**
 * A local stand-in for Gemini's generateContent, for the e2e app started with
 * GEMINI_API_BASE=http://127.0.0.1:<port>/v1beta (see playwright.config.ts). Google is never called.
 * - weekly tips (responseSchema with "recommendations") get one numbered tip per growth signal in the data, weakest first,
 *   quoting that signal's line (the app must rank them and keep 3), plus one with an invented number (must be dropped);
 * - weekly report summaries (responseSchema with "summary_en") get a summary without numbers, or —
 *   for the business named in `state.inventNumbersFor` — one with an invented number (must be rejected);
 * - onboarding pre-fill (responseSchema with "business_type") gets a bakery niche, tone 70, the first
 *   two hashtag candidates and two menu categories;
 * - photo style guides (schema with "palette", sent with images) get "Warm colors, close-up, top-down angle"
 *   and the number of images in `state.styleImages`;
 * - competitor suggestions (schema with "handles") get two local accounts and a private one (which the
 *   Instagram check must drop);
 * - reply drafts (system prompt "You reply on behalf of") get a short reply; "Regenerate" requests (with a
 *   <previous_draft>) get "New draft (<tone>) v<n>", where tone is shorter / formal / friendly / new;
 * - competitor comparisons (schema with "tactics_en") get a comparison quoting only numbers from the data
 *   (or, for the handle in `state.inventFor`, one with an invented number that must be rejected);
 * - post classifications (schema with "posts") mark every post as "giveaway";
 * - post explanations (schema with "learn_en") get a summary without numbers;
 * - monitoring summaries (system prompt "finished monitoring") get a summary quoting the readings count from the
 *   data (or an invented number while `state.inventMonitor` is set, which must be rejected);
 * - statistics summaries (system prompt "statistics period") get a summary without numbers (or an invented
 *   number while `state.inventStatistics` is set);
 * - shareability findings (schema with "findings") get one finding quoting the account's average share rate
 *   from the data (or an invented number while `state.inventShares` is set, which must be rejected);
 * - chat requests get an answer echoing the question (Arabic for an Arabic question);
 * - a question containing "[down]", or `state.fail`, gets a 503.
 */

export interface StubCall {
  system: string;
  turns: Array<{ role: string; text: string }>;
  kind: "strategy" | "report" | "monitor" | "statistics" | "shareability" | "prefill" | "style" | "suggest" | "reply" | "competitor" | "classify" | "postInsight" | "chat";
}

export const STUB_PORT = Number(process.env.E2E_GEMINI_STUB_PORT ?? 4010);

interface RequestBody {
  systemInstruction?: { parts: Array<{ text: string }> };
  contents?: Array<{ role: string; parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> }>;
  generationConfig?: { responseSchema?: { properties?: Record<string, unknown> } };
}

/** "[s1] SHARES — Reels: 5% of … (+52%), over 5 posts." lines of the data block → id, kind and the numbers part. */
export function stubSignals(system: string): Array<{ id: string; kind: string; numbers: string }> {
  return [...system.matchAll(/^\[(s\d+)\] ([A-Z ]+) — (.+?), over \d+ posts?\./gm)].map((m) => ({ id: m[1], kind: m[2], numbers: m[3] }));
}

export const stubRun = (n: number) => "ABCDEFGHIJKLMNOPQRSTUVWXYZ"[(n - 1) % 26];

/** The n-th analysis (#A, #B…): "Tip <kind> (#A)" per signal, weakest first, after one tip quoting an invented number. */
export function stubRecommendations(n: number, system: string) {
  const signals = stubSignals(system);
  // A letter, not a number: the app drops tips with numbers that aren't in the data.
  const run = stubRun(n);
  return {
    recommendations: [
      // First, on the strongest signal, so the number check (not the one-tip-per-signal rule) must drop it.
      ...(signals[0] ? [{ signal_id: signals[0].id, action_en: `Invented tip (#${run})`, action_ar: `نصيحة مختلقة (#${run})`, why_en: "Reach jumped 987654%.", why_ar: "قفز الوصول ٩٨٧٦٥٤٪." }] : []),
      ...[...signals].reverse().map((s) => ({
        signal_id: s.id,
        action_en: `Tip ${s.kind.toLowerCase()} (#${run})`,
        action_ar: `نصيحة ${s.kind.toLowerCase()} (#${run})`,
        why_en: `Your numbers: ${s.numbers}.`,
        why_ar: `أرقامكم: ${s.numbers}.`,
      })),
    ],
  };
}

export async function startGeminiStub(port = STUB_PORT) {
  const calls: StubCall[] = [];
  const state = { fail: false, styleImages: 0, analyses: 0, inventNumbersFor: "", rewrites: 0, inventFor: "", inventMonitor: false, inventStatistics: false, inventShares: false };
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const body = JSON.parse(raw || "{}") as RequestBody;
      const turns = (body.contents ?? []).map((c) => ({ role: c.role, text: c.parts.map((p) => p.text ?? "").join("") }));
      const props = body.generationConfig?.responseSchema?.properties ?? {};
      const system = body.systemInstruction?.parts[0]?.text ?? "";
      const kind = props.recommendations
        ? "strategy"
        : props.findings
          ? "shareability"
        : props.summary_en && system.includes("finished monitoring")
          ? "monitor"
          : props.summary_en && system.includes("statistics period")
          ? "statistics"
          : props.summary_en && props.learn_en
          ? "postInsight"
          : props.summary_en
            ? "report"
            : props.business_type
              ? "prefill"
              : props.palette
                ? "style"
                : props.handles
                  ? "suggest"
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
        text = JSON.stringify(stubRecommendations(state.analyses, system));
      } else if (kind === "prefill") {
        const system = body.systemInstruction?.parts[0]?.text ?? "";
        const candidates = (system.match(/<hashtag_candidates>\n([^<]*)\n<\/hashtag_candidates>/)?.[1] ?? "").split(/\s+/).filter((t) => t.startsWith("#"));
        text = JSON.stringify({ business_type: "bakery", niche: "Home bakery for celebration cakes", tone_level: 70, hashtags: candidates.slice(0, 2), products: [], categories: ["Cakes", "Sweets"] });
      } else if (kind === "style") {
        state.styleImages = (body.contents ?? []).flatMap((c) => c.parts).filter((p) => p.inlineData).length;
        text = JSON.stringify({
          summary: "Warm colors, close-up, top-down angle",
          palette: "warm golds and browns",
          angle: "top-down",
          lighting: "soft daylight",
          closeness: "close-up",
          background: "marble counter with a few props",
          mood: "homely",
        });
      } else if (kind === "suggest") {
        text = JSON.stringify({ handles: ["salmiya.sweets", "private_cakeclub", "@hawalli.bakery"] });
      } else if (kind === "report") {
        const system = body.systemInstruction?.parts[0]?.text ?? "";
        const invent = Boolean(state.inventNumbersFor) && system.includes(state.inventNumbersFor);
        text = JSON.stringify(
          invent
            ? { summary_en: "Reach jumped 987654% this week.", summary_ar: "قفز الوصول ٩٨٧٦٥٤٪ هذا الأسبوع." }
            : { summary_en: "A steady week compared with the one before. Your top post led the way; keep posting at your strongest times.", summary_ar: "أسبوع مستقر مقارنة بالأسبوع السابق. تصدّر أفضل منشور لديكم؛ استمروا في النشر في أفضل أوقاتكم." },
        );
      } else if (kind === "monitor") {
        const readings = system.match(/: (\d+) readings/)?.[1] ?? "";
        text = JSON.stringify(
          state.inventMonitor
            ? { summary_en: "It reached 987654 people.", summary_ar: "وصل إلى 987654 شخصاً." }
            : { summary_en: `Based on ${readings} readings, the post kept growing while it was monitored. Posts like this seem to work for you.`, summary_ar: `بناءً على ${readings} قراءات، استمر المنشور في النمو أثناء المراقبة. يبدو أن منشورات كهذه تناسبكم.` },
        );
      } else if (kind === "statistics") {
        text = JSON.stringify(
          state.inventStatistics
            ? { summary_en: "Reach grew 987654% this period.", summary_ar: "نما الوصول 987654% في هذه الفترة." }
            : { summary_en: "Posting more often went together with more likes and comments than the period before; Reels stood out. Try another Reel this week.", summary_ar: "ترافق النشر الأكثر مع إعجابات وتعليقات أكثر من الفترة السابقة، وبرزت الريلز. جربوا ريلاً آخر هذا الأسبوع." },
        );
      } else if (kind === "shareability") {
        const average = system.match(/Account average share rate: ([\d.]+)%/)?.[1] ?? "";
        text = JSON.stringify({
          findings: state.inventShares
            ? [{ finding_en: "Reels get 987654% more shares.", finding_ar: "الريلز تُشارَك 987654% أكثر." }]
            : [{ finding_en: `Giveaways and gift posts seem to get sent to friends most, above your average of ${average}%. Plan one this week.`, finding_ar: `يبدو أن السحوبات ومنشورات الهدايا تُرسَل للأصدقاء أكثر، فوق متوسطكم البالغ ${average}%. خطّطوا لواحد هذا الأسبوع.` }],
        });
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

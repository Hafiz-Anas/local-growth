"use client";

import { useMemo, useState } from "react";
import { num } from "@/lib/gallery/format";
import { translate, type MessageKey } from "@/lib/gallery/i18n";
import { useInsights } from "@/lib/gallery/hooks";
import { useAccount, useCompetitors, usePhotos, useStore } from "@/lib/gallery/store";
import { apiFetch } from "@/lib/api/client";
import type { CompetitorPostRef } from "@/lib/gallery/competitor-posts";
import { matchQuestion, matchRule, type ChatContext } from "@/mock-data/gallery/ai-chat";
import {
  DIRECTION_LABEL,
  PHOTO_STEPS,
  STYLE_LABEL,
  VARIANT_STEPS,
  combineCategory,
  combineDirections,
  combineFeatures,
  competitorStyle,
  directions,
  findSource,
  inspiredPost,
  matchCategory,
  photoPost,
  postWithVariants,
  productPhotos,
  productsFor,
  recognise,
  similarPhoto,
  similarPost,
  unposted,
  whyItWorks,
  type AiMsg,
  type Product,
} from "@/mock-data/gallery/ai-studio";
import { findCategory } from "@/mock-data/gallery/categories";
import { ownComparison } from "@/mock-data/gallery/competitors";
import type { AccountId, L, Lang } from "@/mock-data/gallery/types";
import type { SimilarPostDto } from "@/types";

let uid = 0;
const id = () => `ai-${Date.now().toString(36)}-${uid++}`;

/** The same message in both languages. */
const both = (key: MessageKey, vars?: (lang: Lang) => Record<string, string | number>): L => ({
  en: translate("en", key, vars?.("en")),
  ar: translate("ar", key, vars?.("ar")),
});
const same = (text: string): L => ({ en: text, ar: text });

/** Typing delay before the assistant starts answering. */
const DELAY = 550;

export function useChatContext(): ChatContext {
  const account = useAccount();
  const photos = usePhotos();
  const insights = useInsights();
  const competitors = useCompetitors();
  return useMemo(
    () => ({ account, photos, insights, competitors, own: ownComparison[account.id as AccountId] ?? ownComparison.mathanet }),
    [account, photos, insights, competitors],
  );
}

/** Turns prompts, attachments and picks into chat messages. All answers are mock data. */
export function useAiEngine(ctx: ChatContext) {
  const [typing, setTyping] = useState(false);
  const s = useStore.getState;

  /** Shows the user's message now and the assistant's reply after a short "typing" pause. */
  const exchange = (user: AiMsg | null, reply: () => AiMsg | null) => {
    const chatId = user ? s().pushAi([user], { title: user.role === "user" ? user.text : undefined }) : s().activeChatId;
    setTyping(true);
    window.setTimeout(() => {
      const msg = reply();
      if (msg) s().pushAi([msg], { chatId: chatId ?? undefined });
      setTyping(false);
    }, DELAY);
  };

  const userMsg = (text: L, extra?: { photoIds?: string[]; refThumb?: string; reference?: CompetitorPostRef }): AiMsg => ({ id: id(), role: "user", text, ...extra });

  /** "This looks like kunafa from your Sweets album." followed by the next line of the reply. */
  const seen = (photoIds: string[], next: MessageKey): L => {
    const recognised = recognise(ctx, photoIds.map((pid) => ctx.photos.find((p) => p.id === pid)).filter((p) => p !== undefined));
    return { en: `${recognised.en} ${translate("en", next)}`, ar: `${recognised.ar} ${translate("ar", next)}` };
  };

  const postFromPhotos = (photoIds: string[], text: L, wantsOptions = false) => {
    s().setChatMode("post");
    exchange(userMsg(text, { photoIds }), () => {
      if (wantsOptions)
        return { id: id(), role: "ai", kind: "directions", steps: [{ key: "look" }, { key: "directions" }], ready: false, text: seen(photoIds, "directionsIntro"), options: directions(ctx, photoIds) };
      const post = postWithVariants(ctx, photoPost(ctx, photoIds));
      return { id: id(), role: "ai", kind: "post", steps: post.variants ? VARIANT_STEPS : PHOTO_STEPS, ready: false, text: seen(photoIds, post.variants ? "postReadyVariants" : "postReady"), post };
    });
  };

  /** 2–4 photos: take one feature from each, then offer directions on a new AI image that mixes them. */
  const combine = (photoIds: string[], text: L, prompt: string) => {
    s().setChatMode("post");
    const ids = photoIds.slice(0, 4);
    const photos = ids.map((pid) => ctx.photos.find((p) => p.id === pid)).filter((p) => p !== undefined);
    const features = combineFeatures(ids, prompt);
    const category = findCategory(ctx.account.id, combineCategory(ctx, photos, prompt));
    exchange(userMsg(text, { photoIds: ids }), () => ({
      id: id(),
      role: "ai",
      kind: "directions",
      steps: [{ key: "look" }, { key: "combine" }, { key: "directions" }],
      ready: false,
      features,
      text: {
        en: `${translate("en", "combineIntro", { category: category?.name.en ?? "" })}${photoIds.length > 4 ? ` ${translate("en", "combineMax")}` : ""}`,
        ar: `${translate("ar", "combineIntro", { category: category?.name.ar ?? "" })}${photoIds.length > 4 ? ` ${translate("ar", "combineMax")}` : ""}`,
      },
      options: combineDirections(ctx, photos, category?.id),
    }));
  };

  const nextPostReply = (): AiMsg => {
    const photo = unposted(ctx.photos)[0];
    return {
      id: id(),
      role: "ai",
      kind: "post",
      steps: PHOTO_STEPS,
      ready: false,
      text: {
        en: `Your "${photo.dish.en}" photo hasn't been posted yet, and shots like it get more saves than average. Here's a post for tomorrow:`,
        ar: `صورة «${photo.dish.ar}» لم تُنشر بعد، وهذا النوع من الصور يحصل على حفظ أعلى من المتوسط. هذا منشور جاهز لغد:`,
      },
      post: photoPost(ctx, [photo.id]),
    };
  };
  const nextPost = (text: L) => exchange(userMsg(text), nextPostReply);

  const directionsForNext = (text: L) => {
    const ids = unposted(ctx.photos)
      .slice(0, 3)
      .map((p) => p.id);
    exchange(userMsg(text), () => ({
      id: id(),
      role: "ai",
      kind: "directions",
      steps: [{ key: "look" }, { key: "directions" }],
      ready: false,
      text: both("directionsFor"),
      options: directions(ctx, ids),
    }));
  };

  const askInspiration = (text: L) => exchange(userMsg(text), () => ({ id: id(), role: "ai", kind: "pickInspiration" }));
  const askProduct = (text: L) => exchange(userMsg(text), () => ({ id: id(), role: "ai", kind: "pickProduct" }));

  const productDirections = (product: Product, text: L) => {
    const found = productPhotos(ctx.photos, product);
    const n = found.photos.length;
    const where = found.where === "uploads" ? "foundInUploads" : found.where === "library" ? "foundInLibrary" : "foundNone";
    exchange(userMsg(text), () => ({
      id: id(),
      role: "ai",
      kind: "directions",
      steps: [{ key: "product", v: product.name }, { key: "look" }, { key: "directions" }],
      ready: false,
      text: {
        en: `${product.name.en} · ${product.price.en} · ${product.detail.en}\n${translate("en", where, { n })} ${translate("en", "directionsIntro")}`,
        ar: `${product.name.ar} · ${product.price.ar} · ${product.detail.ar}\n${translate("ar", where, { n: num(n, "ar") })} ${translate("ar", "directionsIntro")}`,
      },
      options: directions(
        ctx,
        found.photos.map((p) => p.id),
      ),
    }));
  };

  const answer = (text: L, answerId: string) => {
    if (answerId === "post-next") return nextPost(text);
    exchange(userMsg(text), () => ({ id: id(), role: "ai", kind: "answer", answerId }));
  };

  /**
   * A typed question none of the sample answers matches: a short reply from the AI (POST /api/ai-chat,
   * Gemini through the app's AI service). When the AI is off, over its budget or fails, the proposal's
   * sample answer for the mode is shown instead, as before. Nothing is saved.
   */
  const askAi = (text: L, question: string) => {
    const mode = s().chatMode;
    const fallback = matchQuestion(question, mode);
    const chatId = s().pushAi([userMsg(text)], { title: text });
    const started = Date.now();
    setTyping(true);
    apiFetch<{ text: string | null }>("/api/ai-chat", { method: "POST", body: { mode, question } })
      .then((r) => r.text)
      .catch(() => null)
      .then((reply) => {
        window.setTimeout(
          () => {
            const msg: AiMsg = reply
              ? { id: id(), role: "ai", kind: "text", text: same(reply) }
              : fallback === "post-next"
                ? nextPostReply()
                : { id: id(), role: "ai", kind: "answer", answerId: fallback };
            s().pushAi([msg], { chatId });
            setTyping(false);
          },
          Math.max(0, DELAY - (Date.now() - started)),
        );
      });
  };

  /**
   * "Create a similar post" from a competitor's post (Competitors → the viewer). The AI explains what makes
   * their post work and writes a new one in that style for the owner's own photo (an attached one, else
   * one from the matching category): POST /api/ai-chat/similar-post. When the AI is off, over its budget,
   * fails or copies them, the sample answer is written here from the post's format and caption. Their image
   * and wording are never reused. Nothing is saved.
   */
  const similar = (reference: CompetitorPostRef, text: L, photoIds: string[]) => {
    s().setChatMode("post");
    const source = { handle: reference.handle, caption: reference.post.caption ?? "", icon: reference.post.icon, format: reference.post.format };
    const attached = photoIds.map((pid) => ctx.photos.find((p) => p.id === pid)).find((p) => p !== undefined);
    // What their post is about, in the owner's categories (none when it matches nothing they sell).
    const theirs = findCategory(ctx.account.id, matchCategory(ctx, source));
    const photo = attached ?? similarPhoto(ctx, theirs?.id);
    const category = findCategory(ctx.account.id, photo.category);
    const style = competitorStyle(source.caption);
    const chatId = s().pushAi([userMsg(text, { reference, photoIds: attached ? [attached.id] : undefined })], { title: text });
    const started = Date.now();
    setTyping(true);
    apiFetch<{ post: SimilarPostDto | null }>("/api/ai-chat/similar-post", {
      method: "POST",
      body: { competitorId: reference.competitorId, postId: reference.post.id, photo: { name: photo.dish.en, nameAr: photo.dish.ar, category: category?.name.en } },
    })
      .then((r) => r.post)
      .catch(() => null)
      .then((ai) => {
        window.setTimeout(
          () => {
            const base = similarPost(ctx, photo.id, style, reference.handle);
            const why = ai ?? whyItWorks(source, style, theirs);
            const line = (lang: Lang) =>
              [
                translate(lang, "similarWhy", { handle: reference.handle }),
                `• ${translate(lang, "similarTopic")}: ${why.topic[lang]}`,
                `• ${translate(lang, "similarStyle")}: ${why.style[lang]}`,
                `• ${translate(lang, "similarHook")}: ${why.hook[lang]}`,
                "",
                translate(lang, category ? "similarOutroAlbum" : "similarOutro", { dish: photo.dish[lang], album: category?.name[lang] ?? "" }),
              ].join("\n");
            s().pushAi(
              [
                {
                  id: id(),
                  role: "ai",
                  kind: "post",
                  steps: [{ key: "style", v: same(reference.handle) }, ...PHOTO_STEPS],
                  ready: false,
                  text: { en: line("en"), ar: line("ar") },
                  post: ai ? { ...base, caption: ai.caption, hashtags: ai.hashtags } : base,
                },
              ],
              { chatId },
            );
            setTyping(false);
          },
          Math.max(0, DELAY - (Date.now() - started)),
        );
      });
  };

  return {
    typing,

    /** Sends what's in the composer. */
    send() {
      const { composer, chatMode } = s();
      const q = composer.text.trim();
      if (typing || (!q && composer.photoIds.length === 0 && !composer.reference)) return;
      s().setComposer({ text: "", photoIds: [], reference: undefined });
      if (composer.reference) return similar(composer.reference, q ? same(q) : both("similarPrompt", () => ({ handle: composer.reference!.handle })), composer.photoIds);
      const text = q ? same(q) : both(composer.photoIds.length > 1 ? "photosPrompt" : "photoPrompt");
      const lower = q.toLowerCase();
      if (composer.photoIds.length > 1 && /combin|mix|merge|blend|دمج|ادمج|اجمع|امزج|مزج/.test(lower)) return combine(composer.photoIds, text, q);
      if (composer.photoIds.length) return postFromPhotos(composer.photoIds, text, /direction|option|idea|اتجاه|خيار|أفكار/.test(lower));
      if (chatMode === "post") {
        const product = productsFor(ctx.account.id).find((p) => lower.includes(p.name.en.toLowerCase()) || q.includes(p.name.ar));
        if (product) return productDirections(product, text);
        if (/like this|style|inspir|مثل|أسلوب|إلهام/.test(lower)) return askInspiration(text);
        if (/product|منتج/.test(lower)) return askProduct(text);
        if (/direction|option|idea|اتجاه|خيار|أفكار/.test(lower)) return directionsForNext(text);
      }
      const hit = matchRule(q, chatMode);
      if (hit) return answer(text, hit);
      askAi(text, q);
    },

    /** Suggested prompts. Returns "attach" when the photo picker should open instead. */
    prompt(promptId: string, text: L): "attach" | void {
      if (typing) return;
      if (promptId === "x-photo" || promptId === "x-combine") return "attach";
      if (promptId === "x-like") return askInspiration(text);
      if (promptId === "x-product") return askProduct(text);
      if (promptId === "x-directions") return directionsForNext(text);
      answer(text, promptId);
    },

    pickInspiration(msgId: string, sourceId: string) {
      const source = findSource(ctx, sourceId);
      if (!source || typing) return;
      s().updateAiMsg(msgId, { chosen: sourceId });
      const post = inspiredPost(ctx, source);
      const photo = ctx.photos.find((p) => p.id === post.photoIds[0])!;
      exchange(userMsg(both("likeThisPost", () => ({ handle: source.handle })), { refThumb: source.thumb }), () => ({
        id: id(),
        role: "ai",
        kind: "post",
        steps: [{ key: "style", v: same(source.handle) }, ...PHOTO_STEPS],
        ready: false,
        text: {
          en: `@${source.handle}'s post works because it uses ${STYLE_LABEL[source.style].en}. Here's a new post in that style, on your own "${photo.dish.en}" photo:`,
          ar: `منشور ⁦@${source.handle}⁩ ناجح لأنه يستخدم ${STYLE_LABEL[source.style].ar}. هذا منشور جديد بنفس الأسلوب على صورتك «${photo.dish.ar}»:`,
        },
        post,
      }));
    },

    pickProduct(msgId: string, productId: string) {
      const product = productsFor(ctx.account.id).find((p) => p.id === productId);
      if (!product || typing) return;
      s().updateAiMsg(msgId, { chosen: productId });
      productDirections(product, both("productPrompt", (lang) => ({ product: product.name[lang] })));
    },

    chooseDirection(msgId: string, index: number) {
      const msg = s()
        .chats[s().activeAccountId]?.flatMap((c) => c.messages)
        .find((m) => m.id === msgId);
      if (!msg || msg.role !== "ai" || msg.kind !== "directions" || typing) return;
      const option = msg.options[index];
      s().updateAiMsg(msgId, { chosen: index });
      const label = DIRECTION_LABEL[option.direction ?? "warm"];
      // A combined AI image joins the gallery (AI Generated + its category album) once its direction is picked.
      const { aiImage, ...rest } = option;
      const post = aiImage ? { ...rest, photoIds: [s().addAiImage(aiImage)] } : postWithVariants(ctx, { ...rest });
      exchange(userMsg(both("goWith", (lang) => ({ name: label[lang] }))), () => ({
        id: id(),
        role: "ai",
        kind: "post",
        steps: post.variants ? [{ key: "hashtags" }, { key: "images" }, { key: "time" }] : [{ key: "hashtags" }, { key: "time" }],
        ready: false,
        text: both(aiImage ? "postReadyCombined" : post.variants ? "postReadyVariants" : "postReady"),
        post,
      }));
    },
  };
}

export type AiEngine = ReturnType<typeof useAiEngine>;

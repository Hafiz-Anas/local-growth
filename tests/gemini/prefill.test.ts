import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_AIM, DEFAULT_GOALS, DEFAULT_TIMELINE, ONBOARDING_STEPS, PROGRESS_STEPS, TONE_PRESETS, stepId, tonePresetOf } from "../../config/onboarding";
import { TextGenerationError } from "../../lib/services/text/errors";
import { focusLines } from "../../lib/services/text/focus";
import { extractHashtags, parsePrefill } from "../../lib/services/text/prefill";
import { brandPrefillPrompt, captionPrompt, reportSummaryPrompt, replyPrompt } from "../../lib/services/text/prompts";

const BIO = "Specialty coffee & saffron cashews, roasted daily in Shuwaikh ☕ #MathanetBaity";
const CAPTIONS = [
  "Fresh batch of saffron cashews today 🌰 #q8food #MathanetBaity",
  "Weekend gahwa with cardamom #q8food #قهوة_عربية",
  "New: pistachio maamoul #q8food",
];

describe("Onboarding steps", () => {
  it("is five light, skippable steps, with defaults for the goals", () => {
    assert.deepEqual([...ONBOARDING_STEPS], ["business", "style", "goals", "location", "competitors"]);
    assert.deepEqual([...PROGRESS_STEPS], [...ONBOARDING_STEPS]);
    // Stored step numbers beyond the list (old 7-step wizard) land on the last step.
    assert.equal(stepId(7), "competitors");
    assert.equal(DEFAULT_AIM, "more_customers");
    assert.deepEqual(DEFAULT_GOALS, ["post_consistently", "grow_reach"]);
    assert.equal(DEFAULT_TIMELINE, "3_months");
    assert.equal(tonePresetOf(TONE_PRESETS.formal), "formal");
    assert.equal(tonePresetOf(72), "casual");
  });
});

describe("Onboarding pre-fill", () => {
  it("reads the hashtags the account uses, most used first, without the AI", () => {
    assert.deepEqual(extractHashtags([BIO, ...CAPTIONS]), ["#q8food", "#MathanetBaity", "#قهوة_عربية"]);
    assert.deepEqual(extractHashtags(["no tags here"]), []);
  });

  it("keeps the AI to what the account shows: hashtags from the list, products that are named", () => {
    const answer = JSON.stringify({
      business_type: "roastery",
      niche: "  Specialty coffee and nut roastery  ",
      tone_level: 64.6,
      hashtags: ["#q8food", "#coffeelover", "MathanetBaity"],
      products: ["saffron cashews", "Pistachio maamoul", "Wedding trays"],
    });
    const s = parsePrefill(answer, { candidates: extractHashtags([BIO, ...CAPTIONS]), sourceText: [BIO, ...CAPTIONS].join(" ") });
    assert.equal(s.businessType, "roastery");
    assert.equal(s.niche, "Specialty coffee and nut roastery");
    assert.equal(s.toneLevel, 65);
    // "#coffeelover" isn't used by the account; "MathanetBaity" is, written the account's way.
    assert.deepEqual(s.hashtags, ["#q8food", "#MathanetBaity"]);
    // "Wedding trays" isn't in the bio or captions.
    assert.deepEqual(s.products, ["saffron cashews", "Pistachio maamoul"]);
  });

  it("menu categories are short labels — never sentences, prices or links", () => {
    const s = parsePrefill(
      JSON.stringify({ business_type: "bakery", niche: "", tone_level: 50, hashtags: [], products: [], categories: ["Cakes", "#Sweets", "Cakes", "Our amazing cakes are the best in town", "Cakes 5 KD", "www.kb.com", "x"] }),
      { candidates: [], sourceText: "" },
    );
    assert.deepEqual(s.categories, ["Cakes", "Sweets"]);
  });

  it("unknown or empty answers become empty fields, bad JSON is bad_output", () => {
    const s = parsePrefill(JSON.stringify({ business_type: "spaceship", niche: "", tone_level: "loud", hashtags: "x", products: null }), { candidates: [], sourceText: "" });
    assert.deepEqual(s, { businessType: null, niche: null, toneLevel: null, hashtags: [], products: [], categories: [] });
    assert.throws(() => parsePrefill("sure! here you go", { candidates: [], sourceText: "" }), (e: TextGenerationError) => e.reason === "bad_output");
  });

  it("prompt: only what the bio and captions show, niche in the owner's language", () => {
    const p = brandPrefillPrompt({ businessName: "Mathanet Baity", username: "mathanet_baity", bio: BIO, captions: CAPTIONS, hashtagCandidates: ["#q8food"], locale: "ar" });
    assert.match(p.system, /Never invent products, places or offers/);
    assert.match(p.system, /niche: a few words in Arabic/);
    assert.match(p.system, /<hashtag_candidates>\n#q8food\n<\/hashtag_candidates>/);
    assert.ok(p.schema);
    assert.ok(p.timeoutMs <= 20_000, "onboarding shouldn't wait long for it");
  });
});

describe("Business focus in every prompt", () => {
  const focus = { niche: "Specialty roastery", aim: "more_customers", goals: ["post_consistently", "promote_offers"], timeline: "3_months", exampleCaption: "Roasted this morning ☕" };

  it("turns niche, aim, goals, timeline and example caption into prompt lines", () => {
    assert.deepEqual(focusLines(focus), [
      "Niche / theme: Specialty roastery",
      "Main aim on Instagram: get more customers and orders",
      "Goals: post consistently, promote offers",
      "Timeline: the next 3 months",
      'Example caption the owner gave (their voice): "Roasted this morning ☕"',
    ]);
    assert.deepEqual(focusLines({ niche: null, aim: null, goals: [], timeline: null }), []);
  });

  it("captions, replies and the weekly summary get it", () => {
    const caption = captionPrompt({
      businessName: "Mathanet Baity",
      businessNameAr: null,
      handle: "mathanet_baity",
      categoryLabel: "Nuts",
      productNames: ["Cashews"],
      occasionLabel: "Promotion",
      firstLanguage: "en",
      count: 1,
      variant: 0,
      toneLevel: 50,
      wordsToUse: [],
      wordsToAvoid: [],
      hashtags: [],
      brandSummary: null,
      captionStyle: null,
      purposePattern: null,
      focus,
    });
    assert.match(caption.user, /Main aim on Instagram: get more customers and orders/);
    assert.match(caption.user, /Example caption the owner gave/);
    const reply = replyPrompt({ businessName: "Mathanet Baity", businessNameAr: null, text: "Hi", greetName: "", language: "en", channel: "comment", toneLevel: 50, brandWords: [], niche: "Specialty roastery" });
    assert.match(reply.system, /on behalf of Mathanet Baity \(Specialty roastery\)/);
    const report = reportSummaryPrompt({ businessName: "Mathanet Baity", businessNameAr: null, numbers: "Posts: 3", aim: "more_followers" });
    assert.match(report.system, /main aim is to grow followers/);
  });
});

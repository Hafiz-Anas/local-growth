import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { ImageGenerationError, sanitizeImageError } from "../../lib/services/images/errors";
import { classifyGeminiError, extractImage, generateGeminiImage, readGeminiConfig } from "../../lib/services/images/gemini";
import { placeholderPng } from "../../lib/services/images/placeholder";
import { buildImagePrompt, captionForPrompt } from "../../lib/services/images/prompt";
import { sniffImage } from "../../lib/uploads/sniff";

const fx = JSON.parse(readFileSync(new URL("./fixtures.json", import.meta.url), "utf8")) as Record<string, unknown>;
const KEY = "AIzaSyTEST-not-a-real-key-0123456789abc";
const CONFIG = { apiKey: KEY, model: "gemini-3.1-flash-image", baseUrl: "https://gemini.test/v1beta" };

/** A fetch stub that records the request and answers with a fixture. */
function stub(status: number, body: unknown) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

async function failure(status: number, fixture: string): Promise<ImageGenerationError> {
  const { fetchImpl } = stub(status, fx[fixture]);
  try {
    await generateGeminiImage(CONFIG, "a photo", fetchImpl);
  } catch (error) {
    assert.ok(error instanceof ImageGenerationError, `expected ImageGenerationError, got ${error}`);
    return error;
  }
  assert.fail(`${fixture} should have failed`);
}

describe("Gemini image generation (stubbed)", () => {
  it("posts the prompt to generateContent with the key in a header, never in the URL", async () => {
    const { fetchImpl, calls } = stub(200, fx.success);
    const image = await generateGeminiImage(CONFIG, "Fresh maamoul on a cream plate", fetchImpl);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://gemini.test/v1beta/models/gemini-3.1-flash-image:generateContent");
    assert.ok(!calls[0].url.includes(KEY));
    assert.equal((calls[0].init.headers as Record<string, string>)["x-goog-api-key"], KEY);
    const body = JSON.parse(String(calls[0].init.body));
    assert.equal(body.contents[0].parts[0].text, "Fresh maamoul on a cream plate");
    assert.deepEqual(body.generationConfig.responseModalities, ["TEXT", "IMAGE"]);
    assert.equal(body.generationConfig.imageConfig.aspectRatio, "1:1");
    assert.equal(image.extension, "png");
    assert.equal(image.model, "gemini-3.1-flash-image");
    assert.equal(sniffImage(image.data), "png");
  });

  it("reads snake_case inline_data too", () => {
    assert.equal(extractImage(fx.successSnakeCase, "m").extension, "png");
  });

  it("explains responses without an image", () => {
    assert.throws(() => extractImage(fx.textOnly, "m"), (e: ImageGenerationError) => e.reason === "no_image");
    assert.throws(() => extractImage(fx.promptBlocked, "m"), (e: ImageGenerationError) => e.reason === "blocked" && e.providerCode === "PROHIBITED_CONTENT");
    assert.throws(() => extractImage(fx.imageSafety, "m"), (e: ImageGenerationError) => e.reason === "blocked");
  });

  it("maps quota, billing and key errors to friendly reasons", async () => {
    assert.equal((await failure(429, "errorDailyFreeTier")).reason, "daily_limit");
    assert.equal((await failure(429, "errorPerMinute")).reason, "rate_limited");
    assert.equal((await failure(429, "errorNoFreeTier")).reason, "billing");
    assert.equal((await failure(400, "errorInvalidKey")).reason, "invalid_key");
    assert.equal((await failure(403, "errorPermission")).reason, "invalid_key");
    assert.equal((await failure(400, "errorBilling")).reason, "billing");
    assert.equal((await failure(400, "errorRegion")).reason, "region");
    assert.equal((await failure(404, "errorModelNotFound")).reason, "model_unavailable");
    assert.equal((await failure(503, "errorOverloaded")).reason, "unavailable");
  });

  it("keeps the HTTP status and Google's status code for the log", async () => {
    const error = await failure(429, "errorDailyFreeTier");
    assert.equal(error.httpStatus, 429);
    assert.equal(error.providerCode, "RESOURCE_EXHAUSTED");
  });

  it("treats network failures and non-JSON answers as unavailable", async () => {
    const offline = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    await assert.rejects(generateGeminiImage(CONFIG, "x", offline), (e: ImageGenerationError) => e.reason === "unavailable");
    const html = (async () => new Response("<html>Bad gateway</html>", { status: 502 })) as unknown as typeof fetch;
    await assert.rejects(generateGeminiImage(CONFIG, "x", html), (e: ImageGenerationError) => e.reason === "unavailable");
  });

  it("classifies an unknown 400 as a rejected request", () => {
    assert.equal(classifyGeminiError(400, { error: { code: 400, status: "INVALID_ARGUMENT", message: "Request contains an invalid argument." } }), "request_rejected");
  });

  it("never lets a key into logged messages", () => {
    assert.equal(sanitizeImageError(`bad key ${KEY} in https://x.test/?key=${KEY}&a=1`).includes(KEY), false);
  });

  it("reads the key and model from the environment", () => {
    assert.equal(readGeminiConfig({}), null);
    assert.equal(readGeminiConfig({ GEMINI_API_KEY: "  " }), null);
    assert.deepEqual(readGeminiConfig({ GEMINI_API_KEY: KEY }), { apiKey: KEY, model: "gemini-3.1-flash-image" });
    assert.equal(readGeminiConfig({ GEMINI_API_KEY: KEY, GEMINI_IMAGE_MODEL: "gemini-3-pro-image" })?.model, "gemini-3-pro-image");
    assert.equal(readGeminiConfig({ GEMINI_API_KEY: KEY, GEMINI_API_BASE: "http://localhost:4546/v1beta" })?.baseUrl, "http://localhost:4546/v1beta");
  });
});

describe("image prompt", () => {
  const base = {
    businessName: "Fereej Bakery",
    businessType: "bakery",
    location: "Salmiya, Kuwait",
    brandSummary: "A family bakery known for fresh maamoul.",
    visualStyle: { summary: "Warm, cream-and-gold look.", traits: ["Close-up product shots", "Photo-led feed"] },
    colors: ["#c08552", "#f1e4d3"],
    purpose: "Menu item or product",
    product: "Date maamoul",
    caption: "معمول التمر الطازج وصل اليوم 🌴\nاطلبوا الحين! @fereej.bakery https://wa.me/965\n\n#maamoul #kuwait",
  };

  it("uses the brand profile, the caption and the post's purpose", () => {
    const prompt = buildImagePrompt(base);
    for (const part of ["Fereej Bakery", "bakery in Salmiya, Kuwait", "Menu item or product", "Date maamoul", "family bakery", "cream-and-gold", "Close-up product shots", "#c08552", "معمول التمر الطازج"]) {
      assert.ok(prompt.includes(part), `prompt should mention ${part}`);
    }
    assert.match(prompt, /Do not include any text/);
  });

  it("drops hashtags, mentions, links and emojis from the caption", () => {
    const text = captionForPrompt(base.caption);
    assert.equal(text, "معمول التمر الطازج وصل اليوم اطلبوا الحين!");
  });

  it("works without a brand profile", () => {
    const prompt = buildImagePrompt({ ...base, brandSummary: null, visualStyle: null, colors: [], businessType: null, location: null, product: null });
    assert.ok(prompt.startsWith("Create a square (1:1) Instagram feed photo for Fereej Bakery, a local business."));
    assert.ok(!prompt.includes("Brand colours"));
  });

  it("stays a reasonable length", () => {
    assert.ok(buildImagePrompt({ ...base, caption: "x ".repeat(5000), brandSummary: "y ".repeat(5000) }).length <= 2000);
  });
});

describe("mock placeholder image", () => {
  it("is a real PNG, different per variant", () => {
    const a = placeholderPng(["#c08552", "#6b3e26"], 1, 64);
    const b = placeholderPng(["#c08552", "#6b3e26"], 2, 64);
    assert.equal(sniffImage(a), "png");
    assert.equal(a.readUInt32BE(16), 64); // IHDR width
    assert.notDeepEqual(a, b);
  });

  it("falls back to default colours", () => {
    assert.equal(sniffImage(placeholderPng([], 0, 16)), "png");
    assert.equal(sniffImage(placeholderPng(["not-a-colour"], 0, 16)), "png");
  });
});

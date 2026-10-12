import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyResendError, createResendClient, ResendApiError, ResendEmailService, type ResendClient, type ResendPayload } from "../../lib/services/mail/resend";
import { escapeHtml, renderEmailVerification, renderOnboardingInvite, renderPasswordReset } from "../../lib/services/mail/templates";
import { EmailSendError, emailLocale } from "../../lib/services/mail/types";

const API_KEY = "re_test_SECRET_key_123";
const NOW = new Date("2026-10-12T10:00:00Z");

/** Stand-in for the Resend API (never calls resend.com). */
function stubClient(fail?: unknown) {
  const sent: ResendPayload[] = [];
  const client: ResendClient = {
    async send(payload) {
      if (fail) throw fail;
      sent.push(payload);
      return { id: `email_${sent.length}` };
    },
  };
  return { client, sent };
}

/** Captures log lines so tests can check nothing secret is written. */
function captureLogger() {
  const lines: string[] = [];
  return { lines, logger: { error: (...a: unknown[]) => lines.push(a.join(" ")), info: (...a: unknown[]) => lines.push(a.join(" ")) } };
}

const verify = {
  to: "owner@example.com",
  name: "Sara",
  locale: "en" as const,
  verifyUrl: "https://local-growth-five.vercel.app/verify-email?token=abc123",
  expiresAt: new Date(NOW.getTime() + 48 * 3600_000),
};

describe("email templates", () => {
  it("renders the verification email in English with HTML and a plain-text fallback", () => {
    const email = renderEmailVerification(verify, NOW);
    assert.equal(email.subject, "Confirm your email for Local Growth Engine");
    assert.match(email.html, /<html lang="en" dir="ltr">/);
    assert.match(email.html, /href="https:\/\/local-growth-five\.vercel\.app\/verify-email\?token=abc123"/);
    assert.match(email.html, /#0095f6/);
    assert.match(email.text, /Hi Sara,/);
    assert.match(email.text, /Verify email: https:\/\/local-growth-five\.vercel\.app\/verify-email\?token=abc123/);
    assert.match(email.text, /expires in 48 hours/);
    assert.doesNotMatch(email.text, /</);
  });

  it("renders Arabic right-to-left", () => {
    const email = renderPasswordReset({ ...verify, locale: "ar", resetUrl: "http://localhost:3000/reset-password?token=t", expiresAt: new Date(NOW.getTime() + 3600_000) }, NOW);
    assert.match(email.html, /<html lang="ar" dir="rtl">/);
    assert.match(email.html, /dir="rtl" style="[^"]*text-align:right/);
    assert.match(email.subject, /إعادة تعيين كلمة المرور/);
    assert.match(email.text, /60 دقيقة/);
    // The link itself stays left-to-right.
    assert.match(email.html, /dir="ltr"><a href="http:\/\/localhost:3000\/reset-password\?token=t"/);
  });

  it("escapes user-provided values in HTML", () => {
    const email = renderOnboardingInvite({ to: "a@b.co", name: "<script>x</script>", locale: "en", businessName: `Café "&" Co`, loginUrl: "http://localhost:3000/login" });
    assert.doesNotMatch(email.html, /<script>/);
    assert.match(email.html, /&lt;script&gt;/);
    assert.match(email.html, /Café &quot;&amp;&quot; Co/);
    assert.equal(email.subject, `Set up the brand profile for Café "&" Co`);
    assert.equal(escapeHtml(`'`), "&#39;");
  });

  it("picks the saved language, else English", () => {
    assert.equal(emailLocale({ language: "ar", theme: "dark" }), "ar");
    assert.equal(emailLocale({ language: "en" }), "en");
    assert.equal(emailLocale({ language: "fr" }), "en");
    assert.equal(emailLocale(null), "en");
  });
});

describe("ResendEmailService", () => {
  it("sends one message per email with from, to, subject, html and text", async () => {
    const stub = stubClient();
    const log = captureLogger();
    const service = new ResendEmailService({ client: stub.client, from: "Local Growth Engine <hello@raidtechs.com>", logger: log.logger });
    await service.sendEmailVerification(verify);
    await service.sendPasswordReset({ ...verify, resetUrl: "http://localhost:3000/reset-password?token=x" });
    await service.sendOnboardingInvite({ to: "b@example.com", name: "Ali", locale: "ar", businessName: "Al-bait", loginUrl: "http://localhost:3000/login" });

    assert.equal(stub.sent.length, 3);
    assert.deepEqual(stub.sent[0].to, ["owner@example.com"]);
    assert.equal(stub.sent[0].from, "Local Growth Engine <hello@raidtechs.com>");
    assert.ok(stub.sent[0].html.includes("verify-email?token=abc123"));
    assert.ok(stub.sent[0].text.length > 0);
    assert.match(stub.sent[2].html, /dir="rtl"/);
    assert.ok(log.lines.every((line) => !line.includes(API_KEY)));
  });

  it("fails with reason config when the key or sender is missing", async () => {
    const log = captureLogger();
    const noKey = new ResendEmailService({ client: null, from: "a@b.co", logger: log.logger });
    await assert.rejects(noKey.sendEmailVerification(verify), (e: unknown) => e instanceof EmailSendError && e.reason === "config");
    const noFrom = new ResendEmailService({ client: stubClient().client, from: "  ", logger: log.logger });
    await assert.rejects(noFrom.sendEmailVerification(verify), (e: unknown) => e instanceof EmailSendError && e.reason === "config" && /EMAIL_FROM/.test(e.message));
  });

  it("turns provider errors into EmailSendError and logs them without the key or full address", async () => {
    const cases: Array<[unknown, string, number | undefined]> = [
      [new ResendApiError(401, "validation_error", "API key is invalid"), "rejected", 401],
      [new ResendApiError(403, "validation_error", "The raidtechs.com domain is not verified."), "rejected", 403],
      [new ResendApiError(429, "rate_limit_exceeded", "Too many requests"), "rate_limited", 429],
      [new ResendApiError(503, "internal_server_error", "Unavailable"), "unavailable", 503],
      [Object.assign(new Error("timed out"), { name: "TimeoutError" }), "unavailable", undefined],
      [new TypeError("fetch failed"), "unavailable", undefined],
    ];
    for (const [failure, reason, status] of cases) {
      const log = captureLogger();
      const service = new ResendEmailService({ client: stubClient(failure).client, from: "a@b.co", logger: log.logger });
      await assert.rejects(service.sendPasswordReset({ ...verify, resetUrl: "http://x/reset" }), (e: unknown) => {
        assert.ok(e instanceof EmailSendError);
        assert.equal(e.reason, reason);
        assert.equal(e.status, status);
        return true;
      });
      assert.equal(log.lines.length, 1);
      assert.match(log.lines[0], /\[email:resend\] password reset to \*@example\.com failed/);
      assert.doesNotMatch(log.lines[0], /owner@/);
    }
    assert.equal(classifyResendError(new ResendApiError(422, "invalid_parameter", "bad to")).reason, "rejected");
  });
});

describe("createResendClient", () => {
  it("POSTs to /emails with the key only in the Authorization header", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchStub = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return Response.json({ id: "4ef9a417" });
    }) as typeof fetch;
    const client = createResendClient({ apiKey: API_KEY, fetch: fetchStub, apiBase: "http://stub.test/" });
    const payload: ResendPayload = { from: "a@b.co", to: ["c@d.co"], subject: "S", html: "<p>h</p>", text: "h" };
    assert.deepEqual(await client.send(payload), { id: "4ef9a417" });

    assert.equal(calls[0].url, "http://stub.test/emails");
    assert.equal(calls[0].init.method, "POST");
    assert.equal((calls[0].init.headers as Record<string, string>).Authorization, `Bearer ${API_KEY}`);
    assert.deepEqual(JSON.parse(String(calls[0].init.body)), payload);
    assert.ok(!String(calls[0].init.body).includes(API_KEY));
  });

  it("throws ResendApiError with Resend's error type and message, never the key", async () => {
    const fetchStub = (async () => Response.json({ statusCode: 403, name: "validation_error", message: "The raidtechs.com domain is not verified." }, { status: 403 })) as typeof fetch;
    const client = createResendClient({ apiKey: API_KEY, fetch: fetchStub, apiBase: "http://stub.test" });
    await assert.rejects(client.send({ from: "a@b.co", to: ["c@d.co"], subject: "S", html: "h", text: "h" }), (e: unknown) => {
      assert.ok(e instanceof ResendApiError);
      assert.equal(e.status, 403);
      assert.equal(e.type, "validation_error");
      assert.match(e.message, /domain is not verified/);
      assert.ok(!e.message.includes(API_KEY));
      return true;
    });
  });

  it("handles a non-JSON error body", async () => {
    const fetchStub = (async () => new Response("Bad gateway", { status: 502 })) as typeof fetch;
    const client = createResendClient({ apiKey: API_KEY, fetch: fetchStub, apiBase: "http://stub.test" });
    await assert.rejects(client.send({ from: "a@b.co", to: ["c@d.co"], subject: "S", html: "h", text: "h" }), (e: unknown) => e instanceof ResendApiError && e.status === 502 && classifyResendError(e).reason === "unavailable");
  });
});

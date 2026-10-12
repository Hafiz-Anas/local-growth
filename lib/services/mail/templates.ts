import { SITE, type Locale } from "@/config/site";
import { directionOf, translate, type TranslateVars } from "@/lib/i18n";
import type { EmailVerificationEmail, OnboardingInviteEmail, PasswordResetEmail, RenderedEmail } from "./types";

/**
 * HTML + plain-text bodies for every outgoing email, in English or Arabic
 * (copy under `email.*` in the locale files). Table layout with inline styles
 * so it renders the same in Gmail, Outlook and Apple Mail; Arabic is
 * right-to-left. Brand colours mirror the light tokens in app/globals.css.
 */
const COLORS = {
  page: "#fafafa",
  card: "#ffffff",
  border: "#dbdbdb",
  text: "#000000",
  muted: "#737373",
  primary: "#0095f6",
  onPrimary: "#ffffff",
} as const;

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, 'Noto Sans Arabic', Tahoma, sans-serif";

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

interface Layout {
  locale: Locale;
  subject: string;
  /** Preview line shown by mail apps next to the subject. */
  preheader: string;
  greeting: string;
  paragraphs: string[];
  button: { label: string; url: string };
  /** Smaller notes under the button (expiry, "ignore this email"). */
  notes: string[];
}

function render(layout: Layout): RenderedEmail {
  const { locale } = layout;
  const t = (key: string, vars?: TranslateVars) => translate(locale, key, vars);
  const dir = directionOf(locale);
  const align = dir === "rtl" ? "right" : "left";
  const footer = t("email.common.footer", { product: SITE.name, company: SITE.company });
  const fallback = t("email.common.buttonFallback");
  const url = escapeHtml(layout.button.url);
  const p = (text: string, style: string) => `<p style="margin:0 0 16px;${style}">${escapeHtml(text)}</p>`;

  const html = `<!doctype html>
<html lang="${locale}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(layout.subject)}</title>
</head>
<body style="margin:0;padding:0;background:${COLORS.page};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(layout.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${COLORS.page};">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" dir="${dir}" style="max-width:480px;background:${COLORS.card};border:1px solid ${COLORS.border};border-radius:12px;font-family:${FONT};color:${COLORS.text};text-align:${align};">
<tr><td style="padding:28px 32px 0;font-size:18px;font-weight:700;color:${COLORS.primary};">${escapeHtml(SITE.name)}</td></tr>
<tr><td style="padding:24px 32px 8px;font-size:15px;line-height:1.55;">
${p(layout.greeting, "font-weight:600;")}
${layout.paragraphs.map((text) => p(text, "")).join("\n")}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;"><tr>
<td style="border-radius:8px;background:${COLORS.primary};"><a href="${url}" style="display:inline-block;padding:12px 22px;font-size:15px;font-weight:600;color:${COLORS.onPrimary};text-decoration:none;border-radius:8px;">${escapeHtml(layout.button.label)}</a></td>
</tr></table>
${layout.notes.map((text) => p(text, `font-size:13px;color:${COLORS.muted};`)).join("\n")}
<p style="margin:0 0 4px;font-size:13px;color:${COLORS.muted};">${escapeHtml(fallback)}</p>
<p style="margin:0 0 16px;font-size:13px;word-break:break-all;" dir="ltr"><a href="${url}" style="color:${COLORS.primary};">${url}</a></p>
</td></tr>
<tr><td style="padding:16px 32px 24px;border-top:1px solid ${COLORS.border};font-size:12px;color:${COLORS.muted};">${escapeHtml(footer)}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  const text = [
    layout.greeting,
    "",
    ...layout.paragraphs.flatMap((line) => [line, ""]),
    `${layout.button.label}: ${layout.button.url}`,
    "",
    ...layout.notes,
    "",
    "—",
    footer,
  ].join("\n");

  return { subject: layout.subject, html, text };
}

/** "48 hours" / "60 minutes" in the email's language. */
function expiryNote(locale: Locale, expiresAt: Date, now: Date): string {
  const minutes = Math.max(1, Math.round((expiresAt.getTime() - now.getTime()) / 60000));
  return minutes >= 120
    ? translate(locale, "email.common.expiresHours", { count: Math.round(minutes / 60) })
    : translate(locale, "email.common.expiresMinutes", { count: minutes });
}

export function renderEmailVerification(message: EmailVerificationEmail, now = new Date()): RenderedEmail {
  const { locale } = message;
  const t = (key: string, vars?: TranslateVars) => translate(locale, key, { product: SITE.name, ...vars });
  return render({
    locale,
    subject: t("email.verify.subject"),
    preheader: t("email.verify.preheader"),
    greeting: t("email.common.greeting", { name: message.name }),
    paragraphs: [t("email.verify.body")],
    button: { label: t("email.verify.button"), url: message.verifyUrl },
    notes: [expiryNote(locale, message.expiresAt, now), t("email.verify.ignore")],
  });
}

export function renderPasswordReset(message: PasswordResetEmail, now = new Date()): RenderedEmail {
  const { locale } = message;
  const t = (key: string, vars?: TranslateVars) => translate(locale, key, { product: SITE.name, ...vars });
  return render({
    locale,
    subject: t("email.reset.subject"),
    preheader: t("email.reset.preheader"),
    greeting: t("email.common.greeting", { name: message.name }),
    paragraphs: [t("email.reset.body")],
    button: { label: t("email.reset.button"), url: message.resetUrl },
    notes: [expiryNote(locale, message.expiresAt, now), t("email.reset.ignore")],
  });
}

export function renderOnboardingInvite(message: OnboardingInviteEmail): RenderedEmail {
  const { locale } = message;
  const t = (key: string, vars?: TranslateVars) => translate(locale, key, { product: SITE.name, business: message.businessName, ...vars });
  return render({
    locale,
    subject: t("email.invite.subject"),
    preheader: t("email.invite.preheader"),
    greeting: t("email.common.greeting", { name: message.name }),
    paragraphs: [t("email.invite.body"), t("email.invite.body2")],
    button: { label: t("email.invite.button"), url: message.loginUrl },
    notes: [],
  });
}

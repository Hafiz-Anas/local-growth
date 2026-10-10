




"use client";

import { useEffect, useState } from "react";
import { Heart, Lightbulb, MessageCircle, Sparkles } from "lucide-react";
import { LogoMark } from "@/components/brand/logo";
import { Avatar } from "@/components/shared/avatar";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

const SLIDES = ["dashboard", "replies", "experiment"] as const;
const INTERVAL_MS = 4000;
const BRAND = { src: "/avatars/businesses/mathanet-baity.svg", initials: "MB", tone: "roast" as const };

/**
 * Login-page visual: a phone mockup cross-fading between previews of the app.
 * Previews are live mini-layouts (not images), so they follow theme and language.
 */
export function AppShowcase() {
  const { t } = useI18n();
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setIndex((i) => (i + 1) % SLIDES.length), INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flex flex-col items-center">
      <p className="mb-6 max-w-[300px] text-center text-heading font-bold">{t("auth.showcaseHeadline")}</p>
      <div className="relative">
        <div className="absolute -inset-10 rounded-full bg-ig-gradient opacity-15 blur-3xl" aria-hidden="true" />
        <div className="relative h-[520px] w-[255px] overflow-hidden rounded-[42px] border-[9px] border-device bg-background shadow-[0_20px_50px_rgba(0,0,0,0.18)]">
          <div className="absolute start-1/2 top-2 z-10 h-5 w-20 -translate-x-1/2 rounded-pill bg-device rtl:translate-x-1/2" aria-hidden="true" />
          <div className="flex h-9 items-end justify-between px-5 pb-1 text-[10px] font-semibold" aria-hidden="true">
            <span dir="ltr">9:41</span>
            <span className="flex gap-1">
              <span className="h-2 w-3 rounded-[2px] bg-foreground" />
              <span className="h-2 w-4 rounded-[2px] border border-foreground" />
            </span>
          </div>
          <div className="flex items-center gap-2 border-b border-separator px-3 py-2">
            <LogoMark className="size-5" />
            <span className="text-[12px] font-bold">mathanet_baity</span>
          </div>
          <div className="relative h-[calc(100%-77px)]">
            {SLIDES.map((slide, i) => (
              <div
                key={slide}
                aria-hidden={i !== index}
                className={cn(
                  "absolute inset-0 overflow-hidden px-3 py-3 motion-safe:transition-opacity motion-safe:duration-700",
                  i === index ? "opacity-100" : "opacity-0",
                )}
              >
                {slide === "dashboard" && <DashboardSlide />}
                {slide === "replies" && <RepliesSlide />}
                {slide === "experiment" && <ExperimentSlide />}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-6 flex items-center gap-2" aria-hidden="true">
        {SLIDES.map((slide, i) => (
          <span key={slide} className={cn("h-1.5 rounded-pill transition-all duration-300", i === index ? "w-5 bg-foreground" : "w-1.5 bg-border")} />
        ))}
      </div>
      <p className="mt-2 text-caption text-muted" aria-live="polite">
        {t(`auth.slides.${SLIDES[index]}`)}
      </p>
    </div>
  );
}

function DashboardSlide() {
  const { t } = useI18n();
  const metrics = [
    [t("dashboard.metrics.reach"), "48.3K", "+18.4%"],
    [t("dashboard.metrics.engagementRate"), "6.8%", "+1.2%"],
    [t("dashboard.metrics.followerGrowth"), "+1,184", "+9.7%"],
    [t("dashboard.metrics.profileVisits"), "3,912", "+22.1%"],
  ];
  return (
    <div>
      <div className="flex items-center gap-3">
        <Avatar {...BRAND} size="lg" ring="story" />
        <div className="grid flex-1 grid-cols-3 text-center text-[10px] leading-3">
          {[
            ["846", t("common.posts")],
            ["18.4K", t("common.followers")],
            ["312", t("common.following")],
          ].map(([v, l]) => (
            <span key={l}>
              <span className="block text-[12px] font-bold">{v}</span>
              <span className="text-muted">{l}</span>
            </span>
          ))}
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-1.5">
        {metrics.map(([label, value, change]) => (
          <div key={label} className="rounded-[6px] border border-border p-2">
            <p className="truncate text-[9px] text-muted">{label}</p>
            <p className="text-[13px] font-bold" dir="ltr">
              {value}
            </p>
            <p className="text-[9px] font-semibold text-success" dir="ltr">
              ↗ {change}
            </p>
          </div>
        ))}
      </div>
      <div className="mt-2 rounded-[6px] border border-border p-2">
        <p className="text-[10px] font-bold">{t("dashboard.followerChart")}</p>
        <svg viewBox="0 0 200 60" className="mt-1 h-16 w-full rtl:-scale-x-100" aria-hidden="true">
          <defs>
            <linearGradient id="showcaseFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--lge-chart-line)" stopOpacity="0.25" />
              <stop offset="1" stopColor="var(--lge-chart-line)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d="M0 52 L20 48 L40 47 L60 42 L80 40 L100 33 L120 31 L140 24 L160 22 L180 12 L200 8 L200 60 L0 60Z" fill="url(#showcaseFill)" />
          <path d="M0 52 L20 48 L40 47 L60 42 L80 40 L100 33 L120 31 L140 24 L160 22 L180 12 L200 8" fill="none" stroke="var(--lge-chart-line)" strokeWidth="2" />
        </svg>
      </div>
    </div>
  );
}

function RepliesSlide() {
  const { t } = useI18n();
  const items = [
    { src: "/avatars/people/fajer-q8.svg", initials: "FQ", tone: "rose" as const, author: "fajer.q8", text: "بكم الكيلو الكاجو بالزعفران؟ 😍", reply: "هلا فجر 🤍 أرسلنا لك الأسعار على الواتساب" },
    { src: "/avatars/people/abdullah-alenezi.svg", initials: "AA", tone: "night" as const, author: "abdullah_alenezi", text: "Do you deliver to Jahra today?", reply: "Yes! Orders before 6pm arrive today 🚚" },
  ];
  return (
    <div>
      <p className="mb-2 text-[12px] font-bold">{t("engagement.queue.title")}</p>
      <div className="space-y-2.5">
        {items.map((c) => (
          <div key={c.author} className="text-[10px] leading-[13px]">
            <div className="flex gap-2">
              <Avatar src={c.src} initials={c.initials} tone={c.tone} size="xs" />
              <p className="min-w-0 flex-1" dir="auto">
                <span className="me-1 font-semibold">{c.author}</span>
                {c.text}
              </p>
              <Heart className="size-2.5 shrink-0 text-muted" />
            </div>
            <div className="ms-8 mt-1.5 rounded-[6px] bg-secondary-bg p-1.5">
              <div className="flex gap-1.5">
                <Avatar {...BRAND} size="xs" />
                <p className="min-w-0 flex-1" dir="auto">
                  <span className="me-1 inline-flex items-center gap-0.5 rounded-pill bg-primary-soft px-1 text-[8px] font-semibold text-primary">
                    <Sparkles className="size-2" />
                    {t("engagement.queue.aiDraft")}
                  </span>
                  {c.reply}
                </p>
              </div>
              <div className="mt-1.5 flex justify-end gap-1">
                <span className="rounded-[5px] px-1.5 py-0.5 text-[9px] font-semibold">{t("engagement.queue.dismiss")}</span>
                <span className="rounded-[5px] bg-primary px-1.5 py-0.5 text-[9px] font-semibold text-on-primary">{t("engagement.queue.approve")}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-1.5 text-[10px] text-muted">
        <MessageCircle className="size-3 rtl:-scale-x-100" />
        {t("engagement.stats.awaiting")}: 5
      </div>
    </div>
  );
}

function ExperimentSlide() {
  const { t } = useI18n();
  const windows = [
    ["morning", 64, "-14.5%", false],
    ["afternoon", 71, "-4.7%", false],
    ["evening", 100, "+34%", true],
  ] as const;
  return (
    <div>
      <span className="inline-flex items-center gap-1 rounded-pill bg-ig-gradient px-2 py-0.5 text-[9px] font-semibold text-white">
        <span className="size-1 rounded-pill bg-white" />
        {t("experiment.live")}
      </span>
      <p className="mt-2 text-[14px] leading-4 font-bold">{t("experiment.question")}</p>
      <div className="mt-3 space-y-2">
        {windows.map(([id, width, change, best]) => (
          <div key={id}>
            <div className="flex justify-between text-[9px]">
              <span className="font-semibold">{t(`windows.${id}`)}</span>
              <span className={cn("font-semibold", best ? "text-success" : "text-danger")} dir="ltr">
                {change}
              </span>
            </div>
            <div className="mt-0.5 h-1.5 rounded-pill bg-border">
              <div className={cn("h-full rounded-pill", best ? "bg-ig-gradient" : "bg-muted")} style={{ width: `${width}%` }} />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 rounded-[8px] bg-ig-gradient p-px">
        <div className="flex items-center gap-2 rounded-[7px] bg-background p-2">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-pill bg-ig-gradient text-white">
            <Lightbulb className="size-3" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold">{t("experiment.opportunity")}</p>
            <p className="text-[9px] text-muted">
              {t("experiment.confidence")}: 92%
            </p>
          </div>
        </div>
      </div>
      <span className="mt-2 block rounded-[6px] bg-primary py-1.5 text-center text-[10px] font-semibold text-on-primary">{t("experiment.apply")}</span>
    </div>
  );
}

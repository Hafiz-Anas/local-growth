import { engagementHeatmap, followerSeries } from "../generators";
import type { ClientDataPack } from "./types";

export const cafePack: ClientDataPack = {
  dashboard: {
    metrics: {
      reach: { value: 21380, changePct: 6.2 },
      engagementRate: { value: 5.1, changePct: -0.4 },
      followerGrowth: { value: 412, changePct: 3.8 },
      profileVisits: { value: 1840, changePct: 11.5 },
    },
    followerSeries: followerSeries(9318, 9730, "2026-10-06", 23),
    topPost: {
      id: "db_p1",
      caption: "Saffron cake + Spanish latte. The Salmiya combo ☕🧡",
      tone: "latte",
      icon: "cup",
      likes: 1320,
      comments: 88,
      reach: 8740,
      saves: 205,
      postedAt: "2026-10-01T08:10:00+03:00",
    },
    quickTiles: {
      commentsHandledToday: 19,
      repliesAwaitingApproval: 3,
      nextWindow: { window: "morning", start: "07:30", end: "09:30", liftPct: 21 },
    },
  },

  competitors: {
    updatedAt: "2026-10-06T07:00:00+03:00",
    competitors: [
      {
        id: "cmp_brew",
        handle: "brewlab.q8",
        avatarUrl: "/avatars/competitors/brewlab-q8.svg",
        name: "Brew Lab Q8",
        location: "Salmiya",
        avatarTone: "night",
        avatarInitials: "BL",
        verified: true,
        followers: 36400,
        followerChangePct: 2.4,
        engagementRate: 3.9,
        postsPerWeek: 7,
        notableNote: "Latte-art slow-mo reel crossed 120K views.",
        recentPosts: [
          { id: "bl1", tone: "latte", icon: "cup", likes: 4100, comments: 160, notable: true },
          { id: "bl2", tone: "night", icon: "coffee", likes: 900, comments: 22, notable: false },
          { id: "bl3", tone: "sand", icon: "cake", likes: 760, comments: 18, notable: false },
        ],
      },
      {
        id: "cmp_rawda",
        handle: "rawda.coffee",
        avatarUrl: "/avatars/competitors/rawda-coffee.svg",
        name: "Rawda Coffee",
        location: "Shaab",
        avatarTone: "pistachio",
        avatarInitials: "RC",
        verified: false,
        followers: 12900,
        followerChangePct: 6.1,
        engagementRate: 6.6,
        postsPerWeek: 5,
        notableNote: "\"Guess the origin\" story quiz pushed 900 replies.",
        recentPosts: [
          { id: "rc1", tone: "pistachio", icon: "coffee", likes: 1500, comments: 120, notable: true },
          { id: "rc2", tone: "latte", icon: "cup", likes: 610, comments: 15, notable: false },
          { id: "rc3", tone: "rose", icon: "cake", likes: 480, comments: 11, notable: false },
        ],
      },
    ],
    trendingAudio: [
      { id: "au1", title: "Slow Morning Hail", artist: "Dana & Co.", reelsCount: 5600, growthPct: 37 },
      { id: "au2", title: "Lo-fi Gahwa", artist: "Beit Records", reelsCount: 12800, growthPct: 54 },
      { id: "au3", title: "Khaleeji Groove 26", artist: "Studio Gulf", reelsCount: 31100, growthPct: 41 },
    ],
    trendingTags: [
      { id: "t1", tag: "#q8coffee", kind: "hashtag", postsCount: 310000, growthPct: 15 },
      { id: "t2", tag: "#specialtycoffee", kind: "hashtag", postsCount: 9800000, growthPct: 4 },
      { id: "t3", tag: "#سبانش_لاتيه", kind: "hashtag", postsCount: 72000, growthPct: 22 },
      { id: "t4", tag: "#السالمية", kind: "hashtag", postsCount: 140000, growthPct: 9 },
      { id: "t5", tag: "saffron cake", kind: "keyword", postsCount: 4200, growthPct: 38 },
    ],
  },

  generator: {
    categories: [
      { id: "espresso", label: "Espresso drinks", labelAr: "مشروبات الإسبريسو", productNames: ["Spanish Latte", "Flat White", "Pistachio Latte"], icon: "cup", tone: "latte" },
      { id: "filter", label: "Filter coffee", labelAr: "قهوة مقطرة", productNames: ["Ethiopian V60", "Colombian Cold Brew"], icon: "coffee", tone: "night" },
      { id: "desserts", label: "Desserts", labelAr: "حلويات", productNames: ["Saffron Cake", "Date Cheesecake"], icon: "cake", tone: "sand" },
    ],
    occasions: [
      { id: "new_batch", label: "New Bean Arrival", labelAr: "وصل بن جديد" },
      { id: "morning", label: "Morning Rush", labelAr: "زحمة الصبح" },
      { id: "express", label: "Express Delivery", labelAr: "توصيل سريع" },
      { id: "weekend", label: "Weekend Offer", labelAr: "عرض نهاية الأسبوع" },
    ],
    brandVocabulary: ["Baghdad St.", "slow bar", "حياكم", "specialty"],
    templates: [
      { id: "tp1", occasionId: "new_batch", language: "en", text: "New on the slow bar: {product} ☕\n{word} — tasting notes of jasmine & stone fruit.", hashtags: ["#q8coffee", "#specialtycoffee"] },
      { id: "tp2", occasionId: "morning", language: "ar", text: "صباحكم {product} ☀️☕\n{word} — جاهزين من الساعة ٧ الصبح.", hashtags: ["#q8coffee", "#السالمية"] },
      { id: "tp3", occasionId: "express", language: "en", text: "{product} delivered in 45 minutes across Salmiya 🛵\n{word}.", hashtags: ["#q8coffee", "#kuwaitdelivery"] },
      { id: "tp4", occasionId: "weekend", language: "ar", text: "ويكندكم أحلى مع {product} 🧡 خصم ٢٠٪ لين السبت!\n{word}", hashtags: ["#عروض_الكويت"] },
      { id: "tp5", occasionId: "*", language: "en", text: "Your daily {product}, made the {word} way. See you on Baghdad St. ☕", hashtags: ["#q8coffee", "#dallabean"] },
    ],
  },

  experiment: {
    daysSampled: 8,
    daysPlanned: 21,
    dailyTarget: 2,
    baselineReach: 2100,
    windows: [
      { id: "morning", startHour: 7, endHour: 10, postsSampled: 8, avgReach: 2540, vsBaselinePct: 21 },
      { id: "afternoon", startHour: 13, endHour: 16, postsSampled: 8, avgReach: 1890, vsBaselinePct: -10 },
      { id: "evening", startHour: 20, endHour: 23, postsSampled: 8, avgReach: 2230, vsBaselinePct: 6.2 },
    ],
    opportunity: { window: "morning", liftPct: 21, sampleSize: 24, confidencePct: 81 },
    heatmap: engagementHeatmap([[8, 0.6], [16, 0.25], [21, 0.35]], 5),
    queue: [
      { id: "q_db1", caption: "Ethiopian V60 is back ☕", tone: "night", icon: "coffee", scheduledFor: "2026-10-07T08:00:00+03:00", window: "morning", source: "generator" },
      { id: "q_db2", caption: "Date cheesecake drop 🧡", tone: "sand", icon: "cake", scheduledFor: "2026-10-07T21:00:00+03:00", window: "evening", source: "manual" },
    ],
  },

  engagement: {
    stats: { commentsToday: 19, dmsSent: 54 },
    rules: [
      { id: "r1", keywords: ["menu", "منيو"], reply: "Sent you the menu in a DM 📩", message: "Here's our full menu 📋 dallabean.cafe/menu", timesTriggered: 188, active: true },
      { id: "r2", keywords: ["price", "بكم"], reply: "Check your DMs for prices 💬", message: "Prices & ordering on WhatsApp 👉 wa.me/96560447788", timesTriggered: 96, active: true },
    ],
    replyQueue: [
      { id: "c1", author: "noura.sips", authorAvatarUrl: "/avatars/people/noura-sips.svg", authorInitials: "NS", authorTone: "rose", text: "Are you open on Friday mornings?", postCaption: "Saffron cake + Spanish latte", postedAt: "2026-10-06T08:02:00+03:00", likes: 2, isPriceQuestion: false, draftReply: "Yes! Fridays from 8am ☀️ See you there 🧡", draftLanguage: "en" },
      { id: "c2", author: "bader_kw", authorAvatarUrl: "/avatars/people/bader-kw.svg", authorInitials: "BK", authorTone: "night", text: "بكم السبانش لاتيه الكبير؟", postCaption: "Spanish latte season", postedAt: "2026-10-06T07:40:00+03:00", likes: 0, isPriceQuestion: true, draftReply: "هلا بدر 🧡 الكبير بـ 1.750 د.ك", draftLanguage: "ar" },
      { id: "c3", author: "lulu.alali", authorAvatarUrl: "/avatars/people/lulu-alali.svg", authorInitials: "LA", authorTone: "pistachio", text: "Best V60 in Salmiya honestly 🔥", postCaption: "Ethiopian V60 is back", postedAt: "2026-10-05T22:10:00+03:00", likes: 6, isPriceQuestion: false, draftReply: "That means a lot 🙏 Come try the new Colombian next!", draftLanguage: "en" },
    ],
    settings: { manualApproval: true, autoReply: false, priceQuestionsToWhatsapp: true },
  },

  settings: {
    tone: 55,
    defaultHashtags: ["#dallabean", "#q8coffee"],
    brandWords: ["slow bar", "Baghdad St.", "حياكم"],
    notifications: { newComments: true, approvalNeeded: true, weeklyReport: false, competitorAlerts: true, experimentResults: true, recommendationsReady: true, instagramReconnect: true, scheduledPosts: true },
  },
};

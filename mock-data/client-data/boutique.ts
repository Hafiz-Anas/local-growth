import { engagementHeatmap, followerSeries } from "../generators";
import type { ClientDataPack } from "./types";

export const boutiquePack: ClientDataPack = {
  dashboard: {
    metrics: {
      reach: { value: 9840, changePct: -3.2 },
      engagementRate: { value: 4.4, changePct: 0.6 },
      followerGrowth: { value: 138, changePct: 1.9 },
      profileVisits: { value: 760, changePct: -1.4 },
    },
    followerSeries: followerSeries(5072, 5210, "2026-10-06", 41),
    topPost: {
      id: "nb_p1",
      caption: "Our new linen abaya in sand ✨ handmade in Kuwait",
      tone: "sand",
      icon: "shirt",
      likes: 640,
      comments: 52,
      reach: 4120,
      saves: 133,
      postedAt: "2026-09-29T19:30:00+03:00",
    },
    quickTiles: {
      commentsHandledToday: 6,
      repliesAwaitingApproval: 2,
      nextWindow: { window: "evening", start: "19:00", end: "21:00", liftPct: 15 },
    },
  },

  competitors: {
    updatedAt: "2026-10-06T07:00:00+03:00",
    competitors: [
      {
        id: "cmp_lamar",
        handle: "lamar.abayas",
        avatarUrl: "/avatars/competitors/lamar-abayas.svg",
        name: "Lamar Abayas",
        location: "Kuwait City",
        avatarTone: "night",
        avatarInitials: "LA",
        verified: true,
        followers: 58200,
        followerChangePct: 1.8,
        engagementRate: 2.7,
        postsPerWeek: 8,
        notableNote: "Try-on reel with three colourways reached 95K accounts.",
        recentPosts: [
          { id: "la1", tone: "night", icon: "shirt", likes: 3200, comments: 140, notable: true },
          { id: "la2", tone: "sand", icon: "bag", likes: 1100, comments: 30, notable: false },
          { id: "la3", tone: "rose", icon: "gem", likes: 870, comments: 21, notable: false },
        ],
      },
    ],
    trendingAudio: [{ id: "au1", title: "Soft Steps", artist: "Layla Waves", reelsCount: 22100, growthPct: 61 }],
    trendingTags: [
      { id: "t1", tag: "#عبايات", kind: "hashtag", postsCount: 880000, growthPct: 8 },
      { id: "t2", tag: "#modestfashion", kind: "hashtag", postsCount: 7400000, growthPct: 3 },
      { id: "t3", tag: "linen abaya", kind: "keyword", postsCount: 5400, growthPct: 44 },
    ],
  },

  generator: {
    categories: [
      { id: "abayas", label: "Abayas", labelAr: "عبايات", productNames: ["Linen Abaya", "Embroidered Bisht Abaya"], icon: "shirt", tone: "sand" },
      { id: "occasion", label: "Occasion wear", labelAr: "فساتين مناسبات", productNames: ["Satin Kaftan", "Pearl Jalabiya"], icon: "gem", tone: "rose" },
      { id: "accessories", label: "Accessories", labelAr: "إكسسوارات", productNames: ["Silk Shayla", "Leather Clutch"], icon: "bag", tone: "berry" },
    ],
    occasions: [
      { id: "new_collection", label: "New Collection", labelAr: "تشكيلة جديدة" },
      { id: "wedding", label: "Wedding Season", labelAr: "موسم الأعراس" },
      { id: "express", label: "Express Delivery", labelAr: "توصيل سريع" },
    ],
    brandVocabulary: ["handmade", "صنع في الكويت", "elegant"],
    templates: [
      { id: "tp1", occasionId: "new_collection", language: "en", text: "Meet the {product} ✨ {word}, cut and stitched in our Sharq atelier.", hashtags: ["#modestfashion", "#noorboutique"] },
      { id: "tp2", occasionId: "wedding", language: "ar", text: "موسم الأعراس بدأ 💍 {product} — {word} ويليق فيج.", hashtags: ["#عبايات", "#أعراس_الكويت"] },
      { id: "tp3", occasionId: "express", language: "ar", text: "تبين {product} قبل المناسبة؟ نوصل خلال ٢٤ ساعة 🚚 {word}", hashtags: ["#عبايات"] },
      { id: "tp4", occasionId: "*", language: "en", text: "{product} — {word}. DM us for custom sizing 🤍", hashtags: ["#noorboutique"] },
    ],
  },

  experiment: {
    daysSampled: 3,
    daysPlanned: 21,
    dailyTarget: 1,
    baselineReach: 980,
    windows: [
      { id: "morning", startHour: 9, endHour: 12, postsSampled: 1, avgReach: 860, vsBaselinePct: -12 },
      { id: "afternoon", startHour: 14, endHour: 17, postsSampled: 1, avgReach: 940, vsBaselinePct: -4 },
      { id: "evening", startHour: 19, endHour: 22, postsSampled: 1, avgReach: 1130, vsBaselinePct: 15 },
    ],
    opportunity: { window: "evening", liftPct: 15, sampleSize: 3, confidencePct: 54 },
    heatmap: engagementHeatmap([[11, 0.25], [20, 0.55]], 3),
    queue: [],
  },

  engagement: {
    stats: { commentsToday: 6, dmsSent: 9 },
    rules: [],
    replyQueue: [
      { id: "c1", author: "maryam.styles", authorAvatarUrl: "/avatars/people/maryam-styles.svg", authorInitials: "MS", authorTone: "rose", text: "عندكم مقاس XS؟", postCaption: "Our new linen abaya in sand ✨", postedAt: "2026-10-06T09:12:00+03:00", likes: 1, isPriceQuestion: false, draftReply: "هلا مريم 🤍 إي متوفر، نقدر نفصله على مقاسج بعد", draftLanguage: "ar" },
      { id: "c2", author: "dana.kw", authorAvatarUrl: "/avatars/people/dana-kw.svg", authorInitials: "DK", authorTone: "sand", text: "How much is the pearl jalabiya?", postCaption: "Pearl jalabiya for the season", postedAt: "2026-10-05T21:30:00+03:00", likes: 3, isPriceQuestion: true, draftReply: "Hi Dana! It's 65 KD with free alterations 🤍", draftLanguage: "en" },
    ],
    settings: { manualApproval: true, autoReply: false, priceQuestionsToWhatsapp: false },
  },

  settings: {
    tone: 35,
    defaultHashtags: ["#noorboutique", "#عبايات"],
    brandWords: ["handmade", "صنع في الكويت"],
    notifications: { newComments: true, approvalNeeded: true, weeklyReport: true, competitorAlerts: false, experimentResults: false, recommendationsReady: true, instagramReconnect: true, scheduledPosts: true, postMonitoring: true },
  },
};

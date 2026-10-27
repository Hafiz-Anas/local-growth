import type { Account, AccountId } from "./types";

export const accounts: Account[] = [
  {
    id: "mathanet",
    handle: "mathanet_baity",
    name: { en: "Mathanet Baity", ar: "مذاقات بيتي" },
    category: { en: "Home-cooked food", ar: "أكل بيت" },
    bio: {
      en: "Kuwaiti home cooking, made fresh daily 🍲\nMachboos · Saloona · Lugaimat\nOrders by DM · Delivery all over Kuwait",
      ar: "طبخ كويتي بيتي، طازج كل يوم 🍲\nمجبوس · صالونة · لقيمات\nالطلبات بالخاص · توصيل لكل مناطق الكويت",
    },
    link: "wa.me/96550000000",
    avatar: "/photos/mathanet/04-t.jpg",
    followers: 12480,
    following: 312,
    posts: 418,
    connection: "connected",
    location: { en: "Kuwait City", ar: "مدينة الكويت" },
    hashtags: ["#مذاقات_بيتي", "#اكل_بيت", "#الكويت", "#KuwaitFood", "#q8food", "#مجبوس", "#HomeCooked"],
    captions: {
      base: {
        en: "Fresh from our kitchen today: {dish} 🍲 Cooked slowly, the way our mothers taught us. Order by DM before 2 PM for same-day delivery.",
        ar: "من مطبخنا اليوم: {dish} 🍲 مطبوخ على مهل، مثل ما علمتنا أمهاتنا. اطلبوا بالخاص قبل الساعة ٢ للتوصيل بنفس اليوم.",
      },
      shorter: {
        en: "{dish}, fresh today 🍲 Order by DM.",
        ar: "{dish} طازج اليوم 🍲 الطلب بالخاص.",
      },
      formal: {
        en: "Today's menu features {dish}, prepared fresh with traditional Kuwaiti recipes. Orders are accepted via direct message until 2:00 PM for same-day delivery.",
        ar: "تتضمن قائمة اليوم {dish}، المحضّر طازجاً بوصفات كويتية تقليدية. نستقبل الطلبات عبر الرسائل الخاصة حتى الساعة ٢:٠٠ ظهراً للتوصيل في نفس اليوم.",
      },
      friendly: {
        en: "Guess what's cooking? {dish}! 😍 Just like home. Send us a DM and we'll bring it to your door today 🚗",
        ar: "خمنوا شنو طابخين اليوم؟ {dish}! 😍 مثل أكل البيت بالضبط. ارسلولنا بالخاص ونوصله لين بابكم اليوم 🚗",
      },
    },
  },
  {
    id: "qahwa",
    handle: "qahwat_alfareej",
    name: { en: "Qahwat Al Fareej", ar: "قهوة الفريج" },
    category: { en: "Café", ar: "مقهى" },
    bio: {
      en: "Specialty coffee in the heart of Salmiya ☕\nOpen daily 7 AM – 1 AM\nSaffron latte · Date cake · Matcha",
      ar: "قهوة مختصة في قلب السالمية ☕\nيومياً من ٧ الصبح إلى ١ بالليل\nلاتيه زعفران · كيكة تمر · ماتشا",
    },
    link: "qahwatalfareej.com",
    avatar: "/photos/qahwa/07-t.jpg",
    followers: 8930,
    following: 540,
    posts: 266,
    connection: "connected",
    location: { en: "Salmiya, Kuwait", ar: "السالمية، الكويت" },
    hashtags: ["#قهوة_الفريج", "#قهوة_مختصة", "#السالمية", "#KuwaitCoffee", "#q8cafe", "#SpecialtyCoffee", "#لاتيه"],
    captions: {
      base: {
        en: "{dish} ☕ Made with our house blend, roasted in small batches. Come by Salmiya, we're open till 1 AM.",
        ar: "{dish} ☕ من خلطتنا الخاصة المحمّصة بكميات صغيرة. حيّاكم بالسالمية، فاتحين لين الساعة ١ بالليل.",
      },
      shorter: {
        en: "{dish} ☕ Open till 1 AM.",
        ar: "{dish} ☕ فاتحين لين ١ بالليل.",
      },
      formal: {
        en: "Introducing {dish}, prepared with our signature house blend. Visit us in Salmiya, open daily from 7:00 AM to 1:00 AM.",
        ar: "نقدّم لكم {dish}، محضّراً من خلطتنا الخاصة. يسعدنا استقبالكم في السالمية يومياً من ٧:٠٠ صباحاً حتى ١:٠٠ بعد منتصف الليل.",
      },
      friendly: {
        en: "Your sign to grab a {dish} today ☕✨ Bring a friend, we'll save you the comfy corner!",
        ar: "هذي علامة إنك لازم تاخذ {dish} اليوم ☕✨ جيب ربعك، والزاوية المريحة محجوزة لكم!",
      },
    },
  },
  {
    id: "tannour",
    handle: "tannour_bakery",
    name: { en: "Tannour Bakery", ar: "مخبز التنور" },
    category: { en: "Bakery", ar: "مخبز" },
    bio: {
      en: "Baked every morning in Jabriya 🥐\nSourdough · Croissants · Celebration cakes\nCake orders 48h ahead",
      ar: "نخبز كل صباح في الجابرية 🥐\nساوردو · كرواسون · كيك المناسبات\nطلبات الكيك قبلها بـ٤٨ ساعة",
    },
    link: "tannour.kw/order",
    avatar: "/photos/tannour/02-t.jpg",
    followers: 21350,
    following: 198,
    posts: 731,
    connection: "reconnect",
    location: { en: "Jabriya, Kuwait", ar: "الجابرية، الكويت" },
    hashtags: ["#مخبز_التنور", "#مخبوزات", "#الجابرية", "#KuwaitBakery", "#q8sweets", "#Sourdough", "#كرواسون"],
    captions: {
      base: {
        en: "Out of the oven this morning: {dish} 🥐 Baked fresh in Jabriya every day. Pre-order on our website to skip the line.",
        ar: "طالع من الفرن الصبح: {dish} 🥐 نخبزه طازج كل يوم في الجابرية. اطلبوا مسبقاً من موقعنا وخلّصوا بدون انتظار.",
      },
      shorter: {
        en: "{dish}, fresh this morning 🥐",
        ar: "{dish} طازج من الصبح 🥐",
      },
      formal: {
        en: "Freshly baked this morning: {dish}. Available daily at our Jabriya branch. Pre-orders can be placed through our website.",
        ar: "مخبوز طازجاً هذا الصباح: {dish}. متوفر يومياً في فرعنا بالجابرية، ويمكن الطلب المسبق عبر موقعنا الإلكتروني.",
      },
      friendly: {
        en: "Warm, flaky and waiting for you 😋 {dish} just came out of the oven! Who's coming by?",
        ar: "دافي وهش ويستناكم 😋 {dish} توه طالع من الفرن! منو بيمرّنا اليوم؟",
      },
    },
  },
];

export const accountById = (id: string) => accounts.find((a) => a.id === id);

/**
 * Photo files (1-based) kept out of the gallery. They appear as the mock "camera roll"
 * in the upload picker, so uploading visibly adds new photos.
 */
export const cameraRollFiles: Record<AccountId, number[]> = {
  mathanet: [41, 42, 43, 44, 45, 46],
  qahwa: [41, 42, 43, 44, 45, 46],
  tannour: [14, 22, 35, 37, 38, 40, 41, 42],
};

// Category albums and the name + category of every mock photo, checked against what each photo shows.
// The AI uses these to write posts about the right item, with that category's own captions and hashtags.
import type { Account, AccountId, CaptionTone, L, Photo } from "./types";

export interface Category {
  id: string;
  name: L;
  emoji: string;
  /** Category hashtags, added after the account's own brand tag. */
  tags: string[];
  /** Caption templates for this category. `{dish}` is the photo's name. */
  captions: Record<CaptionTone, L>;
}

export interface Dish extends L {
  /** Category id (see `categories`). */
  c: string;
}

export const categories: Record<AccountId, Category[]> = {
  mathanet: [
    {
      id: "main",
      name: { en: "Main dishes", ar: "الأطباق الرئيسية" },
      emoji: "🍲",
      tags: ["#اكل_بيت", "#KuwaitFood", "#مجبوس", "#HomeCooked"],
      captions: {
        base: {
          en: "Fresh from our kitchen today: {dish} 🍲 Cooked slowly, the way our mothers taught us. Order by DM before 2 PM for same-day delivery.",
          ar: "من مطبخنا اليوم: {dish} 🍲 مطبوخ على مهل، مثل ما علمتنا أمهاتنا. اطلبوا بالخاص قبل الساعة ٢ للتوصيل بنفس اليوم.",
        },
        shorter: { en: "{dish}, fresh today 🍲 Order by DM.", ar: "{dish} طازج اليوم 🍲 الطلب بالخاص." },
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
      id: "appetizers",
      name: { en: "Appetizers", ar: "المقبلات" },
      emoji: "🥙",
      tags: ["#مقبلات", "#Mezze", "#حمص", "#q8food"],
      captions: {
        base: {
          en: "Start the table right: {dish} 🥙 Made fresh this morning, with warm bread on the side. Order by DM for today.",
          ar: "ابدأوا السفرة صح: {dish} 🥙 محضّر طازج الصبح، ويجيكم معه خبز حار. اطلبوا بالخاص لليوم.",
        },
        shorter: { en: "{dish}, made fresh today 🥙 Order by DM.", ar: "{dish} طازج اليوم 🥙 الطلب بالخاص." },
        formal: {
          en: "Our appetizers today include {dish}, freshly prepared and served with warm bread. Orders are accepted via direct message.",
          ar: "تشمل مقبلاتنا اليوم {dish}، محضّراً طازجاً ويُقدّم مع الخبز الحار. نستقبل الطلبات عبر الرسائل الخاصة.",
        },
        friendly: {
          en: "Nobody skips the starters 😋 {dish}, ready for your table today. DM us and it's on its way 🚗",
          ar: "محد يفوّت المقبلات 😋 {dish} جاهز لسفرتكم اليوم. ارسلولنا بالخاص ويوصلكم 🚗",
        },
      },
    },
    {
      id: "sweets",
      name: { en: "Sweets", ar: "الحلويات" },
      emoji: "🍯",
      tags: ["#حلويات", "#KuwaitSweets", "#حلا_بيتي", "#ArabicSweets"],
      captions: {
        base: {
          en: "Something sweet from our kitchen: {dish} 🍯 Made by hand in small batches, perfect with tea. Order by DM, boxes for gatherings too.",
          ar: "شي حلو من مطبخنا: {dish} 🍯 مسوّى باليد بكميات صغيرة، يحلى مع الشاي. اطلبوا بالخاص، وعندنا بوكسات للعزايم.",
        },
        shorter: { en: "{dish}, fresh and sweet today 🍯", ar: "{dish} طازج وحلو اليوم 🍯" },
        formal: {
          en: "Freshly made today: {dish}, prepared by hand with traditional recipes. Gift boxes are available to order via direct message.",
          ar: "محضّر اليوم: {dish}، مصنوع يدوياً بوصفات تقليدية. تتوفر بوكسات الهدايا للطلب عبر الرسائل الخاصة.",
        },
        friendly: {
          en: "Tea's ready, so is the {dish} 😍🍯 Treat yourself (or the whole family). DM us to order!",
          ar: "الشاي جاهز، و{dish} بعد 😍🍯 دلّعوا نفسكم (أو العائلة كلها). ارسلولنا بالخاص!",
        },
      },
    },
    {
      id: "spreads",
      name: { en: "Family spreads", ar: "السفرات العائلية" },
      emoji: "🍽️",
      tags: ["#عزايم", "#سفرة", "#FamilyFeast", "#KuwaitFood"],
      captions: {
        base: {
          en: "Hosting this weekend? {dish} 🍽️ Everything on one table, cooked fresh for your guests. Book your order by DM a day ahead.",
          ar: "عندكم عزيمة هالويكند؟ {dish} 🍽️ كل شي على سفرة وحدة، مطبوخ طازج لضيوفكم. احجزوا طلبكم بالخاص قبلها بيوم.",
        },
        shorter: { en: "{dish} for your gathering 🍽️ Book by DM.", ar: "{dish} لعزيمتكم 🍽️ الحجز بالخاص." },
        formal: {
          en: "We cater family gatherings with {dish}, freshly prepared on the day. Please place orders via direct message at least one day in advance.",
          ar: "نجهّز العزايم العائلية مع {dish}، محضّرة طازجة في نفس اليوم. يرجى الطلب عبر الرسائل الخاصة قبل يوم على الأقل.",
        },
        friendly: {
          en: "The whole family around one table 🥰 {dish}, ready when you are. DM us and leave the cooking to us!",
          ar: "العائلة كلها على سفرة وحدة 🥰 {dish} جاهزة لكم. ارسلولنا بالخاص وخلّوا الطبخ علينا!",
        },
      },
    },
  ],
  qahwa: [
    {
      id: "hot",
      name: { en: "Hot coffee", ar: "القهوة الحارة" },
      emoji: "☕",
      tags: ["#قهوة_مختصة", "#SpecialtyCoffee", "#لاتيه", "#q8cafe"],
      captions: {
        base: {
          en: "{dish} ☕ Made with our house blend, roasted in small batches. Come by Salmiya, we're open till 1 AM.",
          ar: "{dish} ☕ من خلطتنا الخاصة المحمّصة بكميات صغيرة. حيّاكم بالسالمية، فاتحين لين الساعة ١ بالليل.",
        },
        shorter: { en: "{dish} ☕ Open till 1 AM.", ar: "{dish} ☕ فاتحين لين ١ بالليل." },
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
      id: "iced",
      name: { en: "Iced coffee", ar: "القهوة المثلجة" },
      emoji: "🧊",
      tags: ["#آيس_لاتيه", "#IcedCoffee", "#كولد_برو", "#q8cafe"],
      captions: {
        base: {
          en: "{dish} 🧊 Poured over fresh ice with our house espresso. The best way to beat the Kuwait heat, in Salmiya till 1 AM.",
          ar: "{dish} 🧊 على ثلج طازج مع إسبريسو خلطتنا. أحلى طريقة تتغلبون فيها على حر الكويت، بالسالمية لين ١ بالليل.",
        },
        shorter: { en: "{dish} 🧊 Ice cold, all day.", ar: "{dish} 🧊 بارد طول اليوم." },
        formal: {
          en: "Cool down with {dish}, prepared with our signature espresso over fresh ice. Available daily in Salmiya until 1:00 AM.",
          ar: "انتعشوا مع {dish}، محضّراً من الإسبريسو الخاص بنا على الثلج. متوفر يومياً في السالمية حتى ١:٠٠ بعد منتصف الليل.",
        },
        friendly: {
          en: "Too hot outside? {dish} is calling 🧊😎 Grab one on your way, it's on us to make it perfect!",
          ar: "الجو حر؟ {dish} يناديك 🧊😎 مرّوا وخذوا واحد بطريقكم!",
        },
      },
    },
    {
      id: "matcha",
      name: { en: "Matcha", ar: "الماتشا" },
      emoji: "🍵",
      tags: ["#ماتشا", "#Matcha", "#MatchaLatte", "#q8cafe"],
      captions: {
        base: {
          en: "{dish} 🍵 Ceremonial-grade matcha, whisked to order. Hot or iced, every day in Salmiya.",
          ar: "{dish} 🍵 ماتشا درجة أولى، تنخفق عند الطلب. حار أو بارد، كل يوم بالسالمية.",
        },
        shorter: { en: "{dish} 🍵 Whisked to order.", ar: "{dish} 🍵 تنخفق عند الطلب." },
        formal: {
          en: "We serve {dish} with ceremonial-grade matcha, prepared fresh for every order. Available hot or iced in Salmiya.",
          ar: "نقدّم {dish} بماتشا من الدرجة الأولى، محضّرة طازجة لكل طلب. متوفرة حارة أو باردة في السالمية.",
        },
        friendly: {
          en: "Green, creamy and so smooth 💚 {dish} is the treat you deserve today. See you soon!",
          ar: "أخضر وكريمي وناعم 💚 {dish} هو الدلع اللي تستاهله اليوم. نشوفكم!",
        },
      },
    },
    {
      id: "desserts",
      name: { en: "Desserts", ar: "الحلويات" },
      emoji: "🍰",
      tags: ["#حلويات", "#KuwaitDesserts", "#كيك", "#q8cafe"],
      captions: {
        base: {
          en: "{dish} 🍰 Baked in-house every morning, and even better next to your coffee. Come by Salmiya, open till 1 AM.",
          ar: "{dish} 🍰 ينخبز عندنا كل صبح، ويحلى أكثر مع قهوتك. حيّاكم بالسالمية، فاتحين لين ١ بالليل.",
        },
        shorter: { en: "{dish} 🍰 Fresh today.", ar: "{dish} 🍰 طازج اليوم." },
        formal: {
          en: "Our dessert selection includes {dish}, baked fresh in-house each morning. Best enjoyed with your favourite coffee.",
          ar: "تشمل حلوياتنا {dish}، المخبوز طازجاً في مقهانا كل صباح. ألذ مع قهوتكم المفضلة.",
        },
        friendly: {
          en: "Coffee needs a partner 😍 Our {dish} is waiting for you. Save room for a slice!",
          ar: "القهوة تبي رفيق 😍 {dish} ينتظركم. خلّوا مكان لقطعة!",
        },
      },
    },
    {
      id: "cafe",
      name: { en: "Our café", ar: "مقهانا" },
      emoji: "🪴",
      tags: ["#السالمية", "#KuwaitCafe", "#CafeVibes", "#q8cafe"],
      captions: {
        base: {
          en: "{dish} 🪴 Your quiet spot in Salmiya, from morning coffee to late-night catch-ups. Open daily till 1 AM.",
          ar: "{dish} 🪴 مكانك الهادي بالسالمية، من قهوة الصبح لسوالف آخر الليل. فاتحين يومياً لين ١ بالليل.",
        },
        shorter: { en: "{dish} 🪴 See you in Salmiya.", ar: "{dish} 🪴 نشوفكم بالسالمية." },
        formal: {
          en: "{dish}: we welcome you in Salmiya every day from 7:00 AM to 1:00 AM, for work, meetings or a relaxed coffee.",
          ar: "{dish}: نرحب بكم في السالمية يومياً من ٧:٠٠ صباحاً حتى ١:٠٠ بعد منتصف الليل، للعمل أو الاجتماعات أو قهوة هادئة.",
        },
        friendly: {
          en: "Find your corner ✨ {dish}, the coffee's on and the music's just right. Come say hi!",
          ar: "لقيت زاويتك؟ ✨ {dish}، القهوة جاهزة والجو حلو. تعالوا سلّموا علينا!",
        },
      },
    },
  ],
  tannour: [
    {
      id: "bread",
      name: { en: "Bread", ar: "الخبز" },
      emoji: "🍞",
      tags: ["#مخبوزات", "#Sourdough", "#خبز", "#KuwaitBakery"],
      captions: {
        base: {
          en: "Out of the oven this morning: {dish} 🍞 Slow-fermented and baked fresh in Jabriya every day. Pre-order on our website to skip the line.",
          ar: "طالع من الفرن الصبح: {dish} 🍞 تخمير بطيء ونخبزه طازج كل يوم في الجابرية. اطلبوا مسبقاً من موقعنا وخلّصوا بدون انتظار.",
        },
        shorter: { en: "{dish}, fresh this morning 🍞", ar: "{dish} طازج من الصبح 🍞" },
        formal: {
          en: "Freshly baked this morning: {dish}, slow-fermented for a deeper flavour. Available daily in Jabriya and by pre-order online.",
          ar: "مخبوز طازجاً هذا الصباح: {dish}، بتخمير بطيء لنكهة أعمق. متوفر يومياً في الجابرية وبالطلب المسبق عبر الموقع.",
        },
        friendly: {
          en: "That crackle when you slice it 😍 {dish}, still warm. Grab yours before it's gone!",
          ar: "صوت القرمشة لما تقطعونه 😍 {dish} للحين حار. الحقوا عليه قبل لا يخلص!",
        },
      },
    },
    {
      id: "pastries",
      name: { en: "Pastries", ar: "المعجنات" },
      emoji: "🥐",
      tags: ["#كرواسون", "#Croissant", "#معجنات", "#KuwaitBakery"],
      captions: {
        base: {
          en: "Out of the oven this morning: {dish} 🥐 Baked fresh in Jabriya every day. Pre-order on our website to skip the line.",
          ar: "طالع من الفرن الصبح: {dish} 🥐 نخبزه طازج كل يوم في الجابرية. اطلبوا مسبقاً من موقعنا وخلّصوا بدون انتظار.",
        },
        shorter: { en: "{dish}, fresh this morning 🥐", ar: "{dish} طازج من الصبح 🥐" },
        formal: {
          en: "Freshly baked this morning: {dish}. Available daily at our Jabriya branch. Pre-orders can be placed through our website.",
          ar: "مخبوز طازجاً هذا الصباح: {dish}. متوفر يومياً في فرعنا بالجابرية، ويمكن الطلب المسبق عبر موقعنا الإلكتروني.",
        },
        friendly: {
          en: "Warm, flaky and buttery 🥐 {dish} just came out of the oven. Come early, they go fast!",
          ar: "حار ومقرمش وبالزبدة 🥐 {dish} توه طالع من الفرن. تعالوا بدري، يخلص بسرعة!",
        },
      },
    },
    {
      id: "cakes",
      name: { en: "Cakes", ar: "الكيك" },
      emoji: "🎂",
      tags: ["#كيك", "#CelebrationCake", "#كيك_مناسبات", "#q8sweets"],
      captions: {
        base: {
          en: "{dish} 🎂 Made to order for birthdays and every celebration in between. Order 48 hours ahead on our website.",
          ar: "{dish} 🎂 نسويها حسب الطلب لأعياد الميلاد وكل المناسبات. اطلبوا قبلها بـ٤٨ ساعة من موقعنا.",
        },
        shorter: { en: "{dish} 🎂 Order 48h ahead.", ar: "{dish} 🎂 الطلب قبلها بـ٤٨ ساعة." },
        formal: {
          en: "Our celebration cakes include {dish}, made to order with fresh ingredients. Please place orders 48 hours in advance through our website.",
          ar: "تشمل كيكات المناسبات لدينا {dish}، تُحضّر حسب الطلب بمكونات طازجة. يرجى الطلب قبل ٤٨ ساعة عبر موقعنا.",
        },
        friendly: {
          en: "Got something to celebrate? 🎉 {dish} makes every moment sweeter. Order yours on our website!",
          ar: "عندكم مناسبة؟ 🎉 {dish} تحلّي كل لحظة. اطلبوها من موقعنا!",
        },
      },
    },
    {
      id: "treats",
      name: { en: "Cookies & treats", ar: "الكوكيز والحلويات" },
      emoji: "🍪",
      tags: ["#كوكيز", "#Cookies", "#حلويات", "#q8sweets"],
      captions: {
        base: {
          en: "{dish} 🍪 Baked fresh this morning in Jabriya, perfect for sharing (or not). Mix and match a box of 12 on our website.",
          ar: "{dish} 🍪 انخبزت الصبح في الجابرية، للمشاركة (أو لا 😄). اختاروا بوكس ١٢ حبة من موقعنا.",
        },
        shorter: { en: "{dish}, fresh today 🍪", ar: "{dish} طازجة اليوم 🍪" },
        formal: {
          en: "Freshly baked today: {dish}. Available individually or in boxes of 12 at our Jabriya branch and online.",
          ar: "مخبوزة اليوم: {dish}. متوفرة بالحبة أو في بوكسات من ١٢ حبة في فرعنا بالجابرية وعبر الموقع.",
        },
        friendly: {
          en: "Warm {dish} straight from the tray 😍🍪 Your afternoon coffee needs these. Come grab a box!",
          ar: "{dish} حارة من الصينية 😍🍪 قهوة العصر تبيها. تعالوا خذوا بوكس!",
        },
      },
    },
  ],
};

const d = (en: string, ar: string, c: string): Dish => ({ en, ar, c });

/** Name and category of every photo file, in file order (01, 02, …). */
export const dishes: Record<AccountId, Dish[]> = {
  mathanet: [
    d("Mixed grill", "مشاوي مشكلة", "main"),
    d("Family breakfast spread", "سفرة فطور عائلية", "spreads"),
    d("Hummus with tahini", "حمص بالطحينة", "appetizers"),
    d("Chicken machboos", "مجبوس دجاج", "main"),
    d("Lamb saloona with saffron rice", "صالونة لحم مع عيش زعفران", "main"),
    d("Weekend spread", "سفرة الويكند", "spreads"),
    d("Lunch spread", "سفرة الغداء", "spreads"),
    d("Pistachio kunafa", "كنافة بالفستق", "sweets"),
    d("Lamb saloona", "صالونة لحم", "main"),
    d("Hummus and fresh bread", "حمص وخبز طازج", "appetizers"),
    d("Beef stew with yellow rice", "مرق لحم مع عيش أصفر", "main"),
    d("Kebab with rice", "كباب مع عيش", "main"),
    d("Mezze table", "سفرة مقبلات", "spreads"),
    d("Lamb stew", "مرق لحم", "main"),
    d("Gathering platter", "صينية العزيمة", "spreads"),
    d("Mutabbal and dips", "متبل ومقبلات", "appetizers"),
    d("Family feast", "عزيمة عائلية", "spreads"),
    d("Starters", "مقبلات", "appetizers"),
    d("Grill platter", "صينية مشاوي", "main"),
    d("Roast chicken with rice", "دجاج مشوي مع عيش", "main"),
    d("Pistachio baklava", "بقلاوة بالفستق", "sweets"),
    d("Kebab skewers", "أسياخ كباب", "main"),
    d("Lentil soup", "شوربة عدس", "appetizers"),
    d("Grilled chicken", "دجاج مشوي", "main"),
    d("Wings and starters", "أجنحة ومقبلات", "appetizers"),
    d("Chicken biryani", "برياني دجاج", "main"),
    d("Chicken machboos", "مجبوس دجاج", "main"),
    d("Lamb biryani", "برياني لحم", "main"),
    d("Rice with lamb", "عيش ولحم", "main"),
    d("Mandi platter", "صينية مندي", "main"),
    d("Kabsa", "كبسة", "main"),
    d("Lugaimat", "لقيمات", "sweets"),
    d("Baklava box", "علبة بقلاوة", "sweets"),
    d("Basbousa with tea", "بسبوسة مع الشاي", "sweets"),
    d("Ma'amoul with tea", "معمول مع الشاي", "sweets"),
    d("Fattoush and salads", "فتوش وسلطات", "appetizers"),
    d("Kofta meatballs", "كفتة", "main"),
    d("Chicken with vegetables", "دجاج بالخضار", "main"),
    d("Falafel", "فلافل", "appetizers"),
    d("Kibbeh", "كبة", "appetizers"),
    d("Falafel breakfast", "فطور فلافل", "appetizers"),
    d("Kofta with rice", "كفتة مع عيش", "main"),
    d("Dates", "تمر", "sweets"),
    d("Khalas dates", "تمر خلاص", "sweets"),
    d("Rice with stew", "عيش ومرق", "main"),
    d("Grilled fish with rice", "سمك مشوي مع عيش", "main"),
  ],
  qahwa: [
    d("Flat white", "فلات وايت", "hot"),
    d("Lattes for the table", "لاتيه للطاولة", "hot"),
    d("Cappuccino", "كابتشينو", "hot"),
    d("Latte", "لاتيه", "hot"),
    d("Spanish latte", "سبانش لاتيه", "hot"),
    d("Latte art", "رسم اللاتيه", "hot"),
    d("Café latte", "كافيه لاتيه", "hot"),
    d("Cappuccino", "كابتشينو", "hot"),
    d("Morning latte", "لاتيه الصباح", "hot"),
    d("Flat white", "فلات وايت", "hot"),
    d("Fresh grind", "طحنة طازجة", "hot"),
    d("Saffron latte", "لاتيه بالزعفران", "hot"),
    d("Iced latte", "آيس لاتيه", "iced"),
    d("Cortado", "كورتادو", "hot"),
    d("Iced Spanish latte", "آيس سبانش لاتيه", "iced"),
    d("Iced latte", "آيس لاتيه", "iced"),
    d("Cold brew with milk", "كولد برو بالحليب", "iced"),
    d("Iced mocha", "آيس موكا", "iced"),
    d("Iced caramel latte", "آيس كراميل لاتيه", "iced"),
    d("Cold brew", "كولد برو", "iced"),
    d("Our café", "مقهانا", "cafe"),
    d("Coffee bar", "بار القهوة", "cafe"),
    d("Barista corner", "ركن الباريستا", "cafe"),
    d("Dessert counter", "واجهة الحلويات", "cafe"),
    d("Café corner", "زاوية المقهى", "cafe"),
    d("Coffee and cheesecake", "قهوة وتشيز كيك", "desserts"),
    d("Lattes for two", "لاتيه لشخصين", "hot"),
    d("Coffee and cake", "قهوة وكيكة", "desserts"),
    d("Vanilla cake", "كيكة الفانيلا", "desserts"),
    d("Cheesecake", "تشيز كيك", "desserts"),
    d("Lemon loaf", "كيكة الليمون", "desserts"),
    d("Date cake", "كيكة التمر", "desserts"),
    d("Tiramisu", "تيراميسو", "desserts"),
    d("Honey cake", "كيكة العسل", "desserts"),
    d("Berry cheesecake", "تشيز كيك التوت", "desserts"),
    d("Caramel cake", "كيكة الكراميل", "desserts"),
    d("Iced matcha", "آيس ماتشا", "matcha"),
    d("Iced matcha latte", "آيس ماتشا لاتيه", "matcha"),
    d("Matcha", "ماتشا", "matcha"),
    d("Matcha cloud", "ماتشا كلاود", "matcha"),
    d("Latte", "لاتيه", "hot"),
    d("Espresso", "إسبريسو", "hot"),
    d("Espresso shot", "شوت إسبريسو", "hot"),
    d("Espresso bar", "بار الإسبريسو", "hot"),
    d("Cappuccino", "كابتشينو", "hot"),
    d("Morning coffee", "قهوة الصباح", "hot"),
  ],
  tannour: [
    d("Morning pastry shelf", "رف معجنات الصباح", "pastries"),
    d("Croissants", "كرواسون", "pastries"),
    d("Home-style bread", "خبز بيتي", "bread"),
    d("Cake display", "واجهة الكيك", "cakes"),
    d("Cupcakes", "كب كيك", "treats"),
    d("Butter croissants", "كرواسون بالزبدة", "pastries"),
    d("Pastry counter", "واجهة المعجنات", "pastries"),
    d("Pain au chocolat", "كرواسون بالشوكولاتة", "pastries"),
    d("Baguettes", "باغيت", "bread"),
    d("Strawberry drip cake", "كيكة الفراولة", "cakes"),
    d("Seeded loaves", "خبز بالحبوب", "bread"),
    d("Chocolate croissants", "كرواسون شوكولاتة", "pastries"),
    d("Rye bread", "خبز الجاودار", "bread"),
    d("Croissant", "كرواسون", "pastries"),
    d("Classic croissant", "كرواسون كلاسيك", "pastries"),
    d("Sugar croissants", "كرواسون بالسكر", "pastries"),
    d("Mini croissants", "ميني كرواسون", "pastries"),
    d("Morning croissants", "كرواسون الصباح", "pastries"),
    d("Croissant with strawberries", "كرواسون بالفراولة", "pastries"),
    d("Coffee and croissants", "قهوة وكرواسون", "pastries"),
    d("Bakery window", "واجهة المخبز", "pastries"),
    d("Croissants", "كرواسون", "pastries"),
    d("Chocolate drip cake", "كيكة الشوكولاتة", "cakes"),
    d("Black forest cake", "كيكة بلاك فورست", "cakes"),
    d("Chocolate mousse cake", "كيكة موس الشوكولاتة", "cakes"),
    d("Birthday cake", "كيكة عيد ميلاد", "cakes"),
    d("Layer cake", "كيكة طبقات", "cakes"),
    d("Macaron cake", "كيكة الماكرون", "cakes"),
    d("Fruit tartlets", "تارت الفواكه", "treats"),
    d("Cupcakes", "كب كيك", "treats"),
    d("Strawberry cake", "كيكة الفراولة", "cakes"),
    d("Blueberry cake", "كيكة البلوبيري", "cakes"),
    d("Sourdough", "خبز الساوردو", "bread"),
    d("Sourdough loaf", "رغيف ساوردو", "bread"),
    d("Sliced baguette", "باغيت مقطع", "bread"),
    d("Sliced sourdough", "ساوردو مقطع", "bread"),
    d("Artisan loaves", "خبز حرفي", "bread"),
    d("Country bread", "خبز ريفي", "bread"),
    d("Fresh loaves", "أرغفة طازجة", "bread"),
    d("Loaf", "رغيف", "bread"),
    d("Artisan bread", "خبز حرفي", "bread"),
    d("Herb bread", "خبز بالأعشاب", "bread"),
    d("Bread basket", "سلة خبز", "bread"),
    d("Cookies", "كوكيز", "treats"),
    d("Chocolate chip cookies", "كوكيز بالشوكولاتة", "treats"),
    d("Chocolate chip cookies", "كوكيز بالشوكولاتة", "treats"),
    d("Cookie stack", "كومة كوكيز", "treats"),
    d("Double chocolate cookies", "كوكيز دبل شوكولاتة", "treats"),
  ],
};

export const categoriesFor = (accountId: string) => categories[accountId as AccountId] ?? [];
export const findCategory = (accountId: string, id: string | undefined) => (id ? categoriesFor(accountId).find((c) => c.id === id) : undefined);
/** Category albums use the category id with a prefix, so they can sit next to albums the user makes. */
export const categoryAlbumId = (id: string) => `cat-${id}`;

/** A caption in the photo's category voice, falling back to the account's general templates. */
export function captionFor(account: Pick<Account, "id" | "captions">, photo: Pick<Photo, "dish" | "category">, tone: CaptionTone): L {
  const t = findCategory(account.id, photo.category)?.captions[tone] ?? account.captions[tone];
  return { en: t.en.replaceAll("{dish}", photo.dish.en), ar: t.ar.replaceAll("{dish}", photo.dish.ar) };
}

/** The account's brand tag plus the category's tags. */
export function hashtagsFor(account: Pick<Account, "id" | "hashtags">, category: string | undefined) {
  const cat = findCategory(account.id, category);
  return cat ? [account.hashtags[0], ...cat.tags] : account.hashtags.slice(0, 5);
}

/** Splits a posted caption back into its text and the trailing hashtags. */
export function splitCaption(caption: L): { text: L; tags: string[] } {
  const part = (s: string) => {
    const lines = s.trimEnd().split("\n");
    const last = lines[lines.length - 1] ?? "";
    const isTags = last.trim().length > 0 && last.trim().split(/\s+/).every((w) => w.startsWith("#"));
    return isTags ? { text: lines.slice(0, -1).join("\n").trimEnd(), tags: last.trim().split(/\s+/) } : { text: s, tags: [] as string[] };
  };
  const en = part(caption.en);
  const ar = part(caption.ar);
  return { text: { en: en.text, ar: ar.text }, tags: en.tags.length ? en.tags : ar.tags };
}

/** Caption text with its hashtags, the way it's posted. */
export const withTags = (caption: L, tags: string[]): L => ({
  en: `${caption.en}\n\n${tags.join(" ")}`.trim(),
  ar: `${caption.ar}\n\n${tags.join(" ")}`.trim(),
});

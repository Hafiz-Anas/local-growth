/**
 * Kuwait's six governorates and their residential, commercial and industrial areas, in English and
 * Arabic, for onboarding's "Your location" step and Settings. Keys are stored on the Business
 * (`governorate`, `area`), so never rename one — add new areas at the end of their governorate.
 * Pure data, shared by server and client.
 */

export interface KuwaitArea {
  key: string;
  en: string;
  ar: string;
}

export interface KuwaitGovernorate extends KuwaitArea {
  areas: KuwaitArea[];
}

const a = (key: string, en: string, ar: string): KuwaitArea => ({ key, en, ar });

export const KUWAIT_GOVERNORATES: KuwaitGovernorate[] = [
  {
    key: "capital",
    en: "Capital",
    ar: "العاصمة",
    areas: [
      a("kuwait_city", "Kuwait City", "مدينة الكويت"),
      a("sharq", "Sharq", "شرق"),
      a("mirqab", "Mirqab", "المرقاب"),
      a("qibla", "Qibla", "القبلة"),
      a("dasman", "Dasman", "دسمان"),
      a("salhiya", "Salhiya", "الصالحية"),
      a("bneid_al_gar", "Bneid Al-Gar", "بنيد القار"),
      a("dasma", "Dasma", "الدسمة"),
      a("daiya", "Daiya", "الدعية"),
      a("mansouriya", "Mansouriya", "المنصورية"),
      a("abdullah_al_salem", "Abdullah Al-Salem", "ضاحية عبدالله السالم"),
      a("nuzha", "Nuzha", "النزهة"),
      a("faiha", "Faiha", "الفيحاء"),
      a("shamiya", "Shamiya", "الشامية"),
      a("rawda", "Rawda", "الروضة"),
      a("adailiya", "Adailiya", "العديلية"),
      a("khaldiya", "Khaldiya", "الخالدية"),
      a("qadsiya", "Qadsiya", "القادسية"),
      a("qurtuba", "Qurtuba", "قرطبة"),
      a("surra", "Surra", "السرة"),
      a("yarmouk", "Yarmouk", "اليرموك"),
      a("kaifan", "Kaifan", "كيفان"),
      a("shuwaikh", "Shuwaikh", "الشويخ"),
      a("shuwaikh_industrial", "Shuwaikh Industrial", "الشويخ الصناعية"),
      a("shuwaikh_port", "Shuwaikh Port", "ميناء الشويخ"),
      a("granada", "Granada", "غرناطة"),
      a("sulaibikhat", "Sulaibikhat", "الصليبيخات"),
      a("doha", "Doha", "الدوحة"),
      a("nahdha", "Nahdha", "النهضة"),
      a("qairawan", "Qairawan", "القيروان"),
      a("north_west_sulaibikhat", "North West Sulaibikhat", "شمال غرب الصليبيخات"),
      a("failaka", "Failaka Island", "جزيرة فيلكا"),
    ],
  },
  {
    key: "hawalli",
    en: "Hawalli",
    ar: "حولي",
    areas: [
      a("hawalli", "Hawalli", "حولي"),
      a("salmiya", "Salmiya", "السالمية"),
      a("jabriya", "Jabriya", "الجابرية"),
      a("rumaithiya", "Rumaithiya", "الرميثية"),
      a("salwa", "Salwa", "سلوى"),
      a("bayan", "Bayan", "بيان"),
      a("mishref", "Mishref", "مشرف"),
      a("mubarak_al_abdullah", "Mubarak Al-Abdullah (West Mishref)", "مبارك العبدالله (غرب مشرف)"),
      a("shaab", "Shaab", "الشعب"),
      a("shuhada", "Shuhada", "الشهداء"),
      a("hitteen", "Hitteen", "حطين"),
      a("salam", "Salam", "السلام"),
      a("siddiq", "Siddiq", "الصديق"),
      a("zahra", "Zahra", "الزهراء"),
      a("bidaa", "Bidaa", "البدع"),
      a("maidan_hawalli", "Maidan Hawalli", "ميدان حولي"),
      a("anjafa", "Anjafa", "أنجفة"),
    ],
  },
  {
    key: "farwaniya",
    en: "Farwaniya",
    ar: "الفروانية",
    areas: [
      a("farwaniya", "Farwaniya", "الفروانية"),
      a("khaitan", "Khaitan", "خيطان"),
      a("jleeb_al_shuyoukh", "Jleeb Al-Shuyoukh", "جليب الشيوخ"),
      a("abbasiya", "Abbasiya", "العباسية"),
      a("andalous", "Andalous", "الأندلس"),
      a("ardiya", "Ardiya", "العارضية"),
      a("ardiya_industrial", "Ardiya Industrial", "العارضية الصناعية"),
      a("ishbiliya", "Ishbiliya", "إشبيلية"),
      a("rehab", "Rehab", "الرحاب"),
      a("omariya", "Omariya", "العمرية"),
      a("rabiya", "Rabiya", "الرابية"),
      a("riggae", "Riggae", "الرقعي"),
      a("firdous", "Firdous", "الفردوس"),
      a("sabah_al_nasser", "Sabah Al-Nasser", "صباح الناصر"),
      a("abdullah_al_mubarak", "Abdullah Al-Mubarak", "عبدالله المبارك"),
      a("west_abdullah_al_mubarak", "West Abdullah Al-Mubarak", "غرب عبدالله المبارك"),
      a("dhajeej", "Dhajeej", "الضجيج"),
      a("rai", "Rai", "الري"),
      a("airport", "Airport Area", "منطقة المطار"),
      a("south_khaitan", "South Khaitan", "جنوب خيطان"),
    ],
  },
  {
    key: "mubarak_al_kabeer",
    en: "Mubarak Al-Kabeer",
    ar: "مبارك الكبير",
    areas: [
      a("mubarak_al_kabeer", "Mubarak Al-Kabeer", "مبارك الكبير"),
      a("qurain", "Qurain", "القرين"),
      a("qusour", "Qusour", "القصور"),
      a("adan", "Adan", "العدان"),
      a("messila", "Messila", "المسيلة"),
      a("abu_fatira", "Abu Fatira", "أبو فطيرة"),
      a("abu_al_hasaniya", "Abu Al-Hasaniya", "أبو الحصانية"),
      a("funaitees", "Funaitees", "الفنيطيس"),
      a("sabah_al_salem", "Sabah Al-Salem", "صباح السالم"),
      a("masayel", "Masayel", "المسايل"),
      a("west_abu_fatira", "West Abu Fatira (Small Crafts)", "غرب أبو فطيرة (الحرفية)"),
    ],
  },
  {
    key: "ahmadi",
    en: "Ahmadi",
    ar: "الأحمدي",
    areas: [
      a("ahmadi", "Ahmadi", "الأحمدي"),
      a("fahaheel", "Fahaheel", "الفحيحيل"),
      a("mangaf", "Mangaf", "المنقف"),
      a("abu_halifa", "Abu Halifa", "أبو حليفة"),
      a("fintas", "Fintas", "الفنطاس"),
      a("mahboula", "Mahboula", "المهبولة"),
      a("egaila", "Egaila", "العقيلة"),
      a("riqqa", "Riqqa", "الرقة"),
      a("hadiya", "Hadiya", "هدية"),
      a("sabahiya", "Sabahiya", "الصباحية"),
      a("dhaher", "Dhaher", "الظهر"),
      a("fahad_al_ahmad", "Fahad Al-Ahmad", "فهد الأحمد"),
      a("jaber_al_ali", "Jaber Al-Ali", "جابر العلي"),
      a("ali_sabah_al_salem", "Ali Sabah Al-Salem (Umm Al-Hayman)", "علي صباح السالم (أم الهيمان)"),
      a("sabah_al_ahmad", "Sabah Al-Ahmad City", "مدينة صباح الأحمد"),
      a("sabah_al_ahmad_marine", "Sabah Al-Ahmad Marine City", "مدينة صباح الأحمد البحرية"),
      a("khairan", "Khairan", "الخيران"),
      a("wafra", "Wafra", "الوفرة"),
      a("zour", "Zour", "الزور"),
      a("nuwaiseeb", "Nuwaiseeb", "النويصيب"),
      a("bnaider", "Bnaider", "بنيدر"),
      a("julaia", "Julaia", "الجليعة"),
      a("mina_abdullah", "Mina Abdullah", "ميناء عبدالله"),
      a("mina_al_ahmadi", "Mina Al-Ahmadi", "ميناء الأحمدي"),
      a("shuaiba", "Shuaiba", "الشعيبة"),
      a("magwa", "Magwa", "المقوع"),
      a("east_ahmadi", "East Ahmadi", "شرق الأحمدي"),
    ],
  },
  {
    key: "jahra",
    en: "Jahra",
    ar: "الجهراء",
    areas: [
      a("jahra", "Jahra", "الجهراء"),
      a("saad_al_abdullah", "Saad Al-Abdullah", "سعد العبدالله"),
      a("oyoun", "Oyoun", "العيون"),
      a("qasr", "Qasr", "القصر"),
      a("naeem", "Naeem", "النعيم"),
      a("naseem", "Naseem", "النسيم"),
      a("taima", "Taima", "تيماء"),
      a("waha", "Waha", "الواحة"),
      a("jaber_al_ahmad", "Jaber Al-Ahmad City", "مدينة جابر الأحمد"),
      a("amghara", "Amghara", "أمغرة"),
      a("sulaibiya", "Sulaibiya", "الصليبية"),
      a("kabd", "Kabd", "كبد"),
      a("abdali", "Abdali", "العبدلي"),
      a("mutla", "Mutla", "المطلاع"),
      a("kadhma", "Kadhma", "كاظمة"),
      a("subiya", "Subiya", "الصبية"),
      a("salmi", "Salmi", "السالمي"),
      a("jahra_industrial", "Jahra Industrial", "الجهراء الصناعية"),
    ],
  },
];

export const governorateOf = (key: string | null | undefined) => KUWAIT_GOVERNORATES.find((g) => g.key === key) ?? null;

export const areaOf = (governorate: string | null | undefined, area: string | null | undefined) => governorateOf(governorate)?.areas.find((x) => x.key === area) ?? null;

/** Whether `area` belongs to `governorate` (both keys). */
export const isKuwaitArea = (governorate: string, area: string) => areaOf(governorate, area) !== null;

/** "Salmiya, Hawalli" (or Arabic), for the AI data block and `Business.location`; "" when unset. */
export function locationLabel(governorate: string | null | undefined, area: string | null | undefined, locale: "en" | "ar" = "en"): string {
  const g = governorateOf(governorate);
  if (!g) return "";
  const x = areaOf(governorate, area);
  return [x?.[locale], g[locale]].filter(Boolean).join(locale === "ar" ? "، " : ", ");
}

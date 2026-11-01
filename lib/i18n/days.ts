import type { Locale } from "@/config/site";

/**
 * "N days" with the right plural, for strings like "Last {period}" (the translations have no plural
 * syntax, so the phrase is built here and passed in). English: "1 day" / "N days". Arabic follows its
 * plural rules (Intl.PluralRules "ar"): 1 يوم, 2 يومان (after آخر / خلال: يومين), 3–10 أيام, 11–99 يومًا,
 * 100+ يوم. `grammaticalCase`: "nominative" when the phrase is the subject ("يومان من البيانات"),
 * "genitive" after a word like آخر or خلال ("آخر يومين") — the default, since most uses are "last N days".
 * Digits are Latin, like the rest of the app (intlLocale). Pure, tested in tests/i18n-days.test.ts.
 */
export function daysPhrase(n: number, locale: Locale, grammaticalCase: "nominative" | "genitive" = "genitive"): string {
  const count = new Intl.NumberFormat(locale === "ar" ? "ar-KW-u-nu-latn" : "en-US").format(n);
  if (locale !== "ar") return n === 1 ? "1 day" : `${count} days`;
  switch (new Intl.PluralRules("ar").select(n)) {
    case "one":
      return "يوم واحد";
    case "two":
      return grammaticalCase === "nominative" ? "يومان" : "يومين";
    case "few":
      return `${count} أيام`;
    case "many":
      return `${count} يومًا`;
    default:
      return `${count} يوم`;
  }
}

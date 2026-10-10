import { cookies } from "next/headers";
import { COOKIES, LOCALES, SITE, type Locale } from "@/config/site";

export async function getLocale(): Promise<Locale> {
  const store = await cookies();
  const value = store.get(COOKIES.locale)?.value;
  return (LOCALES as readonly string[]).includes(value ?? "") ? (value as Locale) : SITE.defaultLocale;
}

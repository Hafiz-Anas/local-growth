import { redirect } from "next/navigation";
import { USER_NAV } from "@/config/navigation";
import { getActiveClientContext } from "@/lib/auth/server";
import { clientHome } from "@/lib/navigation";
import { filterNav } from "@/lib/permissions";

/** Home was removed: old links (bookmarks, emails, other tabs) land on the Gallery. */
export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const { permissions } = await getActiveClientContext();
  const query = new URLSearchParams(Object.entries(await searchParams).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : [])));
  const home = clientHome(filterNav(USER_NAV, permissions));
  redirect(query.size ? `${home}?${query}` : home);
}

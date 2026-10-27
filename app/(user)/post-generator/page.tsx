import { redirect } from "next/navigation";
import { USER_NAV } from "@/config/navigation";
import { getActiveClientContext } from "@/lib/auth/server";
import { clientHome } from "@/lib/navigation";
import { filterNav } from "@/lib/permissions";

/**
 * Posts (the Post Generator) is hidden for now: its page is blocked and old links land on the
 * Gallery. The view (components/post-generator) and its API stay so it can come back.
 */
export default async function PostGeneratorPage() {
  const { permissions } = await getActiveClientContext();
  redirect(clientHome(filterNav(USER_NAV, permissions)));
}

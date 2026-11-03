import { redirect } from "next/navigation";
import { HOME_BY_ROLE } from "@/config/navigation";
import { getSession } from "@/lib/auth/server";

// The proxy normally handles "/", this is the fallback.
export default async function RootPage() {
  const session = await getSession();
  // Clients go through their start page (UX1, app/(user)/dashboard).
  redirect(session ? (session.role === "user" ? "/dashboard" : HOME_BY_ROLE.admin) : "/login");
}

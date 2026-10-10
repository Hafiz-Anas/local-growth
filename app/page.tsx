import { redirect } from "next/navigation";
import { HOME_BY_ROLE } from "@/config/navigation";
import { getSession } from "@/lib/auth/server";

// The proxy normally handles "/", this is the fallback.
export default async function RootPage() {
  const session = await getSession();
  redirect(session ? HOME_BY_ROLE[session.role] : "/login");
}

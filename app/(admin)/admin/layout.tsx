import { AdminShell } from "@/components/layout/admin-shell";
import { requireAdmin } from "@/lib/auth/server";
import { getUiPreferences } from "@/lib/server/client-view";
import { initials } from "@/lib/utils";

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const session = await requireAdmin();
  const preferences = await getUiPreferences(session.userId);

  return (
    <AdminShell
      user={{
        name: session.name,
        email: session.email,
        avatarUrl: session.avatarUrl,
        initials: initials(session.name),
        tone: "night",
        role: "admin",
      }}
      preferences={preferences}
    >
      {children}
    </AdminShell>
  );
}

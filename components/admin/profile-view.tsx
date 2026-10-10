"use client";

import { PageHeader } from "@/components/shared/page-header";
import { ChangePassword } from "@/components/settings/change-password";
import { ProfilePhoto } from "@/components/settings/profile-photo";
import { PreferencesCard } from "@/components/settings/settings-view";
import { useI18n } from "@/lib/i18n/provider";
import { initials } from "@/lib/utils";

/** Admin → Profile: the admin's own account. System-wide settings stay on the System page. */
export function AdminProfileView({ account }: { account: { name: string; email: string; avatarUrl: string | null } }) {
  const { t } = useI18n();
  return (
    <div>
      <PageHeader title={t("admin.profile.title")} subtitle={t("admin.profile.subtitle")} />
      <div className="max-w-2xl space-y-4">
        <ProfilePhoto title={account.name} subtitle={account.email} avatarUrl={account.avatarUrl} initials={initials(account.name)} tone="night" />
        <ChangePassword />
        <PreferencesCard />
      </div>
    </div>
  );
}

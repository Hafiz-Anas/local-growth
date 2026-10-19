"use client";

import { ChipSelect } from "@/components/shared/chip-select";
import { KUWAIT_GOVERNORATES, governorateOf } from "@/config/kuwait";
import { SERVICE_MODES, type ServiceMode } from "@/config/onboarding";
import { useI18n } from "@/lib/i18n/provider";

export interface LocationValue {
  governorate: string | null;
  area: string | null;
  serviceMode: ServiceMode | null;
}

/**
 * Governorate (chips), area (a native list — easy on phones) and delivery / shop / both, in English
 * or Arabic. Onboarding's "Your location" and Settings → Business.
 */
export function LocationFields({ value, onChange, disabled = false }: { value: LocationValue; onChange: (value: LocationValue) => void; disabled?: boolean }) {
  const { t, locale } = useI18n();
  const governorate = governorateOf(value.governorate);
  const areas = governorate ? [...governorate.areas].sort((a, b) => a[locale].localeCompare(b[locale], locale)) : [];

  return (
    <div className="space-y-6">
      <ChipSelect
        size="sm"
        label={t("onboarding.location.governorate")}
        value={value.governorate}
        onChange={(g) => !disabled && onChange({ ...value, governorate: g, area: g === value.governorate ? value.area : null })}
        options={KUWAIT_GOVERNORATES.map((g) => ({ value: g.key, label: g[locale] }))}
      />

      <div>
        <label htmlFor="location-area" className="mb-1.5 block text-body font-semibold">
          {t("onboarding.location.area")}
        </label>
        <select
          id="location-area"
          value={value.area ?? ""}
          onChange={(e) => onChange({ ...value, area: e.target.value || null })}
          disabled={disabled || !governorate}
          className="h-9 w-full rounded-button border border-border bg-input px-3 text-body text-foreground outline-none focus:border-muted disabled:opacity-50"
        >
          <option value="">{governorate ? t("onboarding.location.pickArea") : t("onboarding.location.pickGovernorateFirst")}</option>
          {areas.map((a) => (
            <option key={a.key} value={a.key}>
              {a[locale]}
            </option>
          ))}
        </select>
      </div>

      <ChipSelect
        size="sm"
        label={t("onboarding.location.serviceMode")}
        value={value.serviceMode}
        onChange={(mode) => !disabled && onChange({ ...value, serviceMode: mode })}
        options={SERVICE_MODES.map((mode) => ({ value: mode, label: t(`onboarding.location.modes.${mode}`) }))}
      />
    </div>
  );
}

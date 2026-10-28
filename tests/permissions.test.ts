import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FEATURE_KEYS, FEATURE_MODULES } from "../config/features";
import { USER_NAV, ROUTE_FEATURES } from "../config/navigation";
import { PLAN_IDS, PLAN_PRESETS } from "../config/plans";
import { filterNav, isFeatureEnabled, permissionsFromRows } from "../lib/permissions";

describe("Gallery and AI chat features", () => {
  it("are modules of their own, ON in every plan; the old assistant's switch is gone", () => {
    assert.ok(!(FEATURE_KEYS as readonly string[]).includes("assistant"));
    for (const key of ["gallery", "aiChat"] as const) {
      assert.deepEqual(FEATURE_MODULES.find((m) => m.id === key), { id: key, moduleKey: key, subFeatures: [] });
      for (const plan of PLAN_IDS) assert.equal(PLAN_PRESETS[plan][key], true, `${plan} ${key}`);
    }
  });

  it("gate the Gallery and centre AI tabs; ON for businesses without a row (no data migration)", () => {
    assert.equal(ROUTE_FEATURES["/gallery"], "gallery");
    assert.equal(ROUTE_FEATURES["/ai"], "aiChat");
    for (const key of ["gallery", "aiChat"] as const) {
      assert.equal(isFeatureEnabled(permissionsFromRows([]), key), true, key);
      assert.equal(isFeatureEnabled(permissionsFromRows([{ featureKey: key, enabled: false }]), key), false, key);
    }
    const off = filterNav(USER_NAV, permissionsFromRows([{ featureKey: "gallery", enabled: false }, { featureKey: "aiChat", enabled: false }]));
    assert.ok(!off.some((i) => i.href === "/gallery" || i.href === "/ai"));
    // Other modules still need their row; the old assistant's rows are ignored.
    assert.equal(isFeatureEnabled(permissionsFromRows([]), "recommendations"), false);
    assert.ok(!("assistant" in permissionsFromRows([{ featureKey: "assistant", enabled: true }])));
  });
});

describe("Competitors → Inspiration", () => {
  it("is a sub-feature of Competitors with its own tab, ON without a row (no data migration) and in the plans that have Competitors", () => {
    assert.ok(FEATURE_MODULES.find((m) => m.id === "competitors")!.subFeatures.includes("competitors.inspiration"));
    assert.equal(ROUTE_FEATURES["/competitors/inspiration"], "competitors.inspiration");
    for (const plan of PLAN_IDS) assert.equal(PLAN_PRESETS[plan]["competitors.inspiration"], PLAN_PRESETS[plan].competitors, plan);
    const withModule = (rows: Array<{ featureKey: string; enabled: boolean }>) => permissionsFromRows([{ featureKey: "competitors", enabled: true }, ...rows]);
    assert.equal(isFeatureEnabled(withModule([]), "competitors.inspiration"), true);
    assert.equal(isFeatureEnabled(withModule([{ featureKey: "competitors.inspiration", enabled: false }]), "competitors.inspiration"), false);
    // Only effective while the Competitors module is ON.
    assert.equal(isFeatureEnabled(permissionsFromRows([]), "competitors.inspiration"), false);
    const tabs = (rows: Array<{ featureKey: string; enabled: boolean }>) => filterNav(USER_NAV, withModule(rows)).find((i) => i.labelKey === "nav.competitors")?.pages?.map((p) => p.href);
    assert.deepEqual(tabs([]), ["/competitors", "/competitors/inspiration"]);
    assert.deepEqual(tabs([{ featureKey: "competitors.analysis", enabled: true }]), ["/competitors", "/competitors/analysis", "/competitors/inspiration"]);
    assert.deepEqual(tabs([{ featureKey: "competitors.inspiration", enabled: false }]), ["/competitors"]);
  });
});

describe("Recommendations feature", () => {
  it("is a module of its own, ON in every plan, and gates its nav item", () => {
    assert.deepEqual(FEATURE_MODULES.find((m) => m.id === "recommendations"), { id: "recommendations", moduleKey: "recommendations", subFeatures: [] });
    for (const plan of PLAN_IDS) assert.equal(PLAN_PRESETS[plan].recommendations, true, plan);
    assert.equal(ROUTE_FEATURES["/recommendations"], "recommendations");
    assert.ok(!filterNav(USER_NAV, permissionsFromRows([{ featureKey: "recommendations", enabled: false }])).some((i) => i.href === "/recommendations"));
    assert.ok(filterNav(USER_NAV, permissionsFromRows([{ featureKey: "recommendations", enabled: true }])).some((i) => i.href === "/recommendations"));
  });
});

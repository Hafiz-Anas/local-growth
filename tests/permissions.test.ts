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

describe("Recommendations feature", () => {
  it("is a module of its own, ON in every plan, and gates its nav item", () => {
    assert.deepEqual(FEATURE_MODULES.find((m) => m.id === "recommendations"), { id: "recommendations", moduleKey: "recommendations", subFeatures: [] });
    for (const plan of PLAN_IDS) assert.equal(PLAN_PRESETS[plan].recommendations, true, plan);
    assert.equal(ROUTE_FEATURES["/recommendations"], "recommendations");
    assert.ok(!filterNav(USER_NAV, permissionsFromRows([{ featureKey: "recommendations", enabled: false }])).some((i) => i.href === "/recommendations"));
    assert.ok(filterNav(USER_NAV, permissionsFromRows([{ featureKey: "recommendations", enabled: true }])).some((i) => i.href === "/recommendations"));
  });
});

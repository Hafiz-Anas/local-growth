import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FEATURE_KEYS, FEATURE_MODULES } from "../config/features";
import { USER_NAV, ROUTE_FEATURES } from "../config/navigation";
import { PLAN_IDS, PLAN_PRESETS } from "../config/plans";
import { filterNav, isFeatureEnabled, permissionsFromRows } from "../lib/permissions";

describe("AI assistant feature", () => {
  it("is a module of its own, ON in every plan", () => {
    assert.ok(FEATURE_KEYS.includes("assistant"));
    assert.deepEqual(FEATURE_MODULES.find((m) => m.id === "assistant"), { id: "assistant", moduleKey: "assistant", subFeatures: [] });
    for (const plan of PLAN_IDS) assert.equal(PLAN_PRESETS[plan].assistant, true, plan);
  });

  it("opens from the footer banner (no nav item), gated by the feature", () => {
    assert.ok(!USER_NAV.some((i) => i.href === "/assistant"));
    const on = permissionsFromRows([{ featureKey: "assistant", enabled: true }]);
    const off = permissionsFromRows([{ featureKey: "assistant", enabled: false }]);
    assert.equal(isFeatureEnabled(on, "assistant"), true);
    assert.equal(isFeatureEnabled(off, "assistant"), false);
    // A business without the row (before the data migration) doesn't get it by accident.
    assert.equal(isFeatureEnabled(permissionsFromRows([]), "assistant"), false);
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

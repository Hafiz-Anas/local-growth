import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FEATURE_KEYS } from "../config/features";
import { START_PAGES, USER_NAV } from "../config/navigation";
import { startPageHref } from "../lib/navigation";
import { filterNav } from "../lib/permissions";
import { uiPreferencesPatchSchema, uiPreferencesSchema } from "../lib/validation/api";
import type { FeatureKey, Permissions } from "../types";

const allOn = () => Object.fromEntries(FEATURE_KEYS.map((k) => [k, true])) as Permissions;
const without = (...keys: FeatureKey[]) => ({ ...allOn(), ...Object.fromEntries(keys.map((k) => [k, false])) }) as Permissions;

describe("start page (UX1)", () => {
  it("lands on the chosen section", () => {
    const nav = filterNav(USER_NAV, allOn());
    assert.equal(startPageHref(nav, "gallery"), "/gallery");
    assert.equal(startPageHref(nav, "engagement"), "/engagement/comments");
    assert.equal(startPageHref(nav, "ai"), "/ai");
    assert.equal(startPageHref(nav, "insights"), "/insights");
    assert.equal(startPageHref(nav, "competitors"), "/competitors");
  });

  it("falls back to the Gallery when the chosen section is switched off, or nothing was chosen", () => {
    assert.equal(startPageHref(filterNav(USER_NAV, without("aiChat")), "ai"), "/gallery");
    assert.equal(startPageHref(filterNav(USER_NAV, without("competitors")), "competitors"), "/gallery");
    assert.equal(startPageHref(filterNav(USER_NAV, allOn()), undefined), "/gallery");
    assert.equal(startPageHref(filterNav(USER_NAV, allOn()), "settings"), "/gallery");
    // A section opens on its first visible page: without post insights (Overview, Post performance), Recommendations.
    assert.equal(startPageHref(filterNav(USER_NAV, without("postInsights")), "insights"), "/recommendations");
    // No Gallery either: the first section left (as before).
    assert.equal(startPageHref(filterNav(USER_NAV, without("gallery", "aiChat")), "ai"), "/engagement/comments");
  });

  it("is saved in the user's preferences: Gallery by default, anything unknown reads as the Gallery", () => {
    assert.deepEqual([...START_PAGES], ["gallery", "engagement", "ai", "insights", "competitors"]);
    assert.equal(uiPreferencesSchema.parse({}).startPage, "gallery");
    assert.equal(uiPreferencesSchema.parse({ startPage: "insights" }).startPage, "insights");
    // An old or tampered value doesn't wipe the other preferences.
    const parsed = uiPreferencesSchema.parse({ startPage: "home", language: "ar", theme: "dark" });
    assert.deepEqual([parsed.startPage, parsed.language, parsed.theme], ["gallery", "ar", "dark"]);
    assert.ok(uiPreferencesPatchSchema.safeParse({ startPage: "competitors" }).success);
    assert.ok(!uiPreferencesPatchSchema.safeParse({ startPage: "settings" }).success);
  });
});

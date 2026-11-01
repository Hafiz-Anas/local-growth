import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { daysPhrase } from "../lib/i18n/days";

describe("daysPhrase", () => {
  it("English: day / days", () => {
    assert.equal(daysPhrase(1, "en"), "1 day");
    assert.equal(daysPhrase(7, "en"), "7 days");
    assert.equal(daysPhrase(30, "en"), "30 days");
  });

  it("Arabic: يوم / يومان (يومين after آخر) / أيام / يومًا", () => {
    assert.equal(daysPhrase(1, "ar"), "يوم واحد");
    assert.equal(daysPhrase(2, "ar"), "يومين");
    assert.equal(daysPhrase(2, "ar", "nominative"), "يومان");
    assert.equal(daysPhrase(3, "ar"), "3 أيام");
    assert.equal(daysPhrase(7, "ar"), "7 أيام");
    assert.equal(daysPhrase(10, "ar"), "10 أيام");
    assert.equal(daysPhrase(11, "ar"), "11 يومًا");
    assert.equal(daysPhrase(21, "ar"), "21 يومًا");
    assert.equal(daysPhrase(30, "ar"), "30 يومًا");
    assert.equal(daysPhrase(100, "ar"), "100 يوم");
  });
});

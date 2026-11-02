import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { healthReport, runCheck } from "../lib/health";

describe("health checks", () => {
  it("liveness doesn't touch the database", async () => {
    let called = false;
    assert.deepEqual(await healthReport(false, async () => (called = true)), { status: "ok", checks: {} });
    assert.equal(called, false);
  });

  it("readiness is ok when the database answers", async () => {
    assert.deepEqual(await healthReport(true, async () => 1), { status: "ok", checks: { database: "ok" } });
  });

  it("readiness fails when the database is down or too slow", async () => {
    assert.deepEqual(await healthReport(true, async () => Promise.reject(new Error("ECONNREFUSED"))), { status: "fail", checks: { database: "down" } });
    assert.deepEqual(await healthReport(true, () => new Promise((r) => setTimeout(r, 200)), 20), { status: "fail", checks: { database: "timeout" } });
  });

  it("runCheck never throws", async () => {
    assert.equal(await runCheck(() => Promise.reject(new Error("x"))), "down");
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { aiStatusHealth, type ConnectionState } from "../lib/ai-status";

const NOW = new Date("2026-10-14T12:00:00Z");
const HOUR = 3_600_000;
const meta = (o: Partial<ConnectionState> = {}): ConnectionState => ({
  provider: "META",
  status: "CONNECTED",
  tokenExpiresAt: new Date(NOW.getTime() + 30 * 24 * HOUR),
  lastSyncAt: new Date(NOW.getTime() - 2 * HOUR),
  lastSyncError: null,
  missingPermissions: [],
  ...o,
});

describe("AI status card", () => {
  it("healthy Meta connection with a recent sync has no warnings", () => {
    assert.deepEqual(aiStatusHealth(meta(), NOW), { health: "healthy", warnings: [] });
  });

  it("flags stale data after a day without a sync, and a failed sync", () => {
    assert.deepEqual(aiStatusHealth(meta({ lastSyncAt: new Date(NOW.getTime() - 25 * HOUR) }), NOW).warnings, ["stale"]);
    assert.deepEqual(aiStatusHealth(meta({ lastSyncAt: null, lastSyncError: "rate_limited" }), NOW).warnings, ["stale", "sync_failed"]);
  });

  it("asks to reconnect when the token is revoked or past its expiry", () => {
    assert.deepEqual(aiStatusHealth(meta({ status: "NEEDS_RECONNECT" }), NOW), { health: "needs_reconnect", warnings: ["reconnect"] });
    assert.deepEqual(aiStatusHealth(meta({ tokenExpiresAt: new Date(NOW.getTime() - 1) }), NOW), { health: "needs_reconnect", warnings: ["reconnect"] });
  });

  it("missing permissions, demo data and no connection", () => {
    assert.deepEqual(aiStatusHealth(meta({ missingPermissions: ["instagram_manage_insights"] }), NOW), { health: "permissions", warnings: ["permissions"] });
    assert.deepEqual(aiStatusHealth({ ...meta(), provider: "MOCK" }, NOW), { health: "demo", warnings: [] });
    assert.deepEqual(aiStatusHealth(null, NOW), { health: "disconnected", warnings: ["not_connected"] });
    assert.deepEqual(aiStatusHealth(meta({ status: "DISCONNECTED" }), NOW), { health: "disconnected", warnings: ["not_connected"] });
  });
});

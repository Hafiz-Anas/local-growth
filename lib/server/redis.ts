import "server-only";
import Redis from "ioredis";

/**
 * The shared Redis / Valkey connection (REDIS_URL, e.g. rediss://default:<password>@host:25061), used only
 * when RATE_LIMIT_STORE="redis" (rate limits and the Gemini budget, lib/services/redis-stores.ts).
 * Fails fast instead of queueing: a command that can't run within half a second throws, and the caller
 * falls back to its in-memory counter. One connection per server instance, kept across hot reloads.
 */
const globalForRedis = globalThis as unknown as { lgeRedis?: Redis };

export function redisEnabled(): boolean {
  return process.env.RATE_LIMIT_STORE === "redis";
}

export function getRedis(): Redis {
  if (globalForRedis.lgeRedis) return globalForRedis.lgeRedis;
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('RATE_LIMIT_STORE is "redis" but REDIS_URL is not set.');
  const client = new Redis(url, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    commandTimeout: 500,
    connectTimeout: 2000,
    lazyConnect: false,
  });
  // Connection problems are reported by the callers' fallback; keep ioredis from logging unhandled errors.
  client.on("error", () => undefined);
  globalForRedis.lgeRedis = client;
  return client;
}

import type { RateLimitRule, RateLimiter } from "../../lib/server/rate-limit";

/** A counting stand-in for InMemoryRateLimiter (that one lives in a server-only module tests can't import). */
export class InMemoryRateLimiterForTests implements RateLimiter {
  private counts = new Map<string, number>();
  count(rule: RateLimitRule, key: string) {
    return this.counts.get(`${rule.name}:${key}`) ?? 0;
  }
  async isLimited(rule: RateLimitRule, key: string) {
    return this.count(rule, key) >= rule.limit;
  }
  async hit(rule: RateLimitRule, key: string) {
    this.counts.set(`${rule.name}:${key}`, this.count(rule, key) + 1);
  }
  async consume(rule: RateLimitRule, key: string) {
    if (this.count(rule, key) >= rule.limit) return false;
    await this.hit(rule, key);
    return true;
  }
  async reset(rule: RateLimitRule, key: string) {
    this.counts.delete(`${rule.name}:${key}`);
  }
}

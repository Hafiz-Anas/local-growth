import { createHmac } from "node:crypto";
import type { MetaConfig, MetaScope } from "./config";
import { MetaApiError, type GraphErrorBody } from "./errors";

/**
 * Minimal Graph API client. Pure (fetch is injectable) so tests run it against
 * recorded responses.
 *
 *  - Every call with a user/Page token carries appsecret_proof (HMAC-SHA256 of the token with the app secret).
 *  - Tokens travel only in the request; they are never part of `call` names, errors or logs.
 *  - Reads Meta's usage headers (X-App-Usage, X-Business-Use-Case-Usage) after every call.
 *  - Rate-limit errors (4, 17, 32, 613, 80001+) are retried with backoff only when Meta doesn't
 *    ask us to wait longer; otherwise the error carries `retryAfterMs` for the caller to cool down.
 */

export function appsecretProof(token: string, appSecret: string): string {
  return createHmac("sha256", appSecret).update(token).digest("hex");
}

/** Highest usage Meta reported, in percent of the allowance (0–100+). */
export interface GraphUsage {
  appPct: number;
  businessPct: number;
  /** Minutes until access is restored when throttled (Business Use Case header), 0 if not throttled. */
  regainAccessMinutes: number;
}

const pct = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export function parseUsageHeaders(headers: Headers): GraphUsage | null {
  const app = headers.get("x-app-usage");
  const buc = headers.get("x-business-use-case-usage");
  if (!app && !buc) return null;
  const usage: GraphUsage = { appPct: 0, businessPct: 0, regainAccessMinutes: 0 };
  try {
    if (app) {
      const a = JSON.parse(app) as Record<string, unknown>;
      usage.appPct = Math.max(pct(a.call_count), pct(a.total_time), pct(a.total_cputime));
    }
    if (buc) {
      const b = JSON.parse(buc) as Record<string, Array<Record<string, unknown>>>;
      for (const entries of Object.values(b)) {
        for (const e of entries ?? []) {
          usage.businessPct = Math.max(usage.businessPct, pct(e.call_count), pct(e.total_time), pct(e.total_cputime));
          usage.regainAccessMinutes = Math.max(usage.regainAccessMinutes, pct(e.estimated_time_to_regain_access));
        }
      }
    }
  } catch {
    return null;
  }
  return usage;
}

export interface GraphCallInfo {
  call: string;
  ok: boolean;
  httpStatus: number | null;
  durationMs: number;
  error?: MetaApiError;
  usage: GraphUsage | null;
  /** A failure the caller expects and summarises itself (CallOptions.quiet). */
  expected?: boolean;
}

export interface GraphClientOptions {
  config: MetaConfig;
  fetch?: typeof fetch;
  /** Called after every attempt (success or failure) — used for usage tracking and the IntegrationEvent log. */
  onCall?: (info: GraphCallInfo) => void | Promise<void>;
  sleep?: (ms: number) => Promise<void>;
  /** Retries for rate-limit/transient errors (default 2). */
  maxRetries?: number;
  timeoutMs?: number;
}

export interface CallOptions {
  /** Token for this call; omitted for app-token calls (they pass `appToken: true`). */
  token?: string;
  /** Use the app access token (app id | secret) — debug_token only. No appsecret_proof. */
  appToken?: boolean;
  /** Human-readable name for logs, e.g. "GET /{ig-user}/media". Never put ids or tokens here. */
  call: string;
  /** Permission the call needs; reported when Meta answers with a permission error without naming one. */
  scopes?: MetaScope[];
  /** Don't retry (e.g. a POST that must not be sent twice). */
  noRetry?: boolean;
  /**
   * Expected "no such thing" answers (an unsupported metric, a competitor that doesn't exist):
   * not_found / invalid_request failures are reported with `expected: true` so the log can skip
   * them — the caller logs one summary instead. Token, permission and rate-limit errors are never quiet.
   */
  quiet?: boolean;
}

type Params = Record<string, string | number | boolean | undefined>;

const BACKOFF_MS = [1_000, 4_000];
/** Longest wait we'll sit through inside a request before giving up and cooling down instead. */
const MAX_INLINE_WAIT_MS = 5_000;

export class GraphClient {
  private readonly fetchFn: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxRetries: number;
  private readonly timeoutMs: number;

  constructor(private readonly options: GraphClientOptions) {
    this.fetchFn = options.fetch ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.maxRetries = options.maxRetries ?? 2;
    this.timeoutMs = options.timeoutMs ?? 20_000;
  }

  get config() {
    return this.options.config;
  }

  get<T>(path: string, params: Params, options: CallOptions): Promise<T> {
    return this.request<T>("GET", path, params, options);
  }

  post<T>(path: string, params: Params, options: CallOptions): Promise<T> {
    return this.request<T>("POST", path, params, { ...options, noRetry: options.noRetry ?? true });
  }

  /** Follows `paging.cursors.after` until `max` items (re-signing each page instead of reusing Meta's `next` URL). */
  async paginate<T>(path: string, params: Params, options: CallOptions, max: number): Promise<T[]> {
    const items: T[] = [];
    let after: string | undefined;
    for (let page = 0; page < 20 && items.length < max; page += 1) {
      const res = await this.get<{ data?: T[]; paging?: { cursors?: { after?: string }; next?: string } }>(
        path,
        { ...params, ...(after && { after }) },
        options,
      );
      items.push(...(res.data ?? []));
      after = res.paging?.next ? res.paging.cursors?.after : undefined;
      if (!after) break;
    }
    return items.slice(0, max);
  }

  /** Endpoint URL and all parameters, including the token and its appsecret_proof (never logged). */
  private buildRequest(path: string, params: Params, options: CallOptions): { url: string; query: URLSearchParams } {
    const { graphBaseUrl, graphVersion, appId, appSecret } = this.options.config;
    const url = `${graphBaseUrl}/${graphVersion}/${path.replace(/^\/+/, "")}`;
    const query = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined) query.set(k, String(v));
    if (options.appToken) {
      query.set("access_token", `${appId}|${appSecret}`);
    } else if (options.token) {
      query.set("access_token", options.token);
      query.set("appsecret_proof", appsecretProof(options.token, appSecret));
    }
    return { url, query };
  }

  private async request<T>(method: "GET" | "POST", path: string, params: Params, options: CallOptions): Promise<T> {
    const { url, query } = this.buildRequest(path, params, options);

    for (let attempt = 0; ; attempt += 1) {
      const started = Date.now();
      let response: Response;
      try {
        response =
          method === "GET"
            ? await this.fetchFn(`${url}?${query}`, { method, signal: AbortSignal.timeout(this.timeoutMs), cache: "no-store" })
            : await this.fetchFn(url, {
                method,
                headers: { "content-type": "application/x-www-form-urlencoded" },
                body: query.toString(),
                signal: AbortSignal.timeout(this.timeoutMs),
                cache: "no-store",
              });
      } catch (cause) {
        const error = new MetaApiError({ call: options.call, kind: "transient", message: `Network error: ${(cause as Error)?.name ?? "unknown"}` });
        await this.report({ call: options.call, ok: false, httpStatus: null, durationMs: Date.now() - started, error, usage: null });
        if (!options.noRetry && attempt < Math.min(1, this.maxRetries)) {
          await this.sleep(BACKOFF_MS[0]);
          continue;
        }
        throw error;
      }

      const usage = parseUsageHeaders(response.headers);
      const json = (await response.json().catch(() => null)) as (T & { error?: GraphErrorBody }) | null;
      if (response.ok && json && !json.error) {
        await this.report({ call: options.call, ok: true, httpStatus: response.status, durationMs: Date.now() - started, usage });
        return json;
      }

      const body: GraphErrorBody = json?.error ?? { message: `HTTP ${response.status}` };
      const retryAfterMs = usage?.regainAccessMinutes ? usage.regainAccessMinutes * 60_000 : null;
      const error = MetaApiError.fromGraph(options.call, body, response.status, options.scopes, retryAfterMs);
      const expected = Boolean(options.quiet) && (error.kind === "not_found" || error.kind === "invalid_request");
      await this.report({ call: options.call, ok: false, httpStatus: response.status, durationMs: Date.now() - started, error, usage, expected });

      const retryable = error.kind === "rate_limited" || error.kind === "transient";
      const wait = error.kind === "rate_limited" ? Math.max(BACKOFF_MS[attempt] ?? 0, retryAfterMs ?? 0) : (BACKOFF_MS[attempt] ?? 0);
      if (retryable && !options.noRetry && attempt < this.maxRetries && wait <= MAX_INLINE_WAIT_MS) {
        await this.sleep(wait);
        continue;
      }
      throw error;
    }
  }

  private async report(info: GraphCallInfo) {
    try {
      await this.options.onCall?.(info);
    } catch {
      // Logging must never break the call itself.
    }
  }
}

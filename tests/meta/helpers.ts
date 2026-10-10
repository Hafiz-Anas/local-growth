import { readFileSync } from "node:fs";
import path from "node:path";
import type { MetaConfig } from "../../lib/services/meta/config";
import { GraphClient, type GraphCallInfo } from "../../lib/services/meta/graph";

/** Recorded sample responses (tests/meta/fixtures.json). */
export const fx = JSON.parse(readFileSync(path.join(__dirname, "fixtures.json"), "utf8")) as Record<string, unknown>;

export const CONFIG: MetaConfig = {
  appId: "3457472907767619",
  appSecret: "test-app-secret-not-real",
  redirectUri: "http://localhost:3000/api/integrations/instagram/callback",
  graphVersion: "v26.0",
  graphBaseUrl: "https://graph.test",
  responseType: "code",
};

export interface Reply {
  status?: number;
  body: unknown;
  headers?: Record<string, string>;
}

export interface RecordedCall {
  method: string;
  path: string;
  params: URLSearchParams;
}

/**
 * A fake Graph API: `route` answers each request (by path and params) with a
 * recorded response. Every request is recorded for assertions.
 */
export function fakeGraph(route: (call: RecordedCall, n: number) => Reply) {
  const calls: RecordedCall[] = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const params = method === "GET" ? url.searchParams : new URLSearchParams(String(init?.body ?? ""));
    const call = { method, path: url.pathname.replace(/^\/v\d+\.\d+\//, ""), params };
    calls.push(call);
    const reply = route(call, calls.length);
    return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200, headers: { "content-type": "application/json", ...reply.headers } });
  }) as typeof fetch;
  return { fetch: fetchFn, calls };
}

export function client(route: (call: RecordedCall, n: number) => Reply, extra: { onCall?: (info: GraphCallInfo) => void } = {}) {
  const graph = fakeGraph(route);
  const sleeps: number[] = [];
  const infos: GraphCallInfo[] = [];
  const c = new GraphClient({
    config: CONFIG,
    fetch: graph.fetch,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    onCall: (info) => {
      infos.push(info);
      extra.onCall?.(info);
    },
  });
  return { client: c, calls: graph.calls, sleeps, infos };
}

export const ok = (body: unknown, headers?: Record<string, string>): Reply => ({ body, headers });
export const err = (body: unknown, status = 400, headers?: Record<string, string>): Reply => ({ body, status, headers });

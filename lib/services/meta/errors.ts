import { META_SCOPES, type MetaScope } from "./config";

/**
 * Graph API errors → what the app does about them. Pure, covered by tests/meta.
 *
 *   kind            Graph codes                               app reaction
 *   token_invalid   190 (any subcode), 102                    connection → NEEDS_RECONNECT, "Reconnect Instagram" banner
 *   permission      10, 200–299                               record the missing permission, offer reconnect
 *   rate_limited    4, 17, 32, 613, 341, 80001–80014          back off (retry or cool down), never hammer
 *   not_found       100/33, 110, 24                           caller decides (e.g. competitor not found)
 *   transient       1, 2, HTTP 5xx, network errors            retry once
 *   invalid_request 100 (other subcodes),                     log, fail the call
 *                   10/2534022 + 10/2018278 (DM outside the 24-hour window — not a permission problem)
 */

/** "(#10) This message is sent outside of allowed window" (Instagram / Messenger). */
const OUTSIDE_WINDOW_SUBCODES = new Set([2534022, 2018278]);

export interface GraphErrorBody {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  error_user_title?: string;
  error_user_msg?: string;
  fbtrace_id?: string;
}

export type MetaErrorKind = "token_invalid" | "permission" | "rate_limited" | "not_found" | "transient" | "invalid_request" | "unknown";

const RATE_LIMIT_CODES = new Set([4, 17, 32, 613, 341]);

export function classifyGraphError(error: GraphErrorBody, httpStatus?: number): MetaErrorKind {
  const code = error.code ?? -1;
  if (code === 190 || code === 102) return "token_invalid";
  if (RATE_LIMIT_CODES.has(code) || (code >= 80001 && code <= 80014)) return "rate_limited";
  if (code === 10 && OUTSIDE_WINDOW_SUBCODES.has(error.error_subcode ?? -1)) return "invalid_request";
  if (code === 10 || (code >= 200 && code <= 299)) return "permission";
  if (code === 110 || code === 24 || (code === 100 && error.error_subcode === 33)) return "not_found";
  if (code === 1 || code === 2 || (httpStatus !== undefined && httpStatus >= 500)) return "transient";
  if (code === 100) return "invalid_request";
  return "unknown";
}

/** Removes anything token-like from text we log or store (Graph messages, URLs). */
export function sanitize(text: string): string {
  return text
    .replace(/\bEA[A-Za-z0-9]{20,}/g, "[token]")
    .replace(/(access_token|appsecret_proof|client_secret|fb_exchange_token|input_token|code)=[^&\s"']+/gi, "$1=[redacted]")
    .slice(0, 500);
}

/** Permission names mentioned in a Graph error message, e.g. "(#200) Requires instagram_manage_comments permission". */
export function scopesInMessage(message: string): MetaScope[] {
  return META_SCOPES.filter((scope) => message.includes(scope));
}

export class MetaApiError extends Error {
  readonly kind: MetaErrorKind;
  readonly code: number | null;
  readonly subcode: number | null;
  /** The call that failed, e.g. "GET /{ig-user}/media" (no ids, no tokens). */
  readonly call: string;
  readonly httpStatus: number | null;
  readonly fbtraceId: string | null;
  /** How long Meta says to wait before calling again (rate limits), when known. */
  readonly retryAfterMs: number | null;
  /** Permission the call needed; set for "permission" errors. */
  readonly missingScopes: MetaScope[];
  /** True when Meta's message named `missingScopes`; false when they are only the call's declared scopes (a guess). */
  readonly scopesNamed: boolean;

  constructor(init: {
    call: string;
    message: string;
    kind: MetaErrorKind;
    code?: number | null;
    subcode?: number | null;
    httpStatus?: number | null;
    fbtraceId?: string | null;
    retryAfterMs?: number | null;
    missingScopes?: MetaScope[];
    scopesNamed?: boolean;
  }) {
    super(sanitize(init.message));
    this.name = "MetaApiError";
    this.call = init.call;
    this.kind = init.kind;
    this.code = init.code ?? null;
    this.subcode = init.subcode ?? null;
    this.httpStatus = init.httpStatus ?? null;
    this.fbtraceId = init.fbtraceId ?? null;
    this.retryAfterMs = init.retryAfterMs ?? null;
    this.missingScopes = init.missingScopes ?? [];
    this.scopesNamed = init.scopesNamed ?? false;
  }

  /** "190/463", "110/2207013", "4" or "network". */
  get codeLabel(): string {
    if (this.code === null) return this.kind === "transient" ? "network" : "unknown";
    return this.subcode ? `${this.code}/${this.subcode}` : String(this.code);
  }

  static fromGraph(call: string, body: GraphErrorBody, httpStatus: number, requiredScopes: MetaScope[] = [], retryAfterMs: number | null = null) {
    const kind = classifyGraphError(body, httpStatus);
    const message = body.error_user_msg || body.message || `Graph API error (HTTP ${httpStatus})`;
    const mentioned = scopesInMessage(`${body.message ?? ""} ${body.error_user_msg ?? ""}`);
    return new MetaApiError({
      call,
      message,
      kind,
      code: body.code ?? null,
      subcode: body.error_subcode ?? null,
      httpStatus,
      fbtraceId: body.fbtrace_id ?? null,
      retryAfterMs,
      missingScopes: kind === "permission" ? (mentioned.length ? mentioned : requiredScopes) : [],
      scopesNamed: kind === "permission" && mentioned.length > 0,
    });
  }
}

export function isMetaError(error: unknown, kind?: MetaErrorKind): error is MetaApiError {
  return error instanceof MetaApiError && (!kind || error.kind === kind);
}

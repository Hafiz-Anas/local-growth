import { ACCOUNT_HEADER } from "@/lib/accounts";
import type { ApiResponse } from "@/types";

/**
 * Browser-side helper for the JSON API. Unwraps `{ ok, data }` and throws
 * `ApiClientError` for `{ ok: false, error }` or network failures. A 401
 * (session expired or revoked) sends the user to the login page.
 */
export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

function onUnauthorized() {
  if (typeof window === "undefined" || window.location.pathname === "/login") return;
  // Full page load (not client navigation) so no state from the old session survives.
  window.location.replace(new URL("/login?expired=1", window.location.origin));
}

/** Name of the <meta> the user layouts render with the active Instagram account's id. */
export const ACCOUNT_META = "lge-account";

/**
 * The account this page was rendered for, sent with every API call: when another account
 * became active meanwhile (another tab), the API answers 409 `account_switched` instead of
 * changing the wrong account.
 */
function accountHeaders(): Record<string, string> {
  if (typeof document === "undefined") return {};
  const id = document.querySelector<HTMLMetaElement>(`meta[name="${ACCOUNT_META}"]`)?.content;
  return id ? { [ACCOUNT_HEADER]: id } : {};
}

async function unwrap<T>(res: Response): Promise<T> {
  const payload = (await res.json().catch(() => null)) as ApiResponse<T> | null;
  if (res.status === 401) {
    onUnauthorized();
    throw new ApiClientError(401, "unauthorized", payload && !payload.ok ? payload.error.message : "Session expired.");
  }
  if (!payload) throw new ApiClientError(res.status, res.status >= 500 ? "internal_error" : "invalid_response", "Unexpected response.");
  if (!payload.ok) {
    // Another Instagram account became active (another tab): reload into it, nothing of this screen survives.
    if (payload.error.code === "account_switched" && typeof window !== "undefined") window.location.assign(new URL("/gallery", window.location.origin));
    throw new ApiClientError(res.status, payload.error.code, payload.error.message, payload.error.details);
  }
  return payload.data;
}

export async function apiFetch<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? "GET",
      headers: { ...accountHeaders(), ...(init.body !== undefined && { "Content-Type": "application/json" }) },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiClientError(0, "network_error", "Network error.");
  }
  return unwrap<T>(res);
}

/** multipart/form-data upload (e.g. the profile photo). */
export async function apiUpload<T>(path: string, form: FormData): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { method: "POST", body: form, headers: accountHeaders() });
  } catch {
    throw new ApiClientError(0, "network_error", "Network error.");
  }
  return unwrap<T>(res);
}

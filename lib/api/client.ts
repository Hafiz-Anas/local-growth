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

async function unwrap<T>(res: Response): Promise<T> {
  const payload = (await res.json().catch(() => null)) as ApiResponse<T> | null;
  if (res.status === 401) {
    onUnauthorized();
    throw new ApiClientError(401, "unauthorized", payload && !payload.ok ? payload.error.message : "Session expired.");
  }
  if (!payload) throw new ApiClientError(res.status, res.status >= 500 ? "internal_error" : "invalid_response", "Unexpected response.");
  if (!payload.ok) throw new ApiClientError(res.status, payload.error.code, payload.error.message, payload.error.details);
  return payload.data;
}

export async function apiFetch<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? "GET",
      headers: init.body !== undefined ? { "Content-Type": "application/json" } : undefined,
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
    res = await fetch(path, { method: "POST", body: form });
  } catch {
    throw new ApiClientError(0, "network_error", "Network error.");
  }
  return unwrap<T>(res);
}

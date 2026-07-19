// Typed API client for the FastAPI backend. Token is kept in localStorage and
// attached as a Bearer header. All calls funnel through apiFetch().

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8099";

const TOKEN_KEY = "mgl_token";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (typeof window === "undefined") return;
  if (token) window.localStorage.setItem(TOKEN_KEY, token);
  else window.localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function apiFetch<T = unknown>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const headers = new Headers(options.headers);
  if (!headers.has("Content-Type") && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(`${API_URL}${path}`, { ...options, headers });

  if (res.status === 401 && typeof window !== "undefined") {
    setToken(null);
    if (!window.location.pathname.startsWith("/login")) {
      window.location.href = "/login";
    }
  }

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail || detail;
    } catch {
      /* non-json error */
    }
    throw new ApiError(res.status, detail);
  }

  if (res.status === 204) return undefined as T;
  const ct = res.headers.get("Content-Type") || "";
  if (ct.includes("application/json")) return res.json();
  return (await res.text()) as unknown as T;
}

// ── Typed helpers ───────────────────────────────────────────────────────────
export const api = {
  get: <T>(p: string) => apiFetch<T>(p),
  post: <T>(p: string, body?: unknown) =>
    apiFetch<T>(p, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(p: string, body?: unknown) =>
    apiFetch<T>(p, { method: "PATCH", body: body ? JSON.stringify(body) : undefined }),
  del: <T>(p: string) => apiFetch<T>(p, { method: "DELETE" }),
  upload: <T>(p: string, form: FormData) =>
    apiFetch<T>(p, { method: "POST", body: form }),
};

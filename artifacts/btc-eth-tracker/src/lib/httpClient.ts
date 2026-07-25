import { Capacitor, CapacitorHttp } from "@capacitor/core";

/**
 * Indodax (and Binance, used only for chart shape) do not send permissive
 * CORS headers. In a browser/dev server this is worked around with a Vite
 * dev proxy (see vite.config.ts). Inside a built Android APK there is no
 * dev server to proxy through, and the WebView still enforces CORS for
 * `fetch`/`XMLHttpRequest`. Capacitor's native HTTP bridge (`CapacitorHttp`)
 * performs the request natively on-device, which is not subject to the
 * WebView's CORS policy, so we use it whenever running as a native app.
 */
export const isNativePlatform = Capacitor.isNativePlatform();

/** AbortSignal.timeout is not available in all browsers/webviews — use controller+timer. */
function timedFetch(url: string, ms: number, init?: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(new Error("Timeout")), ms);
  return fetch(url, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(tid));
}

interface ApiGetOptions {
  /** Relative path used in the browser/dev server (proxied to avoid CORS). */
  proxyPath: string;
  /** Absolute URL used for native (Capacitor) requests, which bypass CORS. */
  absoluteUrl: string;
  timeoutMs?: number;
  init?: RequestInit;
}

/**
 * Fetches JSON from either the native HTTP bridge (on Android/iOS) or the
 * browser `fetch` API via the dev/production proxy (on web).
 */
export async function apiGetJson<T = unknown>(options: ApiGetOptions): Promise<T> {
  const { proxyPath, absoluteUrl, timeoutMs = 8000, init } = options;

  if (isNativePlatform) {
    const response = await CapacitorHttp.get({
      url: absoluteUrl,
      connectTimeout: timeoutMs,
      readTimeout: timeoutMs,
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`HTTP ${response.status}`);
    }
    return response.data as T;
  }

  const res = await timedFetch(proxyPath, timeoutMs, init);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  // Indodax (and similar upstreams) sometimes return an HTML maintenance
  // page with a 200 status instead of JSON. Detect that case explicitly so
  // callers get a clear, actionable error instead of a cryptic JSON parse
  // failure like "Unexpected token '<'".
  const contentType = res.headers.get("content-type") ?? "";
  const text = await res.text();
  if (!contentType.includes("application/json") && /^\s*</.test(text)) {
    throw new Error("Server sedang maintenance atau tidak dapat diakses");
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error("Server sedang maintenance atau tidak dapat diakses");
  }
}

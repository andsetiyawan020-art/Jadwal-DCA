import { CapacitorHttp } from "@capacitor/core";
import { isNativePlatform } from "./httpClient";

/**
 * Minimal client for Indodax's Private API (TAPI), used ONLY to verify that
 * a saved API Key / Secret Key pair can authenticate via the `getInfo`
 * method. This module intentionally does not expose trade history or
 * balances to the rest of the app, and never performs buy/sell/withdraw
 * calls — it is a connection test only.
 */

export type IndodaxConnectionFailureReason =
  | "invalid_key"
  | "invalid_sign"
  | "network"
  | "server";

export type IndodaxConnectionResult =
  | { success: true; serverTime: number }
  | { success: false; reason: IndodaxConnectionFailureReason; detail?: string };

/**
 * A single Indodax trade-history entry, trimmed to fields that describe the
 * trade itself. Account balance / address fields returned by the real API
 * are intentionally NOT part of this type and are discarded when parsing —
 * this module must never surface balances.
 */
export interface IndodaxTradeHistoryEntry {
  tradeId: string;
  orderId: string;
  pair: string;
  type: string;
  price: number;
  amount: number;
  fee: number;
  date: string;
}

export type IndodaxTradeHistoryResult =
  | { success: true; pair: string; trades: IndodaxTradeHistoryEntry[]; truncated: boolean }
  | { success: false; pair: string; reason: IndodaxConnectionFailureReason; detail?: string };

/**
 * A trade-history entry converted into the app's transaction "shape"
 * (BUY/SELL, date, price, coin amount, fee) plus the identifying fields the
 * app's own transactions don't need (pair, trade id). This is a PREVIEW-ONLY
 * type — nothing that uses it may be written to the app's transaction
 * storage in this stage.
 */
export interface IndodaxPreviewTransaction {
  tradeId: string;
  orderId: string;
  pair: string;
  coin: "BTC" | "ETH";
  type: "BUY" | "SELL";
  date: string;
  hargaBeliPerCoin: number;
  jumlahBeli: number;
  fee: number;
  jumlahKoin: number;
}

const PAIR_TO_COIN: Record<string, "BTC" | "ETH"> = {
  btcidr: "BTC",
  ethidr: "ETH",
};

/**
 * Converts raw Indodax trade-history entries into the app's transaction
 * field shape (coin, hargaBeliPerCoin, jumlahBeli, fee, date) while adding
 * BUY/SELL, pair, and trade id — purely a data-shape mapping, no cost
 * basis / profit / DCA / balance math happens here.
 */
export function convertTradeHistoryToPreview(entries: IndodaxTradeHistoryEntry[]): IndodaxPreviewTransaction[] {
  return entries.map(t => {
    const coin = PAIR_TO_COIN[t.pair.toLowerCase()] ?? (t.pair.toUpperCase().startsWith("BTC") ? "BTC" : "ETH");
    const type: "BUY" | "SELL" = t.type.toLowerCase() === "sell" ? "SELL" : "BUY";
    // v2 API (myTrades) stores date as an ISO string directly.
    // Legacy path: if date is a numeric string in seconds (old TAPI format),
    // multiply by 1000 to convert to ms before constructing the Date object.
    // Number("2024-01-15T...") → NaN, so ISO strings fall through to the else branch.
    const numericDate = Number(t.date);
    const iso = Number.isFinite(numericDate) && numericDate > 0
      ? new Date(numericDate * 1000).toISOString()  // legacy: seconds → ms
      : t.date;                                      // v2: already ISO string

    // Robust parsing untuk mencegah nilai 0
    const price = Number(t.price) || 0;
    const qty = Number(t.amount) || 0;     // Jumlah koin (amount)
    const rawFeeFromApi = Number(t.fee) || 0; // Fee mentah dari API

    // FIX BUG: Jangan mengalikan fee dengan price jika fee sudah IDR (Rp20)
    // Berdasarkan gejala "Fee menjadi Miliaran", field commission Indodax V2
    // untuk pair IDR biasanya sudah dalam bentuk IDR (Rp20-30).
    const feeIdr = rawFeeFromApi;

    // Kalkulasi sesuai instruksi:
    // jumlahBeli = (jumlahCoin × hargaPerCoin) + fee
    const jumlahBeliGross = (qty * price) + feeIdr;

    return {
      tradeId: t.tradeId,
      orderId: t.orderId,
      pair: t.pair,
      coin,
      type,
      date: iso,
      hargaBeliPerCoin: price,
      jumlahBeli: jumlahBeliGross,
      fee: feeIdr,
      jumlahKoin: qty, // Nilai koin yang diterima murni dari field amount API
    };
  });
}

/** HMAC-SHA512 (hex) via the Web Crypto API — never leaves the device. */
async function hmacSha512Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Indodax's TAPI always answers with HTTP 200, even for auth failures, and
 * includes a machine-readable `error_code` alongside the human `error`
 * string (confirmed by direct calls to https://indodax.com/tapi):
 *   - bad/unknown Key           -> error_code "invalid_credentials"
 *   - missing/mismatched Sign   -> error_code "sign_not_found" / "invalid_sign"
 * Prefer `error_code` (stable) over fuzzy-matching the human message, and
 * only fall back to keyword matching on `error` when `error_code` is absent
 * or unrecognized — this avoids collapsing every failure into "server".
 */
function classifyErrorMessage(errorCode: string | undefined, message: string | undefined): IndodaxConnectionFailureReason {
  const code = (errorCode ?? "").toLowerCase();
  if (code.includes("sign")) return "invalid_sign";
  if (code.includes("credential") || code.includes("key")) return "invalid_key";

  const m = (message ?? "").toLowerCase();
  if (m.includes("sign")) return "invalid_sign";
  if (m.includes("key") || m.includes("credential")) return "invalid_key";

  return "server";
}

type TapiResponse = {
  success?: number | string;
  error?: string;
  error_code?: string;
  return?: Record<string, unknown>;
};

type PrivateApiOutcome =
  | { success: true; json: TapiResponse }
  | { success: false; reason: IndodaxConnectionFailureReason; detail?: string };

/**
 * Low-level, read-only POST to Indodax's TAPI. Shared by every private-API
 * call in this module (connection test, trade history) so the network/error
 * handling (native vs. dev proxy, timeouts, HTTP-status edge cases) lives in
 * exactly one place. This function only ever sends the method + params the
 * caller supplies — it never performs buy/sell/withdraw itself.
 */
/** Endpoint resmi Indodax Private API (TAPI). */
const TAPI_URL = "https://indodax.com/tapi";

/**
 * Mengekstrak teks mentah dari respons CapacitorHttp.
 * CapacitorHttp kadang mengembalikan response.data sebagai object yang sudah
 * di-parse (bukan string), tergantung Content-Type server. Fungsi ini
 * menormalkan berbagai kemungkinan tipe ke string.
 */
function extractRawText(data: unknown): string {
  if (data === null || data === undefined) return "";
  if (typeof data === "string") return data;
  try {
    return JSON.stringify(data);
  } catch {
    return String(data);
  }
}

async function callPrivateApi(
  apiKey: string,
  secretKey: string,
  params: Record<string, string>,
  timeoutMs: number
): Promise<PrivateApiOutcome> {
  // Bangun body sesuai format resmi Indodax TAPI:
  // method=<method>&nonce=<nonce>&<param1>=<val1>&...
  // Nonce diletakkan setelah method agar mudah dibaca di log.
  const { method, ...rest } = params;
  const nonce = Date.now().toString();
  const body = new URLSearchParams({ method, nonce, ...rest }).toString();

  let sign: string;
  try {
    sign = await hmacSha512Hex(secretKey, body);
  } catch {
    return { success: false, reason: "server", detail: "Gagal membuat signature HMAC-SHA512" };
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    // Header Indodax: Key = API Key, Sign = HMAC-SHA512(body, secretKey)
    Key: apiKey,
    Sign: sign,
  };

  // ── LOGGING: request ───────────────────────────────────────────────────────
  const keyPreview = apiKey.length > 10
    ? `${apiKey.slice(0, 6)}...${apiKey.slice(-4)}`
    : "(key pendek)";
  const signPreview = `${sign.slice(0, 12)}...${sign.slice(-8)}`;
  console.log("[IndodaxTAPI] ── Request ──────────────────────────────");
  console.log("[IndodaxTAPI] URL    :", isNativePlatform ? TAPI_URL : "/indodax/tapi (dev proxy)");
  console.log("[IndodaxTAPI] Method : POST");
  console.log("[IndodaxTAPI] Body   :", body);
  console.log("[IndodaxTAPI] Headers:");
  console.log("[IndodaxTAPI]   Content-Type:", headers["Content-Type"]);
  console.log("[IndodaxTAPI]   Key         :", keyPreview);
  console.log("[IndodaxTAPI]   Sign        :", signPreview);
  // ──────────────────────────────────────────────────────────────────────────

  try {
    let status: number;
    let rawText: string;

    if (isNativePlatform) {
      let response: { status: number; data: unknown };
      try {
        response = await CapacitorHttp.post({
          url: TAPI_URL,
          headers,
          // Mengirim body sebagai string URL-encoded yang SUDAH ditandatangani.
          // Tidak menggunakan object agar urutan parameter tidak berubah dan
          // signature tetap valid.
          data: body,
          connectTimeout: timeoutMs,
          readTimeout: timeoutMs,
        });
      } catch (nativeErr) {
        // CapacitorHttp melempar exception untuk kegagalan DNS/koneksi/timeout
        // (bukan mengembalikan response dengan status error).
        const msg = nativeErr instanceof Error ? nativeErr.message : String(nativeErr);
        console.log("[IndodaxTAPI] Native HTTP exception:", msg);
        return { success: false, reason: "network", detail: msg };
      }
      status = response.status;
      rawText = extractRawText(response.data);

      // ── LOGGING: response (native) ─────────────────────────────────────────
      console.log("[IndodaxTAPI] ── Response ─────────────────────────────────");
      console.log("[IndodaxTAPI] HTTP Status:", status);
      console.log("[IndodaxTAPI] Body (500 char):", rawText.slice(0, 500));
      // ────────────────────────────────────────────────────────────────────────
    } else {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(new Error("Timeout")), timeoutMs);
      try {
        const res = await fetch("/indodax/tapi", {
          method: "POST",
          headers,
          body,
          signal: ctrl.signal,
        });
        status = res.status;
        rawText = await res.text();

        // ── LOGGING: response (web/proxy) ──────────────────────────────────
        console.log("[IndodaxTAPI] ── Response ─────────────────────────────────");
        console.log("[IndodaxTAPI] HTTP Status:", status);
        console.log("[IndodaxTAPI] Body (500 char):", rawText.slice(0, 500));
        // ────────────────────────────────────────────────────────────────────
      } finally {
        clearTimeout(tid);
      }
    }

    let json: TapiResponse | null = null;
    try {
      json = rawText.trim() ? JSON.parse(rawText) as TapiResponse : null;
    } catch {
      json = null;
    }

    // ── Klasifikasi status HTTP ────────────────────────────────────────────
    // Indodax TAPI selalu menjawab dengan HTTP 200 bahkan untuk auth failure
    // (dikodekan dalam success:0). Status non-200 hampir selalu infrastruktur.
    if (status === 404) {
      // Kemungkinan: URL berubah, izin API Key tidak mencakup method ini,
      // atau request tidak sampai ke TAPI handler Indodax (misal: body kosong).
      console.warn(
        "[IndodaxTAPI] HTTP 404 — endpoint tidak ditemukan atau method tidak diizinkan.",
        "Pastikan API Key memiliki izin Trade History di pengaturan akun Indodax.",
        "Body yang dikirim:", body,
      );
      return {
        success: false,
        reason: "server",
        detail: "HTTP 404 — pastikan API Key memiliki izin Trade History di pengaturan Indodax",
      };
    }
    if (status >= 500) {
      return { success: false, reason: "server", detail: `HTTP ${status} — server Indodax bermasalah` };
    }
    if (status >= 400) {
      const detail = json
        ? (json.error ?? json.error_code ?? `HTTP ${status}`)
        : `HTTP ${status}`;
      return {
        success: false,
        reason: status === 401 || status === 403 ? "invalid_key" : "server",
        detail: String(detail),
      };
    }
    // ──────────────────────────────────────────────────────────────────────

    if (!json) {
      return { success: false, reason: "server", detail: "Respons tidak valid dari server (bukan JSON)" };
    }

    if (Number(json.success) === 1) {
      return { success: true, json };
    }

    const reason = classifyErrorMessage(json.error_code, json.error);
    console.warn("[IndodaxTAPI] API error:", { error_code: json.error_code, error: json.error, reason });
    return { success: false, reason, detail: json.error ?? json.error_code };
  } catch (err) {
    if (err instanceof Error && (err.name === "AbortError" || /timeout/i.test(err.message))) {
      return { success: false, reason: "network", detail: "Timeout" };
    }
    if (err instanceof TypeError) {
      // fetch melempar TypeError ("Failed to fetch") saat tidak ada koneksi.
      return { success: false, reason: "network", detail: err.message };
    }
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[IndodaxTAPI] Unexpected error:", err);
    return { success: false, reason: "server", detail: msg };
  }
}

/**
 * Calls the Indodax `getInfo` private endpoint solely to confirm the
 * credentials authenticate. The balance/address fields present in the raw
 * response are intentionally ignored and never returned from this function.
 */
export async function testIndodaxConnection(
  apiKey: string,
  secretKey: string,
  timeoutMs = 10000
): Promise<IndodaxConnectionResult> {
  if (!apiKey) {
    return { success: false, reason: "invalid_key", detail: "API Key kosong" };
  }
  if (!secretKey) {
    return { success: false, reason: "invalid_sign", detail: "Secret Key kosong" };
  }

  const outcome = await callPrivateApi(apiKey, secretKey, { method: "getInfo" }, timeoutMs);
  if (!outcome.success) {
    return outcome;
  }
  const serverTime = Number((outcome.json.return?.server_time as number | undefined) ?? Date.now() / 1000);
  return { success: true, serverTime };
}

// ─────────────────────────────────────────────────────────────────────────────
// Indodax Trade API v2  (GET https://tapi.indodax.com/api/v2/myTrades)
//
// As of April 7th, 2026 Indodax decommissioned the TAPI `tradeHistory` method.
// The replacement is a dedicated REST endpoint on a different base URL with:
//   • GET (not POST)
//   • X-APIKEY header (not Key)
//   • Sign = HMAC-SHA512(secretKey, queryString)  — not over the POST body
//   • Accept: application/json  (mandatory per docs)
//   • timestamp parameter in the query string for auth (max 7-day time windows)
//   • Response: { data: [...] } with fields tradeId, orderId, symbol,
//               price, qty, commission, isBuyer, isMaker, time (ms)
// ─────────────────────────────────────────────────────────────────────────────

const TRADE_API_V2_BASE = "https://tapi.indodax.com";

type V2ApiOutcome =
  | { success: true; data: unknown[] }
  | { success: false; reason: IndodaxConnectionFailureReason; detail?: string };

// ── Clock sync ──────────────────────────────────────────────────────────────
// Android device clocks can drift from real time (confirmed via logcat: a
// real device produced "Invalid timestamp... outside of the recvWindow"
// even though the app's own clock logic was correct). The v2 API rejects a
// request if `timestamp >= serverTime + 1000` (per Indodax's documented
// timing-security formula) — only ~1 second of future skew is tolerated.
//
// IMPORTANT: `tapi.indodax.com` (the v2 trade API host) can run on a
// different clock than `indodax.com` (the public site). An earlier attempt
// synced against `indodax.com/api/server_time` and still failed, proving the
// two hosts aren't necessarily time-aligned. The fix is to read the clock
// from `tapi.indodax.com` ITSELF, via the standard HTTP `Date` response
// header — every HTTP server sends this, no auth required, and it reflects
// the exact host that will validate our signed requests.
// ────────────────────────────────────────────────────────────────────────────

let cachedServerTimeOffsetMs: number | null = null;
let cachedServerTimeOffsetAt = 0;
const SERVER_TIME_OFFSET_TTL_MS = 5 * 60 * 1000; // refresh every 5 minutes

function extractDateHeader(headers: unknown): string | undefined {
  if (!headers || typeof headers !== "object") return undefined;
  const rec = headers as Record<string, string>;
  // Header casing can vary (native plugin vs. fetch), so check common variants.
  return rec.date ?? rec.Date ?? rec.DATE;
}

/**
 * Strategi sinkronisasi jam dua lapis:
 *
 * Lapis 1 — Date header dari tapi.indodax.com:
 *   Setiap respons HTTP (termasuk 4xx) membawa header `Date` yang mencerminkan
 *   jam host yang sama yang akan memvalidasi request bertanda tangan kita.
 *   Ini adalah sumber terpercaya. Kita probe endpoint publik (tanpa auth) agar
 *   server pasti mengembalikan respons lengkap dengan header.
 *
 * Lapis 2 — JSON /api/server_time dari indodax.com:
 *   Jika probe lapis 1 gagal mendapat header Date (misalnya CapacitorHttp
 *   membuang header dari respons error, atau koneksi putus), kita ambil waktu
 *   dari endpoint JSON publik indodax.com yang selalu mengembalikan 200 + body.
 *   Clock dua host mungkin tidak identik, tapi biasanya hanya beda beberapa
 *   detik — masih jauh lebih baik daripada jam perangkat tanpa koreksi sama
 *   sekali. Lapis ini membuat offset tidak pernah nol kecuali benar-benar
 *   tidak ada koneksi sama sekali.
 *
 * Hasil offset di-cache 5 menit. Kegagalan tidak di-cache supaya percobaan
 * berikutnya langsung probe ulang.
 */
async function getIndodaxServerTimeOffsetMs(): Promise<number> {
  const now = Date.now();
  if (cachedServerTimeOffsetMs !== null && now - cachedServerTimeOffsetAt < SERVER_TIME_OFFSET_TTL_MS) {
    return cachedServerTimeOffsetMs;
  }

  // ── Lapis 1: Date header dari tapi.indodax.com ───────────────────────────
  try {
    const beforeFetch = Date.now();
    let dateHeader: string | undefined;

    if (isNativePlatform) {
      // Probe endpoint tanpa auth — server pasti merespons (bisa 400/401),
      // yang penting header Date ada di respons. Gunakan URL root agar tidak
      // ada routing yang membuang request sebelum server menyentuhnya.
      const response = await CapacitorHttp.get({
        url: `${TRADE_API_V2_BASE}/`,
        headers: { Accept: "application/json" },
        connectTimeout: 6000,
        readTimeout: 6000,
      });
      dateHeader = extractDateHeader(response.headers);
      // Jika root tidak memberi header Date, coba endpoint myTrades sebagai
      // fallback dalam lapis yang sama.
      if (!dateHeader) {
        const r2 = await CapacitorHttp.get({
          url: `${TRADE_API_V2_BASE}/api/v2/myTrades`,
          headers: { Accept: "application/json" },
          connectTimeout: 6000,
          readTimeout: 6000,
        });
        dateHeader = extractDateHeader(r2.headers);
      }
    } else {
      const res = await fetch(`/tapi-v2/api/v2/myTrades`, { headers: { Accept: "application/json" } });
      dateHeader = res.headers.get("date") ?? undefined;
    }

    if (!dateHeader) throw new Error("Header Date tidak ditemukan");

    const serverTimeMs = new Date(dateHeader).getTime();
    if (!Number.isFinite(serverTimeMs) || serverTimeMs <= 0) {
      throw new Error(`Header Date tidak valid: ${dateHeader}`);
    }

    const afterFetch = Date.now();
    const deviceMidpoint = (beforeFetch + afterFetch) / 2;
    const offset = serverTimeMs - deviceMidpoint;

    cachedServerTimeOffsetMs = offset;
    cachedServerTimeOffsetAt = now;
    console.log("[IndodaxV2] Clock sync (tapi Date header) offset =", Math.round(offset), "ms");
    return offset;
  } catch (err) {
    console.log("[IndodaxV2] Lapis 1 clock sync gagal:", err instanceof Error ? err.message : err);
  }

  // ── Lapis 2: JSON /api/server_time dari indodax.com ─────────────────────
  // Endpoint ini selalu 200 + { server_time: <unix detik> }, sehingga tidak
  // bergantung pada ketersediaan header Date. Clock-nya mungkin beda beberapa
  // detik dari tapi.indodax.com, tapi recvWindow yang kita sertakan di setiap
  // request (lihat callTradeApiV2Get) memberi toleransi yang cukup.
  try {
    const beforeFetch = Date.now();
    let serverTimeSec: number | undefined;

    if (isNativePlatform) {
      const response = await CapacitorHttp.get({
        url: "https://indodax.com/api/server_time",
        headers: { Accept: "application/json" },
        connectTimeout: 6000,
        readTimeout: 6000,
      });
      const body = typeof response.data === "object"
        ? response.data as Record<string, unknown>
        : (() => { try { return JSON.parse(response.data as string) as Record<string, unknown>; } catch { return null; } })();
      serverTimeSec = Number(body?.server_time);
    } else {
      const res = await fetch("/indodax/api/server_time");
      const body = await res.json() as Record<string, unknown>;
      serverTimeSec = Number(body?.server_time);
    }

    if (!serverTimeSec || !Number.isFinite(serverTimeSec) || serverTimeSec <= 0) {
      throw new Error("Nilai server_time tidak valid");
    }

    const afterFetch = Date.now();
    const deviceMidpoint = (beforeFetch + afterFetch) / 2;
    const serverTimeMs = serverTimeSec * 1000;
    const offset = serverTimeMs - deviceMidpoint;

    cachedServerTimeOffsetMs = offset;
    cachedServerTimeOffsetAt = now;
    console.log("[IndodaxV2] Clock sync (indodax.com server_time) offset =", Math.round(offset), "ms");
    return offset;
  } catch (err2) {
    console.log("[IndodaxV2] Lapis 2 clock sync gagal:", err2 instanceof Error ? err2.message : err2);
  }

  // Kedua lapis gagal — kembalikan offset terakhir yang diketahui (atau 0).
  // recvWindow di setiap request memberi bantalan ekstra terhadap sisa drift.
  console.log("[IndodaxV2] Semua lapis clock sync gagal, pakai offset terakhir:", cachedServerTimeOffsetMs ?? 0, "ms");
  return cachedServerTimeOffsetMs ?? 0;
}

/**
 * Low-level GET to Indodax Trade API v2. Signs the query string (not a POST
 * body), uses X-APIKEY header, and handles native vs. dev-proxy routing.
 * Read-only — never calls any mutating endpoint.
 */
async function callTradeApiV2Get(
  apiKey: string,
  secretKey: string,
  path: string,
  queryParams: Record<string, string>,
  timeoutMs: number
): Promise<V2ApiOutcome> {
  // v2 auth: timestamp goes in the query string; Sign = HMAC-SHA512(secretKey, queryString).
  //
  // recvWindow: besarnya jendela toleransi (ms) yang diberitahu ke server.
  //   Default server biasanya 5000 ms — terlalu sempit untuk perangkat yang
  //   jam-nya drift lebih dari 5 detik. Kita set 60 000 ms (60 detik) supaya
  //   sisa drift setelah koreksi offset tidak langsung ditolak sebagai
  //   "Invalid timestamp outside of the recvWindow".
  //   60 detik masih aman secara security (replay window relatif pendek) dan
  //   merupakan nilai umum di semua klien Binance-compatible.
  //
  // CLOCK_SAFETY_MARGIN_MS: dikurangi dari corrected timestamp agar timestamp
  //   yang dikirim selalu sedikit di belakang server "now", bukan di depannya.
  //   Server menolak timestamp > serverTime + 1000 ms, jadi kita pastikan
  //   tidak melampaui batas itu meski ada latensi jaringan kecil.
  const CLOCK_SAFETY_MARGIN_MS = 500;
  const RECV_WINDOW_MS = 60_000;
  const offsetMs = await getIndodaxServerTimeOffsetMs();
  const timestamp = Math.round(Date.now() + offsetMs - CLOCK_SAFETY_MARGIN_MS).toString();
  const allParams: Record<string, string> = {
    ...queryParams,
    timestamp,
    recvWindow: String(RECV_WINDOW_MS),
  };
  const queryString = new URLSearchParams(allParams).toString();

  let sign: string;
  try {
    sign = await hmacSha512Hex(secretKey, queryString);
  } catch {
    return { success: false, reason: "server", detail: "Gagal membuat signature HMAC-SHA512" };
  }

  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
    "X-APIKEY": apiKey,
    Sign: sign,
  };

  // ── LOGGING: request ──────────────────────────────────────────────────────
  const keyPreview = apiKey.length > 10
    ? `${apiKey.slice(0, 6)}...${apiKey.slice(-4)}`
    : "(key pendek)";
  console.log("[IndodaxV2] ── Request ────────────────────────────────────────");
  console.log("[IndodaxV2] URL    :", isNativePlatform
    ? `${TRADE_API_V2_BASE}${path}`
    : `/tapi-v2${path} (dev proxy)`);
  console.log("[IndodaxV2] Method : GET");
  console.log("[IndodaxV2] Query  :", queryString);
  console.log("[IndodaxV2] X-APIKEY:", keyPreview);
  // ─────────────────────────────────────────────────────────────────────────

  try {
    let status: number;
    let rawData: unknown;

    if (isNativePlatform) {
      // Attach query string to URL directly so CapacitorHttp doesn't reorder params
      // (which would break the signature computed on the exact queryString above).
      const fullUrl = `${TRADE_API_V2_BASE}${path}?${queryString}`;
      let response: { status: number; data: unknown };
      try {
        response = await CapacitorHttp.get({
          url: fullUrl,
          headers,
          connectTimeout: timeoutMs,
          readTimeout: timeoutMs,
        });
      } catch (nativeErr) {
        const msg = nativeErr instanceof Error ? nativeErr.message : String(nativeErr);
        console.log("[IndodaxV2] Native HTTP exception:", msg);
        return { success: false, reason: "network", detail: msg };
      }
      status = response.status;
      // CapacitorHttp may auto-parse JSON; normalise to the raw object.
      rawData = typeof response.data === "string"
        ? (() => { try { return JSON.parse(response.data as string); } catch { return null; } })()
        : response.data;
    } else {
      const proxyUrl = `/tapi-v2${path}?${queryString}`;
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(new Error("Timeout")), timeoutMs);
      try {
        const res = await fetch(proxyUrl, { method: "GET", headers, signal: ctrl.signal });
        status = res.status;
        rawData = await res.json().catch(() => null);
      } finally {
        clearTimeout(tid);
      }
    }

    // ── LOGGING: response ─────────────────────────────────────────────────
    console.log("[IndodaxV2] ── Response ───────────────────────────────────────");
    console.log("[IndodaxV2] HTTP Status:", status);
    console.log("[IndodaxV2] Data (preview):", JSON.stringify(rawData).slice(0, 400));
    // ─────────────────────────────────────────────────────────────────────

    if (status === 401) {
      return { success: false, reason: "invalid_key", detail: "API Key tidak valid atau sesi berakhir" };
    }
    if (status === 403) {
      return { success: false, reason: "invalid_sign", detail: "Signature tidak valid" };
    }
    if (status >= 400) {
      const errObj = rawData as { error?: string; code?: number } | null;
      const detail = errObj?.error ?? `HTTP ${status}`;
      return {
        success: false,
        reason: "server",
        detail: String(detail),
      };
    }

    const resp = rawData as { data?: unknown } | null;
    const dataArr = Array.isArray(resp?.data) ? resp!.data : [];
    return { success: true, data: dataArr };
  } catch (err) {
    if (err instanceof Error && (err.name === "AbortError" || /timeout/i.test(err.message))) {
      return { success: false, reason: "network", detail: "Timeout" };
    }
    if (err instanceof TypeError) {
      return { success: false, reason: "network", detail: err.message };
    }
    console.error("[IndodaxV2] Unexpected error:", err);
    return { success: false, reason: "server", detail: err instanceof Error ? err.message : "Unknown error" };
  }
}

/**
 * Maps a single raw entry from GET /api/v2/myTrades into the app-internal
 * IndodaxTradeHistoryEntry shape. Key differences from the old tradeHistory:
 *   • isBuyer (boolean) replaces type ("buy"/"sell")
 *   • qty replaces amount (base asset quantity)
 *   • commission replaces fee
 *   • time is in milliseconds (stored as ISO string; old API was seconds)
 */
function parseMyTradesEntry(t: Record<string, unknown>, symbol: string): IndodaxTradeHistoryEntry {
  const timeMs = Number(t.time ?? 0);

  // LOG DATA RAW UNTUK DEBUGGING FEE
  console.log("[IndodaxAPI-Raw] Transaction Data:", {
    tradeId: t.tradeId,
    symbol: t.symbol || symbol,
    isBuyer: t.isBuyer,
    price: t.price,
    qty: t.qty,
    amount: t.amount,
    commission: t.commission,
    fee: t.fee,
    total: t.total,
    quote: t.quote,
    funds: t.funds,
    cost: t.cost,
    time: t.time
  });

  return {
    tradeId: String(t.tradeId ?? ""),
    orderId: String(t.orderId ?? ""),
    pair: String(t.symbol ?? symbol),
    type: t.isBuyer === true ? "buy" : "sell",
    price: Number(t.price ?? 0),
    amount: Number(t.qty ?? 0),        // qty = base asset (BTC, ETH)
    fee: Number(t.commission ?? 0),    // Ambil mentah dari commission
    // Store as ISO string; convertTradeHistoryToPreview handles both ISO and
    // numeric-seconds strings, so no further change is needed downstream.
    date: timeMs > 0 ? new Date(timeMs).toISOString() : "",
  };
}

function parseMyTradesResponse(rawTrades: unknown[], symbol: string): IndodaxTradeHistoryEntry[] {
  return rawTrades.map(t => parseMyTradesEntry(t as Record<string, unknown>, symbol));
}

/**
 * Safety cap: max 7-day windows fetched per pair.
 * 104 windows × 7 days ≈ 2 years of history.
 */
const MAX_TRADE_HISTORY_PAGES = 104;
/** v2 API hard limit per request. */
const TRADE_HISTORY_PAGE_SIZE = 1000;
/** Max milliseconds per request window — v2 API enforces ≤ 7 days. */
const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Fetches one 7-day window of trade history via GET /api/v2/myTrades.
 * Used by fetchAllTradeHistoryForPair to page backwards through time.
 */
export async function getIndodaxTradeHistory(
  apiKey: string,
  secretKey: string,
  pair: string,
  options: { startTime?: number; endTime?: number; timeoutMs?: number } = {}
): Promise<IndodaxTradeHistoryResult> {
  const { startTime, endTime, timeoutMs = 15000 } = options;

  if (!apiKey) return { success: false, pair, reason: "invalid_key", detail: "API Key kosong" };
  if (!secretKey) return { success: false, pair, reason: "invalid_sign", detail: "Secret Key kosong" };

  const params: Record<string, string> = {
    symbol: pair,
    limit: String(TRADE_HISTORY_PAGE_SIZE),
    sort: "desc",
  };
  if (startTime !== undefined) params.startTime = String(startTime);
  if (endTime !== undefined)   params.endTime   = String(endTime);

  const outcome = await callTradeApiV2Get(apiKey, secretKey, "/api/v2/myTrades", params, timeoutMs);
  if (!outcome.success) {
    return { success: false, pair, reason: outcome.reason, detail: outcome.detail };
  }

  const trades = parseMyTradesResponse(outcome.data, pair);
  return { success: true, pair, trades, truncated: trades.length >= TRADE_HISTORY_PAGE_SIZE };
}

/**
 * Fetches the ENTIRE trade history for a pair by paging backwards through
 * time in 7-day windows (the maximum the v2 API allows per request).
 * Deduplicates on tradeId. Stops when a window returns zero trades.
 * If the safety cap (MAX_TRADE_HISTORY_PAGES) is hit, marks result as
 * truncated so callers never show a partial list as complete.
 */
async function fetchAllTradeHistoryForPair(
  apiKey: string,
  secretKey: string,
  pair: string
): Promise<IndodaxTradeHistoryResult> {
  const allTrades: IndodaxTradeHistoryEntry[] = [];
  const seenIds = new Set<string>();
  let truncated = false;

  // Fetch server-time offset once so all window boundaries (startTime/endTime)
  // align with the server's clock, not the device's. Using raw Date.now()
  // here caused every 7-day window to shift when the device clock was ahead of
  // or behind tapi.indodax.com, silently dropping trades at window edges and
  // triggering "outside of the recvWindow" rejections on devices whose clocks
  // were ahead of the server.
  //
  // The same offset is also used inside callTradeApiV2Get for the signed
  // `timestamp` query parameter — fetching it once here ensures both the auth
  // timestamp and the time-filter windows use the *same* server-clock reference.
  // eslint-disable-next-line no-await-in-loop
  const offsetMs = await getIndodaxServerTimeOffsetMs();
  // Start at server "now" and walk backwards one 7-day window at a time.
  let endTime = Math.round(Date.now() + offsetMs);

  for (let page = 0; page < MAX_TRADE_HISTORY_PAGES; page++) {
    const startTime = endTime - WINDOW_MS;

    // eslint-disable-next-line no-await-in-loop
    const result = await getIndodaxTradeHistory(apiKey, secretKey, pair, {
      startTime,
      endTime,
    });

    if (!result.success) {
      // Surface the error even if earlier pages succeeded — callers must know
      // the data may be incomplete rather than assuming it is the full history.
      if (allTrades.length > 0) {
        return { success: true, pair, trades: allTrades, truncated: true };
      }
      return result;
    }

    let newInThisPage = 0;
    for (const t of result.trades) {
      const id = t.tradeId || `${t.orderId}-${t.date}`;
      if (seenIds.has(id)) continue;
      seenIds.add(id);
      allTrades.push(t);
      newInThisPage++;
    }

    if (result.trades.length === 0 && newInThisPage === 0) {
      // Empty window → walked back past the first trade. Done.
      break;
    }

    if (result.truncated) {
      // This window hit the 1000-trade limit — some trades within the 7-day
      // window may be missing. Mark as truncated but keep going backward.
      truncated = true;
    }

    // Advance window backwards.
    endTime = startTime - 1;

    if (page === MAX_TRADE_HISTORY_PAGES - 1) {
      truncated = true; // Safety cap hit.
    }
  }

  return { success: true, pair, trades: allTrades, truncated };
}

/**
 * Reads the currently SAVED credentials (never unsaved form input) and
 * fetches the FULL trade history for the given pairs, purely for
 * preview/debug purposes. This function intentionally:
 *   - does NOT write to any application data (no localStorage/db writes),
 *   - does NOT compute cost basis, profit, DCA average, or balances,
 *   - does NOT call any mutating endpoint (buy/sell/withdraw/cancel).
 * The caller is expected to only display the returned preview.
 */
export async function syncIndodaxTradeHistoryPreview(
  apiKey: string,
  secretKey: string,
  pairs: string[] = ["btcidr", "ethidr"]
): Promise<IndodaxTradeHistoryResult[]> {
  const results: IndodaxTradeHistoryResult[] = [];
  for (const pair of pairs) {
    // Sequential, not parallel, to stay gentle on Indodax's rate limits for
    // a read-only preview action.
    // eslint-disable-next-line no-await-in-loop
    results.push(await fetchAllTradeHistoryForPair(apiKey, secretKey, pair));
  }
  return results;
}

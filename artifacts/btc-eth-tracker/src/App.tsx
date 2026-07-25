import { useState, useEffect, useCallback, useRef } from "react";
import { apiGetJson } from "./lib/httpClient";
import { Capacitor } from "@capacitor/core";
import { FileSaver } from "./lib/FileSaver";
import {
  useListTransactions,
  useImportTransactions,
  useCreateTransaction,
  useDeleteTransaction
} from "@workspace/api-client-react";
import { toast } from "sonner";
import { Toaster } from "./components/ui/sonner";
import { BiometricAuth } from "./lib/BiometricAuth";
import {
  testIndodaxConnection,
  syncIndodaxTradeHistoryPreview,
  convertTradeHistoryToPreview,
  type IndodaxConnectionFailureReason,
  type IndodaxTradeHistoryResult,
  type IndodaxPreviewTransaction,
} from "./lib/indodaxPrivateApi";

interface IndodaxPrice {
  last: number;
  buy: number;
  sell: number;
  high: number;
  low: number;
}

interface PriceState {
  btc: IndodaxPrice | null;
  eth: IndodaxPrice | null;
  loading: boolean;
  error: string | null;
  lastUpdated: Date | null;
}

const REFRESH_INTERVAL = 30_000;

async function fetchIndodaxTicker(pair: string): Promise<IndodaxPrice> {
  const data = await apiGetJson<{ ticker: Record<string, string> }>({
    proxyPath: `/indodax/api/ticker/${pair}`,
    absoluteUrl: `https://indodax.com/api/ticker/${pair}`,
    timeoutMs: 8000,
    init: { cache: "no-store" },
  });
  // Guard against Indodax returning an unexpected/empty payload (e.g. during
  // maintenance) so a missing/invalid `ticker` field produces a clear,
  // catchable error instead of a raw "Cannot read properties of undefined"
  // crash or a stuck "Memuat..." price.
  const t = data?.ticker;
  const price: IndodaxPrice = {
    last: parseFloat(t?.last),
    buy: parseFloat(t?.buy),
    sell: parseFloat(t?.sell),
    high: parseFloat(t?.high),
    low: parseFloat(t?.low),
  };
  if (!Number.isFinite(price.last) || price.last <= 0) {
    // Response parsed as JSON but doesn't contain a usable ticker (e.g.
    // upstream returned an unexpected shape) — surface a clear reason
    // rather than silently showing a stuck "Memuat..." price.
    throw new Error("Server sedang maintenance atau tidak dapat diakses");
  }
  return price;
}

function useIndodaxPrices() {
  const [state, setState] = useState<PriceState>({
    btc: null, eth: null, loading: true, error: null, lastUpdated: null,
  });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchPrices = useCallback(async () => {
    setState(prev => ({ ...prev, loading: true, error: null }));
    try {
      const [btc, eth] = await Promise.all([
        fetchIndodaxTicker("btcidr"),
        fetchIndodaxTicker("ethidr"),
      ]);
      setState({ btc, eth, loading: false, error: null, lastUpdated: new Date() });
    } catch (e) {
      setState(prev => ({
        ...prev,
        loading: false,
        error: e instanceof Error ? e.message : "Gagal mengambil harga",
      }));
    }
  }, []);

  useEffect(() => {
    fetchPrices();
    timerRef.current = setInterval(fetchPrices, REFRESH_INTERVAL);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [fetchPrices]);

  return { ...state, refetch: fetchPrices };
}

type Coin = "BTC" | "ETH";
type TransactionType = "BUY" | "SELL";

interface Transaction {
  id: string;
  date: string;
  type: TransactionType;
  coin: Coin;
  jumlahBeli: number;
  fee: number;
  hargaBeliPerCoin: number;
}

/**
 * Normalizes any date value coming from Indodax sync (full ISO datetime,
 * e.g. "2026-07-11T02:50:41.520Z") or manual entry (already "YYYY-MM-DD")
 * into a plain "YYYY-MM-DD" string before it's persisted as a Transaction.
 * Takes the date portion directly via regex when possible to avoid any
 * timezone shift from parsing through Date.
 */
function toDateOnlyString(value: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  if (match) return match[1];
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString().slice(0, 10);
}

const STORAGE_KEY = "btceth_transactions";
const INDODAX_API_STORAGE_KEY = "indodax_api_credentials";

function formatRp(n: number) {
  return `Rp ${Math.round(n).toLocaleString("id-ID")}`;
}

function formatNum(n: number) {
  return Math.round(n).toLocaleString("id-ID");
}

function formatCoin(n: number, coin: Coin) {
  if (coin === "BTC") return n.toFixed(8) + " BTC";
  // ETH: tampilkan hingga 8 desimal, tanpa pembulatan saat penyimpanan/kalkulasi.
  // Pembulatan tampilan (toFixed) hanya untuk presentasi; nilai n itu sendiri
  // (disimpan & dihitung) tetap presisi penuh.
  return n.toFixed(8) + " ETH";
}

/**
 * Menerima string apapun (sudah ada titik atau belum) → kembalikan string
 * berformat Rupiah dengan titik sebagai pemisah ribuan, misalnya "1.500.000".
 * Karakter non-digit selain titik diabaikan agar paste "1.074.991.000" maupun
 * "1074991000" keduanya menghasilkan tampilan yang sama.
 */
function formatIdrInput(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  return new Intl.NumberFormat("id-ID").format(Number(digits));
}

/**
 * Kebalikan formatIdrInput: hapus semua titik lalu parse ke number.
 * Mengembalikan NaN jika string kosong atau tidak valid.
 */
function parseIdrInput(formatted: string): number {
  const digits = formatted.replace(/\D/g, "");
  return digits ? Number(digits) : NaN;
}

function generateId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/**
 * Stable id for a transaction imported from Indodax Trade History. Using a
 * deterministic id (not `generateId()`) keeps re-syncing idempotent both in
 * the app's local transaction list and in the database (see the `/transactions/import`
 * endpoint, which skips rows whose id already exists).
 */
function indodaxTransactionId(t: IndodaxPreviewTransaction): string {
  return `indodax:${t.tradeId || `${t.orderId}-${t.date}`}`;
}

type TabType = "BTC" | "ETH" | "Dashboard";

const tabs: TabType[] = ["BTC", "ETH", "Dashboard"];

const BTC_COLOR = "#F7931A";
const ETH_COLOR = "#627EEA";
const ACCENT = "#64FFDA";

function BitcoinIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <circle cx="16" cy="16" r="16" fill={BTC_COLOR} fillOpacity="0.15" />
      <path d="M22 13.5c.3-2-1.2-3-3.3-3.7l.7-2.7-1.6-.4-.6 2.6c-.4-.1-.9-.2-1.4-.3l.6-2.6-1.6-.4-.7 2.7c-.4-.1-.7-.2-1-.2l-2.1-.5-.4 1.7s1.2.3 1.2.3c.7.2.8.7.8 1l-2 7.8c-.1.3-.4.7-1 .5 0 0-1.2-.3-1.2-.3l-.8 1.8 2 .5c.4.1.7.2 1 .3l-.7 2.7 1.6.4.7-2.7c.4.1.9.2 1.4.3l-.7 2.7 1.6.4.7-2.7c2.8.5 4.9.3 5.8-2.2.7-2-.1-3.2-1.5-3.9 1.1-.3 1.9-1 2.1-2.4zm-3.8 5.3c-.5 2-3.9 1-5 .7l.9-3.5c1.1.3 4.6.8 4.1 2.8zm.5-5.3c-.5 1.8-3.4.9-4.3.7l.8-3.2c.9.2 3.9.7 3.5 2.5z" fill={BTC_COLOR} />
    </svg>
  );
}

function EthereumIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <circle cx="16" cy="16" r="16" fill={ETH_COLOR} fillOpacity="0.15" />
      <path d="M16 5l-6.5 11.5L16 19.5l6.5-3L16 5z" fill={ETH_COLOR} />
      <path d="M9.5 16.5L16 27l6.5-10.5L16 19.5l-6.5-3z" fill={ETH_COLOR} fillOpacity="0.7" />
    </svg>
  );
}

function CodeIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={ACCENT} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  );
}

function TrashIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4h6v2" />
    </svg>
  );
}

function PlusIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function TrendUpIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
      <polyline points="17 6 23 6 23 12" />
    </svg>
  );
}

function TrendDownIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 18 13.5 8.5 8.5 13.5 1 6" />
      <polyline points="17 18 23 18 23 12" />
    </svg>
  );
}

function SettingsIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function KeyIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="7.5" cy="15.5" r="5.5" />
      <path d="M21 2l-9.6 9.6" />
      <path d="M15.5 7.5l3 3L22 7l-3-3" />
    </svg>
  );
}

function FingerprintIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12C2 6.47715 6.47715 2 12 2C17.5228 2 22 6.47715 22 12" />
      <path d="M5 15C5 8.37258 10.3726 3 17 3" />
      <path d="M11 21C7.13401 21 4 17.866 4 14" />
      <path d="M14 21C11.2386 21 9 18.7614 9 16" />
      <path d="M17 21C16.4477 21 16 20.5523 16 20C16 18.3431 14.6569 17 13 17" />
      <path d="M20 15C20 12.2386 17.7614 10 15 10C12.2386 10 10 12.2386 10 15" />
    </svg>
  );
}

function EyeIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a19.14 19.14 0 0 1 4.22-5.94M9.9 4.24A9.7 9.7 0 0 1 12 4c7 0 11 8 11 8a19.14 19.14 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

function CloseIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

interface FormState {
  date: string;
  coin: Coin;
  jumlahBeli: string;
  fee: string;
  hargaBeliPerCoin: string;
}

const today = () => new Date().toISOString().split("T")[0];

function TransactionForm({
  onAdd,
  defaultCoin,
}: {
  onAdd: (tx: Transaction) => void;
  defaultCoin?: Coin;
}) {
  const [form, setForm] = useState<FormState>({
    date: today(),
    coin: defaultCoin ?? "BTC",
    jumlahBeli: "",
    fee: "",
    hargaBeliPerCoin: "",
  });
  const [open, setOpen] = useState(false);

  const modalBersih =
    form.jumlahBeli && form.fee
      ? Math.max(0, parseIdrInput(form.jumlahBeli) - parseFloat(form.fee))
      : null;
  const koinDiterima =
    modalBersih && form.hargaBeliPerCoin && parseIdrInput(form.hargaBeliPerCoin) > 0
      ? modalBersih / parseIdrInput(form.hargaBeliPerCoin)
      : null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const jb = parseIdrInput(form.jumlahBeli);
    const fee = parseFloat(form.fee);
    const harga = parseIdrInput(form.hargaBeliPerCoin);
    if (!form.date || isNaN(jb) || isNaN(fee) || isNaN(harga) || harga <= 0) return;
    onAdd({
      id: generateId(),
      date: form.date,
      type: "BUY", // Form manual selalu BUY sesuai instruksi user
      coin: form.coin,
      jumlahBeli: jb,
      fee: fee,
      hargaBeliPerCoin: harga,
    });
    setForm({ date: today(), coin: defaultCoin ?? "BTC", jumlahBeli: "", fee: "", hargaBeliPerCoin: "" });
    setOpen(false);
  };

  const coinColor = form.coin === "BTC" ? BTC_COLOR : ETH_COLOR;

  return (
    <div style={{ marginBottom: "1.5rem" }}>
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            padding: "0.75rem 1.25rem",
            background: "var(--accent-dim)",
            border: "1px solid var(--border-strong)",
            borderRadius: "10px",
            color: "var(--accent)",
            fontFamily: "'Space Grotesk', sans-serif",
            fontWeight: 600,
            fontSize: "0.9rem",
            cursor: "pointer",
            transition: "all 0.2s",
            width: "100%",
            justifyContent: "center",
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLButtonElement).style.boxShadow = "var(--accent-glow)";
            (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--accent)";
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLButtonElement).style.boxShadow = "none";
            (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--border-strong)";
          }}
        >
          <PlusIcon /> Tambah Transaksi
        </button>
      ) : (
        <div className="fade-in" style={{
          background: "var(--card)",
          border: "1px solid var(--border-strong)",
          borderRadius: "14px",
          padding: "1.5rem",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem" }}>
            <h3 style={{ fontSize: "1rem", fontWeight: 600, color: "var(--accent)" }}>Transaksi Baru</h3>
            <button onClick={() => setOpen(false)} style={{
              background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: "1.3rem", lineHeight: 1
            }}>×</button>
          </div>
          <form onSubmit={handleSubmit}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
              <div>
                <label style={labelStyle}>Tanggal</label>
                <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                  style={inputStyle} required />
              </div>
              <div>
                <label style={labelStyle}>Coin</label>
                <select value={form.coin} onChange={e => setForm(f => ({ ...f, coin: e.target.value as Coin }))}
                  style={{ ...inputStyle, color: coinColor, fontWeight: 600 }}>
                  <option value="BTC">₿ Bitcoin (BTC)</option>
                  <option value="ETH">Ξ Ethereum (ETH)</option>
                </select>
              </div>
              <div>
                <label style={labelStyle}>Jumlah Beli (IDR)</label>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="1.000.000"
                  value={form.jumlahBeli}
                  onChange={e => setForm(f => ({ ...f, jumlahBeli: formatIdrInput(e.target.value) }))}
                  onPaste={e => {
                    e.preventDefault();
                    setForm(f => ({ ...f, jumlahBeli: formatIdrInput(e.clipboardData.getData("text")) }));
                  }}
                  style={inputStyle}
                  required
                />
              </div>
              <div>
                <label style={labelStyle}>Fee (IDR)</label>
                <input type="number" placeholder="1500" value={form.fee}
                  onChange={e => setForm(f => ({ ...f, fee: e.target.value }))}
                  style={inputStyle} required min="0" step="any" />
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <label style={labelStyle}>Harga Beli per Coin (IDR)</label>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="1.074.991.000"
                  value={form.hargaBeliPerCoin}
                  onChange={e => setForm(f => ({ ...f, hargaBeliPerCoin: formatIdrInput(e.target.value) }))}
                  onPaste={e => {
                    e.preventDefault();
                    setForm(f => ({ ...f, hargaBeliPerCoin: formatIdrInput(e.clipboardData.getData("text")) }));
                  }}
                  style={inputStyle}
                  required
                />
              </div>
            </div>

            {(modalBersih !== null || koinDiterima !== null) && (
              <div className="fade-in" style={{
                marginTop: "1rem",
                padding: "0.75rem 1rem",
                background: "var(--bg-2)",
                borderRadius: "8px",
                border: "1px solid var(--border)",
                display: "flex",
                gap: "1.5rem",
                flexWrap: "wrap",
              }}>
                {modalBersih !== null && (
                  <div>
                    <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginBottom: "2px" }}>Modal Bersih</div>
                    <div style={{ fontFamily: "'JetBrains Mono', monospace", color: "var(--accent)", fontSize: "0.88rem", fontWeight: 600 }}>
                      {formatRp(modalBersih)}
                    </div>
                  </div>
                )}
                {koinDiterima !== null && (
                  <div>
                    <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginBottom: "2px" }}>Koin Diterima</div>
                    <div style={{ fontFamily: "'JetBrains Mono', monospace", color: coinColor, fontSize: "0.88rem", fontWeight: 600 }}>
                      {formatCoin(koinDiterima, form.coin)}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div style={{ display: "flex", gap: "0.75rem", marginTop: "1.25rem" }}>
              <button type="submit" style={{
                flex: 1, padding: "0.75rem", background: "var(--accent)", color: "#0A192F",
                border: "none", borderRadius: "8px", fontFamily: "'Space Grotesk', sans-serif",
                fontWeight: 700, fontSize: "0.9rem", cursor: "pointer", transition: "opacity 0.2s",
              }}>
                Simpan Transaksi
              </button>
              <button type="button" onClick={() => setOpen(false)} style={{
                padding: "0.75rem 1.25rem", background: "transparent",
                border: "1px solid var(--border-strong)", borderRadius: "8px",
                color: "var(--text-muted)", fontFamily: "'Space Grotesk', sans-serif",
                cursor: "pointer",
              }}>
                Batal
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "0.78rem",
  fontWeight: 500,
  color: "var(--text-muted)",
  marginBottom: "0.35rem",
  letterSpacing: "0.03em",
  textTransform: "uppercase",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "0.65rem 0.85rem",
  background: "var(--input-bg)",
  border: "1px solid var(--border-strong)",
  borderRadius: "8px",
  color: "var(--text)",
  fontFamily: "'Space Grotesk', sans-serif",
  fontSize: "0.9rem",
  outline: "none",
  transition: "border-color 0.2s",
};

function TransactionTable({
  transactions,
  coin,
  onDelete,
}: {
  transactions: Transaction[];
  coin: Coin;
  onDelete: (id: string) => void;
}) {
  const filtered = transactions.filter(t => t.coin === coin).sort((a, b) => b.date.localeCompare(a.date));
  const coinColor = coin === "BTC" ? BTC_COLOR : ETH_COLOR;

  if (filtered.length === 0) {
    return (
      <div style={{
        textAlign: "center", padding: "3rem 1rem",
        color: "var(--text-muted)", fontSize: "0.9rem",
        background: "var(--card)", borderRadius: "14px",
        border: "1px dashed var(--border-strong)",
      }}>
        <div style={{ fontSize: "2rem", marginBottom: "0.5rem", opacity: 0.4 }}>
          {coin === "BTC" ? "₿" : "Ξ"}
        </div>
        Belum ada transaksi {coin}. Tambahkan transaksi pertama kamu!
      </div>
    );
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: "0 6px" }}>
        <thead>
          <tr>
            {["Tanggal", "Coin", "Jumlah Beli", "Fee", "Modal Bersih", "Koin Diterima", "Harga DCA", ""].map(h => (
              <th key={h} style={{
                padding: "0.5rem 0.85rem",
                textAlign: "left",
                fontSize: "0.72rem",
                fontWeight: 600,
                color: "var(--text-muted)",
                letterSpacing: "0.05em",
                textTransform: "uppercase",
                whiteSpace: "nowrap",
              }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filtered.map(tx => {
            const modalBersih = tx.jumlahBeli - tx.fee;
            const koinDiterima = tx.hargaBeliPerCoin > 0 ? modalBersih / tx.hargaBeliPerCoin : 0;
            const hargaDca = koinDiterima > 0 ? modalBersih / koinDiterima : 0;
            return (
              <tr key={tx.id} className="fade-in" style={{ transition: "all 0.2s" }}>
                {[
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "0.82rem" }}>{tx.date}</span>,
                  <span style={{ color: coinColor, fontWeight: 700, fontSize: "0.85rem" }}>
                    {coin === "BTC" ? "₿ BTC" : "Ξ ETH"}
                  </span>,
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "0.85rem" }}>{formatRp(tx.jumlahBeli)}</span>,
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "0.85rem", color: "#FF6B6B" }}>{formatRp(tx.fee)}</span>,
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "0.85rem", color: "var(--accent)", fontWeight: 600 }}>{formatRp(modalBersih)}</span>,
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "0.82rem", color: coinColor }}>{formatCoin(koinDiterima, coin)}</span>,
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "0.82rem" }}>{formatRp(hargaDca)}</span>,
                ].map((cell, i) => (
                  <td key={i} style={{
                    padding: "0.75rem 0.85rem",
                    background: "var(--card)",
                    borderTop: "1px solid var(--border)",
                    borderBottom: "1px solid var(--border)",
                    whiteSpace: "nowrap",
                    ...(i === 0 ? { borderLeft: "1px solid var(--border)", borderTopLeftRadius: "10px", borderBottomLeftRadius: "10px" } : {}),
                    ...(i === 6 ? { borderRight: "1px solid var(--border)", borderTopRightRadius: "10px", borderBottomRightRadius: "10px" } : {}),
                  }}>
                    {cell}
                  </td>
                ))}
                <td style={{
                  padding: "0.75rem 0.5rem 0.75rem 0",
                  background: "var(--card)",
                  borderTop: "1px solid var(--border)",
                  borderBottom: "1px solid var(--border)",
                  borderRight: "1px solid var(--border)",
                  borderTopRightRadius: "10px",
                  borderBottomRightRadius: "10px",
                }}>
                  <button
                    onClick={() => {
                      if (confirm("Hapus transaksi ini?")) onDelete(tx.id);
                    }}
                    style={{
                      background: "none", border: "none", cursor: "pointer",
                      color: "var(--text-muted)", padding: "0.25rem 0.5rem",
                      borderRadius: "6px", transition: "all 0.15s",
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = "#FF6B6B"; (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,107,107,0.1)"; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = "var(--text-muted)"; (e.currentTarget as HTMLButtonElement).style.background = "none"; }}
                    title="Hapus transaksi"
                  >
                    <TrashIcon />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CoinSummaryCard({ coin, transactions }: { coin: Coin; transactions: Transaction[] }) {
  const filtered = transactions.filter(t => t.coin === coin);
  const totalModal = filtered.reduce((s, t) => s + t.jumlahBeli, 0);
  const totalFee = filtered.reduce((s, t) => s + t.fee, 0);
  const totalModalBersih = totalModal - totalFee;
  const totalKoin = filtered.reduce((t, tx) => {
    const mb = tx.jumlahBeli - tx.fee;
    return t + (tx.hargaBeliPerCoin > 0 ? mb / tx.hargaBeliPerCoin : 0);
  }, 0);
  const dcaRata = totalKoin > 0 ? totalModalBersih / totalKoin : 0;
  const coinColor = coin === "BTC" ? BTC_COLOR : ETH_COLOR;
  const glowClass = coin === "BTC" ? "glow-btc" : "glow-eth";
  const textGlow = coin === "BTC" ? "text-glow-btc" : "text-glow-eth";

  return (
    <div style={{
      background: "var(--card)",
      border: `1px solid ${coin === "BTC" ? "rgba(247,147,26,0.25)" : "rgba(98,126,234,0.25)"}`,
      borderRadius: "14px",
      padding: "1.25rem",
      marginBottom: "1.5rem",
    }} className={`fade-in ${glowClass}`}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.65rem", marginBottom: "1rem" }}>
        {coin === "BTC" ? <BitcoinIcon size={24} /> : <EthereumIcon size={24} />}
        <span style={{ fontWeight: 700, fontSize: "1rem", color: coinColor }} className={textGlow}>
          Ringkasan {coin}
        </span>
        <span style={{
          marginLeft: "auto",
          background: coin === "BTC" ? "var(--btc-dim)" : "var(--eth-dim)",
          border: `1px solid ${coin === "BTC" ? "rgba(247,147,26,0.3)" : "rgba(98,126,234,0.3)"}`,
          borderRadius: "20px",
          padding: "0.2rem 0.75rem",
          fontSize: "0.78rem",
          fontWeight: 600,
          color: coinColor,
        }}>{filtered.length} transaksi</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "0.75rem" }}>
        {[
          { label: `Total ${coin}`, value: formatCoin(totalKoin, coin), highlight: true },
          { label: "DCA Rata-rata", value: formatRp(dcaRata) },
          { label: "Total Modal Bersih", value: formatRp(totalModalBersih) },
          { label: "Total Fee", value: formatRp(totalFee), danger: true },
        ].map(item => (
          <div key={item.label} style={{
            background: "var(--bg-2)",
            borderRadius: "10px",
            padding: "0.75rem 0.9rem",
          }}>
            <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginBottom: "0.3rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>
              {item.label}
            </div>
            <div style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "0.92rem",
              fontWeight: 700,
              color: item.highlight ? coinColor : item.danger ? "#FF6B6B" : "var(--text)",
            }}>
              {item.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RefreshIcon({ size = 16, spinning = false }: { size?: number; spinning?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      style={{ animation: spinning ? "spin 1s linear infinite" : "none" }}>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  );
}

function IndodaxLogo({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect width="24" height="24" rx="4" fill="#1E3A5F" />
      <text x="12" y="17" fontSize="12" fontWeight="800" textAnchor="middle" fill="#00C4FF" fontFamily="monospace">IX</text>
    </svg>
  );
}


function ModalOverlay({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        backdropFilter: "blur(2px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: "1rem",
        // Outer overlay scrolls so the card is always reachable even on very
        // small screens — without this, an overflowing card would be
        // inaccessible because the overlay is position:fixed.
        overflowY: "auto",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="fade-in"
        style={{
          width: "100%",
          maxWidth: "420px",
          // Limit card height to viewport so content never overflows the
          // fixed overlay.  Without maxHeight the card can grow taller than
          // the screen (e.g. after a trade-history sync returns many rows),
          // pushing the X button off-screen and making the page
          // non-scrollable (because the overlay is position:fixed).
          maxHeight: "calc(100dvh - 2rem)",
          display: "flex",
          flexDirection: "column",
          background: "var(--card)",
          border: "1px solid var(--border-strong)",
          borderRadius: "14px",
          padding: "1.25rem",
          boxShadow: "0 20px 50px rgba(0,0,0,0.5)",
          // Inner card scrolls independently so short modals stay centered
          // and tall ones (trade-history preview) are still fully accessible.
          overflowY: "auto",
        }}
      >
        {children}
      </div>
    </div>
  );
}

function ModalHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    // position:sticky keeps the X button pinned to the top of the scrollable
    // card so it's always reachable even when the content below is very long.
    // background matches the card so scrolled-under content is hidden cleanly.
    // marginBottom/paddingBottom reproduce the original 1rem gap below the header.
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      position: "sticky", top: "-1.25rem",   // -padding of parent card
      zIndex: 1,
      background: "var(--card)",
      marginTop: "-1.25rem", paddingTop: "1.25rem",
      marginBottom: "1rem", paddingBottom: "0.5rem",
      marginLeft: "-1.25rem", marginRight: "-1.25rem",
      paddingLeft: "1.25rem", paddingRight: "1.25rem",
    }}>
      <h2 style={{ fontSize: "1rem", fontWeight: 700, color: "var(--text)" }}>{title}</h2>
      <button
        onClick={onClose}
        aria-label="Tutup"
        style={{
          background: "var(--bg-2)",
          border: "1px solid var(--border-strong)",
          borderRadius: "8px",
          width: "30px", height: "30px",
          display: "flex", alignItems: "center", justifyContent: "center",
          color: "var(--text-muted)",
          cursor: "pointer",
        }}
      >
        <CloseIcon size={16} />
      </button>
    </div>
  );
}

function SettingsDialog({ onClose, onOpenIndodaxApi }: { onClose: () => void; onOpenIndodaxApi: () => void }) {
  const [bioEnabled, setBioEnabled] = useState(false);
  const isNative = Capacitor.isNativePlatform();

  useEffect(() => {
    if (isNative) {
      BiometricAuth.isBiometricEnabled().then(res => setBioEnabled(res.enabled));
    }
  }, [isNative]);

  const toggleBiometric = async (checked: boolean) => {
    if (!isNative) {
      toast.info("Fitur sidik jari hanya tersedia di Android");
      return;
    }
    try {
      await BiometricAuth.setBiometricEnabled({ enabled: checked });
      setBioEnabled(checked);
      toast.success(checked ? "Kunci sidik jari aktif" : "Kunci sidik jari dimatikan");
    } catch (e) {
      toast.error("Gagal mengubah pengaturan keamanan");
    }
  };

  return (
    <ModalOverlay onClose={onClose}>
      <ModalHeader title="Pengaturan" onClose={onClose} />

      {/* Tombol API Indodax */}
      <button
        onClick={onOpenIndodaxApi}
        style={{
          width: "100%",
          display: "flex", alignItems: "center", gap: "0.75rem",
          padding: "0.85rem 1rem",
          background: "var(--bg-2)",
          border: "1px solid var(--border-strong)",
          borderRadius: "10px",
          color: "var(--text)",
          fontFamily: "'Space Grotesk', sans-serif",
          fontWeight: 600, fontSize: "0.9rem",
          cursor: "pointer",
          textAlign: "left",
          marginBottom: "1rem"
        }}
        onMouseEnter={e => {
          (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(255,255,255,0.3)";
        }}
        onMouseLeave={e => {
          (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--border-strong)";
        }}
      >
        <span style={{
          width: "34px", height: "34px", borderRadius: "8px",
          background: "rgba(0,196,255,0.12)",
          display: "flex", alignItems: "center", justifyContent: "center",
          color: "#00C4FF", flexShrink: 0,
        }}>
          <KeyIcon size={17} />
        </span>
        <span style={{ flex: 1 }}>
          <span style={{ display: "block" }}>API Indodax</span>
          <span style={{ display: "block", fontSize: "0.75rem", fontWeight: 400, color: "var(--text-muted)", marginTop: "0.15rem" }}>
            Kelola API Key &amp; Secret Key Indodax
          </span>
        </span>
      </button>

      {/* Toggle Biometrik (Sidik Jari) */}
      <div
        style={{
          width: "100%",
          display: "flex", alignItems: "center", gap: "0.75rem",
          padding: "0.85rem 1rem",
          background: "var(--bg-2)",
          border: "1px solid var(--border-strong)",
          borderRadius: "10px",
          color: "var(--text)",
          fontFamily: "'Space Grotesk', sans-serif",
          fontWeight: 600, fontSize: "0.9rem",
        }}
      >
        <span style={{
          width: "34px", height: "34px", borderRadius: "8px",
          background: "rgba(100,255,218,0.1)",
          display: "flex", alignItems: "center", justifyContent: "center",
          color: "var(--accent)", flexShrink: 0,
        }}>
          <FingerprintIcon size={18} />
        </span>
        <span style={{ flex: 1 }}>
          <span style={{ display: "block" }}>Kunci Sidik Jari</span>
          <span style={{ display: "block", fontSize: "0.75rem", fontWeight: 400, color: "var(--text-muted)", marginTop: "0.15rem" }}>
            Amankan akses aplikasi
          </span>
        </span>
        <label className="switch" style={{ cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={bioEnabled}
            onChange={(e) => toggleBiometric(e.target.checked)}
            style={{ display: "none" }}
          />
          <div style={{
            width: "40px",
            height: "20px",
            background: bioEnabled ? "var(--accent)" : "var(--border-strong)",
            borderRadius: "20px",
            position: "relative",
            transition: "all 0.2s"
          }}>
            <div style={{
              width: "16px",
              height: "16px",
              background: "#fff",
              borderRadius: "50%",
              position: "absolute",
              top: "2px",
              left: bioEnabled ? "22px" : "2px",
              transition: "all 0.2s"
            }} />
          </div>
        </label>
      </div>
    </ModalOverlay>
  );
}

const indodaxInputStyle: React.CSSProperties = {
  width: "100%",
  padding: "0.7rem 0.85rem",
  background: "var(--bg-2)",
  border: "1px solid var(--border-strong)",
  borderRadius: "10px",
  color: "var(--text)",
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: "0.88rem",
  outline: "none",
};

type ConnectionTestState =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "success"; serverTime: number }
  | { state: "error"; message: string };

function readSavedIndodaxCredentials(): { apiKey: string; secretKey: string } | null {
  try {
    const raw = localStorage.getItem(INDODAX_API_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { apiKey?: string; secretKey?: string };
    if (!parsed.apiKey || !parsed.secretKey) return null;
    return { apiKey: parsed.apiKey, secretKey: parsed.secretKey };
  } catch {
    return null;
  }
}

type TradeHistoryPreviewState =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "done"; results: IndodaxTradeHistoryResult[] }
  | { state: "error"; message: string };

interface TradeHistoryPreviewSummary {
  countBtc: number;
  countEth: number;
  total: number;
  firstTrade: IndodaxPreviewTransaction | null;
  lastTrade: IndodaxPreviewTransaction | null;
}

/**
 * Pure data-shaping helper: converts raw trade-history results into the
 * app-shaped preview transactions plus a summary. Does NOT compute cost
 * basis, profit, DCA, or balances — only counts and min/max-by-date.
 */
function buildTradeHistoryPreview(results: IndodaxTradeHistoryResult[]): {
  transactions: IndodaxPreviewTransaction[];
  summary: TradeHistoryPreviewSummary;
} {
  const transactions: IndodaxPreviewTransaction[] = [];
  for (const result of results) {
    if (result.success) {
      transactions.push(...convertTradeHistoryToPreview(result.trades));
    }
  }

  // Urutkan berdasarkan tanggal agar "trade pertama" dan "trade terakhir"
  // pada ringkasan konsisten, terlepas dari urutan pengembalian API.
  const sorted = [...transactions].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const summary: TradeHistoryPreviewSummary = {
    countBtc: transactions.filter(t => t.coin === "BTC").length,
    countEth: transactions.filter(t => t.coin === "ETH").length,
    total: transactions.length,
    firstTrade: sorted.length > 0 ? sorted[0] : null,
    lastTrade: sorted.length > 0 ? sorted[sorted.length - 1] : null,
  };

  return { transactions: sorted, summary };
}

function connectionFailureMessage(reason: IndodaxConnectionFailureReason): string {
  switch (reason) {
    case "invalid_key":
      return "API Key tidak valid";
    case "invalid_sign":
      return "Secret Key salah";
    case "network":
      return "Koneksi internet bermasalah";
    case "server":
    default:
      return "API Indodax sedang bermasalah";
  }
}

type ImportStatus =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "done"; imported: number; skipped: number; skippedSell: number }
  | { state: "error"; message: string };

function IndodaxApiDialog({
  onClose,
  existingTransactionIds,
  onImportTransactions,
}: {
  onClose: () => void;
  existingTransactionIds: Set<string>;
  onImportTransactions: (txs: Transaction[]) => Promise<{ imported: number; skipped: number }>;
}) {
  const [apiKey, setApiKey] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testState, setTestState] = useState<ConnectionTestState>({ state: "idle" });
  const [historyState, setHistoryState] = useState<TradeHistoryPreviewState>({ state: "idle" });
  const [importStatus, setImportStatus] = useState<ImportStatus>({ state: "idle" });

  // Stable ref so the popstate handler below always calls the latest onClose
  // without being re-registered on every render.
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  // Android hardware back button handling.
  // Capacitor's WebView is a single-page app with no real history stack, so
  // Android's back button exits the app by default (WebView has nowhere to go
  // back to).  We push a synthetic history entry when this modal mounts so
  // the WebView has one entry to pop; that pop fires `popstate` in JS and we
  // intercept it to close the modal instead of exiting.
  // Cleanup: if the modal is closed via the X button (not back), we pop the
  // synthetic entry ourselves so history stays clean.
  useEffect(() => {
    history.pushState({ indodaxModal: true }, "");

    const handlePopState = () => {
      console.log("Close sync modal");
      console.log("isSyncing = false");
      onCloseRef.current();
    };
    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);
      // Pop the synthetic entry only if it's still there (i.e. the modal was
      // closed via X, not via back button which already popped it).
      if (window.history.state?.indodaxModal) {
        history.back();
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Wrapper so the X button / overlay tap also emits the same log as back.
  const handleClose = () => {
    console.log("Close sync modal");
    console.log("isSyncing = false");
    onClose();
  };

  useEffect(() => {
    try {
      const raw = localStorage.getItem(INDODAX_API_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { apiKey?: string; secretKey?: string };
        setApiKey(parsed.apiKey ?? "");
        setSecretKey(parsed.secretKey ?? "");
      }
    } catch {
      // ignore corrupt/missing local data
    }
  }, []);

  const handleSave = () => {
    // Disimpan hanya di penyimpanan lokal perangkat (localStorage).
    // Tidak dikirim ke server mana pun dan tidak di-hardcode ke source code.
    localStorage.setItem(
      INDODAX_API_STORAGE_KEY,
      JSON.stringify({ apiKey: apiKey.trim(), secretKey: secretKey.trim() })
    );
    setSaved(true);
    setTestState({ state: "idle" });
    setTimeout(() => setSaved(false), 2500);
  };

  const handleTestConnection = async () => {
    // Menggunakan hanya kredensial yang SUDAH TERSIMPAN di localStorage —
    // bukan nilai yang sedang diketik dan belum disimpan.
    const creds = readSavedIndodaxCredentials();
    if (!creds) {
      setTestState({ state: "error", message: "Simpan API Key & Secret Key terlebih dahulu" });
      return;
    }
    setTestState({ state: "loading" });
    const result = await testIndodaxConnection(creds.apiKey, creds.secretKey);
    if (result.success) {
      setTestState({ state: "success", serverTime: result.serverTime });
    } else {
      setTestState({ state: "error", message: connectionFailureMessage(result.reason) });
    }
  };

  const handleSyncTradeHistoryPreview = async () => {
    // Read-only preview only: menggunakan kredensial yang SUDAH TERSIMPAN,
    // tidak menulis ke localStorage/database, tidak menghitung modal/profit/
    // DCA/saldo, dan tidak pernah memanggil endpoint yang mengubah akun.
    const creds = readSavedIndodaxCredentials();
    if (!creds) {
      setHistoryState({ state: "error", message: "Simpan API Key & Secret Key terlebih dahulu" });
      return;
    }
    console.log("Sync started");
    setHistoryState({ state: "loading" });
    const results = await syncIndodaxTradeHistoryPreview(creds.apiKey, creds.secretKey);
    const totalTrades = results.reduce((n, r) => n + (r.success ? r.trades.length : 0), 0);
    console.log("Preview loaded", totalTrades, "trades across", results.length, "pair(s)");
    setHistoryState({ state: "done", results });
    setImportStatus({ state: "idle" });
  };

  const handleImportTradeHistory = async () => {
    if (historyState.state !== "done") return;
    const { transactions: preview } = buildTradeHistoryPreview(historyState.results);

    // Modal/profit/DCA hanya dihitung dari transaksi BELI (lihat interface
    // Transaction) — trade SELL tidak punya bentuk yang cocok dan TIDAK
    // diimpor agar Dashboard/Profit/DCA yang sudah ada tidak berubah.
    const buys = preview.filter(t => t.type === "BUY");
    const sells = preview.filter(t => t.type === "SELL");
    const allNew = [...buys, ...sells].filter(t => !existingTransactionIds.has(indodaxTransactionId(t)));
    const skippedSell = 0; // Sekarang SELL diimpor, jadi tidak di-skip

    if (allNew.length === 0) {
      setImportStatus({ state: "done", imported: 0, skipped: buys.length + sells.length, skippedSell });
      return;
    }

    setImportStatus({ state: "loading" });
    try {
      const txs: Transaction[] = allNew.map(t => ({
        id: indodaxTransactionId(t),
        date: t.date,
        type: t.type,
        coin: t.coin,
        jumlahBeli: t.jumlahBeli,
        fee: t.fee,
        hargaBeliPerCoin: t.hargaBeliPerCoin,
      }));
      const result = await onImportTransactions(txs);
      console.log("Import finished", { imported: result.imported, skipped: buys.length - result.imported, skippedSell });
      setImportStatus({
        state: "done",
        imported: result.imported,
        skipped: buys.length - result.imported,
        skippedSell,
      });
    } catch (e) {
      setImportStatus({
        state: "error",
        message: e instanceof Error ? e.message : "Gagal menyimpan transaksi ke database",
      });
    }
  };

  return (
    <ModalOverlay onClose={handleClose}>
      <ModalHeader title="API Indodax" onClose={handleClose} />
      <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "1rem", lineHeight: 1.5 }}>
        API Key dan Secret Key disimpan hanya di perangkat ini (local storage) dan tidak dikirim ke server mana pun.
      </p>

      <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, color: "var(--text-muted)", marginBottom: "0.4rem" }}>
        API Key
      </label>
      <input
        type="text"
        value={apiKey}
        onChange={e => setApiKey(e.target.value)}
        placeholder="Masukkan API Key"
        autoComplete="off"
        spellCheck={false}
        style={{ ...indodaxInputStyle, marginBottom: "1rem" }}
      />

      <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, color: "var(--text-muted)", marginBottom: "0.4rem" }}>
        Secret Key
      </label>
      <div style={{ position: "relative", marginBottom: "1.25rem" }}>
        <input
          type={showSecret ? "text" : "password"}
          value={secretKey}
          onChange={e => setSecretKey(e.target.value)}
          placeholder="Masukkan Secret Key"
          autoComplete="off"
          spellCheck={false}
          style={{ ...indodaxInputStyle, paddingRight: "2.5rem" }}
        />
        <button
          type="button"
          onClick={() => setShowSecret(s => !s)}
          aria-label={showSecret ? "Sembunyikan Secret Key" : "Tampilkan Secret Key"}
          style={{
            position: "absolute",
            right: "0.6rem",
            top: "50%",
            transform: "translateY(-50%)",
            background: "none",
            border: "none",
            color: "var(--text-muted)",
            cursor: "pointer",
            padding: "0.2rem",
            display: "flex",
          }}
        >
          {showSecret ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
        </button>
      </div>

      <button
        onClick={handleSave}
        style={{
          width: "100%",
          padding: "0.8rem 1rem",
          background: saved ? "rgba(100,255,218,0.12)" : "var(--accent-dim)",
          border: `1px solid ${saved ? "rgba(100,255,218,0.4)" : "var(--border-strong)"}`,
          borderRadius: "10px",
          color: saved ? "var(--profit)" : "var(--accent)",
          fontFamily: "'Space Grotesk', sans-serif",
          fontWeight: 700, fontSize: "0.9rem",
          cursor: "pointer",
          marginBottom: "0.75rem",
        }}
      >
        {saved ? "✓ Tersimpan" : "Simpan"}
      </button>

      <button
        onClick={handleTestConnection}
        disabled={testState.state === "loading"}
        style={{
          width: "100%",
          padding: "0.8rem 1rem",
          background: "var(--bg-2)",
          border: "1px solid var(--border-strong)",
          borderRadius: "10px",
          color: "var(--text)",
          fontFamily: "'Space Grotesk', sans-serif",
          fontWeight: 700, fontSize: "0.9rem",
          cursor: testState.state === "loading" ? "not-allowed" : "pointer",
          opacity: testState.state === "loading" ? 0.7 : 1,
        }}
      >
        {testState.state === "loading" ? "Menghubungkan..." : "Tes Koneksi"}
      </button>

      {testState.state === "success" && (
        <div className="fade-in" style={{
          marginTop: "0.85rem",
          padding: "0.65rem 1rem",
          borderRadius: "8px",
          fontSize: "0.85rem",
          fontWeight: 500,
          background: "rgba(100,255,218,0.08)",
          border: "1px solid rgba(100,255,218,0.3)",
          color: "var(--profit)",
        }}>
          <div>🟢 Terhubung ke Indodax</div>
          <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
            Sinkron terakhir: {new Date(testState.serverTime * 1000).toLocaleString("id-ID")}
          </div>
        </div>
      )}

      {testState.state === "error" && (
        <div className="fade-in" style={{
          marginTop: "0.85rem",
          padding: "0.65rem 1rem",
          borderRadius: "8px",
          fontSize: "0.85rem",
          fontWeight: 500,
          background: "rgba(255,107,107,0.08)",
          border: "1px solid rgba(255,107,107,0.3)",
          color: "var(--loss)",
        }}>
          🔴 {testState.message}
        </div>
      )}

      <div style={{ marginTop: "1.5rem", paddingTop: "1.25rem", borderTop: "1px solid var(--border-strong)" }}>
        <div style={{ fontSize: "0.78rem", fontWeight: 600, color: "var(--text-muted)", marginBottom: "0.5rem" }}>
          Trade History
        </div>
        <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.75rem", lineHeight: 1.5 }}>
          Ambil riwayat trade dari Indodax untuk ditinjau, lalu impor trade BELI ke transaksi aplikasi
          (tersimpan di perangkat ini dan di database). Trade JUAL belum didukung oleh Dashboard/Profit/DCA
          sehingga tidak diimpor.
        </p>
        <button
          onClick={handleSyncTradeHistoryPreview}
          disabled={historyState.state === "loading"}
          style={{
            width: "100%",
            padding: "0.8rem 1rem",
            background: "var(--bg-2)",
            border: "1px solid var(--border-strong)",
            borderRadius: "10px",
            color: "var(--text)",
            fontFamily: "'Space Grotesk', sans-serif",
            fontWeight: 700, fontSize: "0.9rem",
            cursor: historyState.state === "loading" ? "not-allowed" : "pointer",
            opacity: historyState.state === "loading" ? 0.7 : 1,
          }}
        >
          {historyState.state === "loading" ? "Mengambil Trade History..." : "Sinkron Trade History (Preview)"}
        </button>

        {historyState.state === "error" && (
          <div className="fade-in" style={{
            marginTop: "0.85rem",
            padding: "0.65rem 1rem",
            borderRadius: "8px",
            fontSize: "0.85rem",
            fontWeight: 500,
            background: "rgba(255,107,107,0.08)",
            border: "1px solid rgba(255,107,107,0.3)",
            color: "var(--loss)",
          }}>
            🔴 {historyState.message}
          </div>
        )}

        {historyState.state === "done" && (() => {
          const failed = historyState.results.filter(r => !r.success);
          const truncatedPairs = historyState.results.filter(r => r.success && r.truncated).map(r => r.pair);
          const { transactions, summary } = buildTradeHistoryPreview(historyState.results);
          return (
            <div className="fade-in" style={{ marginTop: "0.85rem" }}>
              {truncatedPairs.length > 0 && (
                <div style={{
                  marginBottom: "0.75rem",
                  padding: "0.6rem 0.85rem",
                  borderRadius: "8px",
                  border: "1px solid rgba(255,193,7,0.35)",
                  background: "rgba(255,193,7,0.08)",
                  fontSize: "0.75rem",
                  color: "#ffc107",
                }}>
                  ⚠️ Riwayat untuk {truncatedPairs.join(", ").toUpperCase()} mungkin belum lengkap (terlalu banyak data untuk diambil sekaligus). Preview di bawah hanya mencakup data yang berhasil diambil.
                </div>
              )}
              {failed.map(result => (
                <div
                  key={result.pair}
                  style={{
                    marginBottom: "0.75rem",
                    padding: "0.65rem 0.85rem",
                    borderRadius: "8px",
                    border: "1px solid rgba(255,107,107,0.3)",
                    background: "rgba(255,107,107,0.08)",
                    fontSize: "0.78rem",
                    color: "var(--loss)",
                  }}
                >
                  🔴 {result.pair.toUpperCase()}: {connectionFailureMessage(result.reason)}
                </div>
              ))}

              <div style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "0.5rem",
                marginBottom: "0.85rem",
                padding: "0.75rem 0.85rem",
                borderRadius: "8px",
                border: "1px solid var(--border-strong)",
                background: "var(--bg-2)",
              }}>
                <div>
                  <div style={{ fontSize: "0.68rem", color: "var(--text-muted)" }}>TRANSAKSI BTC</div>
                  <div style={{ fontSize: "0.9rem", fontWeight: 700, color: "var(--text)" }}>{summary.countBtc}</div>
                </div>
                <div>
                  <div style={{ fontSize: "0.68rem", color: "var(--text-muted)" }}>TRANSAKSI ETH</div>
                  <div style={{ fontSize: "0.9rem", fontWeight: 700, color: "var(--text)" }}>{summary.countEth}</div>
                </div>
                <div>
                  <div style={{ fontSize: "0.68rem", color: "var(--text-muted)" }}>TOTAL TRANSAKSI</div>
                  <div style={{ fontSize: "0.9rem", fontWeight: 700, color: "var(--accent)" }}>{summary.total}</div>
                </div>
                <div />
                <div style={{ gridColumn: "1 / -1" }}>
                  <div style={{ fontSize: "0.68rem", color: "var(--text-muted)" }}>TRADE PERTAMA</div>
                  <div style={{ fontSize: "0.75rem", color: "var(--text)", fontFamily: "monospace" }}>
                    {summary.firstTrade
                      ? `${summary.firstTrade.type} ${summary.firstTrade.coin} · ${new Date(summary.firstTrade.date).toLocaleString("id-ID")}`
                      : "—"}
                  </div>
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <div style={{ fontSize: "0.68rem", color: "var(--text-muted)" }}>TRADE TERAKHIR</div>
                  <div style={{ fontSize: "0.75rem", color: "var(--text)", fontFamily: "monospace" }}>
                    {summary.lastTrade
                      ? `${summary.lastTrade.type} ${summary.lastTrade.coin} · ${new Date(summary.lastTrade.date).toLocaleString("id-ID")}`
                      : "—"}
                  </div>
                </div>
              </div>

              <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginBottom: "0.4rem" }}>
                Pratinjau hasil konversi (belum disimpan) — menampilkan {Math.min(transactions.length, 20)} dari {transactions.length} transaksi:
              </div>
              <div style={{ maxHeight: "220px", overflowY: "auto", border: "1px solid var(--border-strong)", borderRadius: "8px" }}>
                {transactions.length === 0 && (
                  <div style={{ padding: "0.65rem 0.85rem", fontSize: "0.78rem", color: "var(--text-muted)" }}>
                    Tidak ada trade ditemukan.
                  </div>
                )}
                {transactions.slice(0, 20).map(t => (
                  <div
                    key={t.tradeId || `${t.orderId}-${t.date}`}
                    style={{
                      fontSize: "0.7rem",
                      fontFamily: "monospace",
                      color: "var(--text-muted)",
                      padding: "0.35rem 0.6rem",
                      borderBottom: "1px dashed var(--border-strong)",
                    }}
                  >
                    <span style={{ color: t.type === "BUY" ? "var(--profit)" : "var(--loss)", fontWeight: 700 }}>{t.type}</span>
                    {" "}{t.coin} · {t.jumlahKoin.toFixed(8)} @ Rp {t.hargaBeliPerCoin.toLocaleString("id-ID")} ·
                    <span style={{ color: "var(--text)", fontWeight: 600 }}> Total Rp {t.jumlahBeli.toLocaleString("id-ID")}</span> (fee {t.fee}) · {t.pair} · id {t.tradeId} · {new Date(t.date).toLocaleString("id-ID")}
                  </div>
                ))}
              </div>

              <button
                onClick={handleImportTradeHistory}
                disabled={importStatus.state === "loading" || transactions.filter(t => t.type === "BUY").length === 0}
                style={{
                  width: "100%",
                  marginTop: "0.85rem",
                  padding: "0.8rem 1rem",
                  background: "var(--accent-dim)",
                  border: "1px solid var(--border-strong)",
                  borderRadius: "10px",
                  color: "var(--accent)",
                  fontFamily: "'Space Grotesk', sans-serif",
                  fontWeight: 700, fontSize: "0.9rem",
                  cursor: importStatus.state === "loading" ? "not-allowed" : "pointer",
                  opacity: importStatus.state === "loading" ? 0.7 : 1,
                }}
              >
                {importStatus.state === "loading"
                  ? "Mengimpor..."
                  : `Impor Trade BELI ke Transaksi Aplikasi (${transactions.filter(t => t.type === "BUY").length})`}
              </button>

              {importStatus.state === "error" && (
                <div className="fade-in" style={{
                  marginTop: "0.6rem",
                  padding: "0.6rem 0.85rem",
                  borderRadius: "8px",
                  fontSize: "0.78rem",
                  background: "rgba(255,107,107,0.08)",
                  border: "1px solid rgba(255,107,107,0.3)",
                  color: "var(--loss)",
                }}>
                  🔴 {importStatus.message}
                </div>
              )}

              {importStatus.state === "done" && (
                <div className="fade-in" style={{
                  marginTop: "0.6rem",
                  padding: "0.6rem 0.85rem",
                  borderRadius: "8px",
                  fontSize: "0.78rem",
                  background: "rgba(100,255,218,0.08)",
                  border: "1px solid rgba(100,255,218,0.3)",
                  color: "var(--profit)",
                  lineHeight: 1.6,
                }}>
                  ✓ {importStatus.imported} transaksi baru diimpor dan disimpan ke database.
                  {importStatus.skipped > 0 && <div>{importStatus.skipped} trade BELI dilewati (sudah pernah diimpor sebelumnya).</div>}
                  {importStatus.skippedSell > 0 && <div>{importStatus.skippedSell} trade JUAL dilewati (belum didukung).</div>}
                </div>
              )}
            </div>
          );
        })()}
      </div>
    </ModalOverlay>
  );
}

type ExportStatus = { state: "idle" } | { state: "loading" } | { state: "ok"; msg: string } | { state: "err"; msg: string };

/**
 * Logic lifecycle posisi:
 * Memproses transaksi secara kronologis. Jika setelah SELL saldo mencapai 0,
 * maka posisi dianggap CLOSED. Semua transaksi sebelum titik nol tersebut diabaikan.
 */
function filterActivePosition(txs: Transaction[]): Transaction[] {
  // 1. Urutkan kronologis (terlama ke terbaru)
  const sorted = [...txs].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  let activeStartIndex = 0;
  let runningBalance = 0;

  for (let i = 0; i < sorted.length; i++) {
    const tx = sorted[i];
    const modalBersih = tx.jumlahBeli - tx.fee;
    const amount = tx.hargaBeliPerCoin > 0 ? modalBersih / tx.hargaBeliPerCoin : 0;

    if (tx.type === "BUY") {
      runningBalance += amount;
    } else {
      runningBalance -= amount;
    }

    // Jika saldo koin mencapai 0 (atau sangat mendekati 0 karena floating point),
    // tandai bahwa transaksi berikutnya adalah awal posisi baru.
    if (runningBalance <= 0.00000001) {
      runningBalance = 0;
      activeStartIndex = i + 1;
    }
  }

  // Ambil hanya transaksi dari posisi aktif (hanya yang BUY untuk perhitungan DCA)
  return sorted.slice(activeStartIndex).filter(t => t.type === "BUY");
}

function DashboardTab({ transactions, onImport }: { transactions: Transaction[]; onImport: (txs: Transaction[]) => void }) {
  const { btc, eth, loading, error, lastUpdated, refetch } = useIndodaxPrices();
  const importRef = useRef<HTMLInputElement>(null);
  const [importMsg, setImportMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [exportStatus, setExportStatus] = useState<ExportStatus>({ state: "idle" });

  const handleExport = async () => {
    if (exportStatus.state === "loading") return;
    setExportStatus({ state: "loading" });

    const filename = `btceth-transaksi-${new Date().toISOString().slice(0, 10)}.json`;
    const payload = JSON.stringify(transactions, null, 2);

    try {
      if (Capacitor.isNativePlatform()) {
        // Android — buka file picker via Storage Access Framework (ACTION_CREATE_DOCUMENT).
        // User memilih sendiri folder dan nama file; tidak ada Share sheet.
        await FileSaver.saveFile({ filename, content: payload });
        setExportStatus({ state: "ok", msg: `Tersimpan — ${filename}` });
      } else {
        // Web — download langsung via anchor tag
        const url = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
        setExportStatus({ state: "ok", msg: `Export berhasil — ${filename}` });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // User menekan Back/batal di file picker — bukan error
      if (msg.toLowerCase().includes("cancel") || msg.toLowerCase().includes("abort")) {
        setExportStatus({ state: "idle" });
        return;
      }
      setExportStatus({ state: "err", msg: `Gagal: ${msg}` });
    } finally {
      // Auto-reset status setelah 5 detik
      setTimeout(() => setExportStatus({ state: "idle" }), 5000);
    }
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target?.result as string);
        if (!Array.isArray(parsed)) throw new Error("Format tidak valid");
        const valid = parsed.every(
          (t) =>
            typeof t.id === "string" &&
            typeof t.date === "string" &&
            (t.type === "BUY" || t.type === "SELL") &&
            (t.coin === "BTC" || t.coin === "ETH") &&
            typeof t.jumlahBeli === "number" &&
            typeof t.fee === "number" &&
            typeof t.hargaBeliPerCoin === "number"
        );
        if (!valid) throw new Error("Data tidak sesuai format");
        onImport(parsed as Transaction[]);
        setImportMsg({ text: `✓ ${parsed.length} transaksi berhasil diimpor`, ok: true });
      } catch (err) {
        setImportMsg({ text: `✗ Gagal: ${err instanceof Error ? err.message : "File tidak valid"}`, ok: false });
      }
      setTimeout(() => setImportMsg(null), 4000);
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const hargaBtc = btc?.last ?? 0;
  const hargaEth = eth?.last ?? 0;

  // GUNAKAN LOGIKA ACTIVE POSITION
  const btcTx = filterActivePosition(transactions.filter(t => t.coin === "BTC"));
  const ethTx = filterActivePosition(transactions.filter(t => t.coin === "ETH"));

  const totalBtc = btcTx.reduce((s, t) => {
    const mb = t.jumlahBeli - t.fee;
    return s + (t.hargaBeliPerCoin > 0 ? mb / t.hargaBeliPerCoin : 0);
  }, 0);
  const totalEth = ethTx.reduce((s, t) => {
    const mb = t.jumlahBeli - t.fee;
    return s + (t.hargaBeliPerCoin > 0 ? mb / t.hargaBeliPerCoin : 0);
  }, 0);

  const nilaiBtc = totalBtc * hargaBtc;
  const nilaiEth = totalEth * hargaEth;
  const totalAset = nilaiBtc + nilaiEth;
  const modalBersihBtc = btcTx.reduce((s, t) => s + (t.jumlahBeli - t.fee), 0);
  const modalBersihEth = ethTx.reduce((s, t) => s + (t.jumlahBeli - t.fee), 0);
  const totalModalBersih = modalBersihBtc + modalBersihEth;
  const profitBtc = nilaiBtc - modalBersihBtc;
  const profitEth = nilaiEth - modalBersihEth;
  const profit = totalAset - totalModalBersih;
  const isProfit = profit >= 0;
  const isProfitBtc = profitBtc >= 0;
  const isProfitEth = profitEth >= 0;
  const profitPct = totalModalBersih > 0 ? (profit / totalModalBersih) * 100 : 0;
  const profitBtcPct = modalBersihBtc > 0 ? (profitBtc / modalBersihBtc) * 100 : 0;
  const profitEthPct = modalBersihEth > 0 ? (profitEth / modalBersihEth) * 100 : 0;
  const hasPrices = hargaBtc > 0 && hargaEth > 0;

  const formatTime = (d: Date) =>
    d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  return (
    <div className="fade-in">
      {/* Live Price Card */}
      <div style={{
        background: "var(--card)",
        border: "1px solid var(--border-strong)",
        borderRadius: "14px",
        padding: "1.1rem 1.25rem",
        marginBottom: "1.25rem",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.9rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <IndodaxLogo size={18} />
            <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Harga Live · Indodax
            </span>
            {loading && (
              <span style={{ fontSize: "0.7rem", color: "var(--accent)", display: "flex", alignItems: "center", gap: "0.3rem" }}>
                <RefreshIcon size={12} spinning /> Memperbarui...
              </span>
            )}
            {error && (
              <span style={{ fontSize: "0.7rem", color: "#FF6B6B" }}>
                ⚠ {error}
              </span>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            {lastUpdated && (
              <span style={{ fontSize: "0.7rem", color: "var(--text-muted)", fontFamily: "'JetBrains Mono', monospace" }}>
                {formatTime(lastUpdated)}
              </span>
            )}
            <button
              onClick={refetch}
              disabled={loading}
              title="Refresh harga"
              style={{
                background: "var(--accent-dim)", border: "1px solid var(--border-strong)",
                borderRadius: "8px", padding: "0.3rem 0.55rem", cursor: loading ? "not-allowed" : "pointer",
                color: "var(--accent)", display: "flex", alignItems: "center", opacity: loading ? 0.5 : 1,
                transition: "all 0.2s",
              }}
            >
              <RefreshIcon size={14} spinning={loading} />
            </button>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
          {/* BTC Price */}
          <div className="card-box" style={{
            background: "var(--btc-dim)",
            border: "1px solid rgba(247,147,26,0.25)",
            borderRadius: "10px",
            padding: "0.75rem",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginBottom: "0.5rem" }}>
              <BitcoinIcon size={16} />
              <span style={{ fontSize: "0.72rem", color: "#F7931A", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>BTC / IDR</span>
            </div>
            {hargaBtc > 0 ? (
              <div className="price-row" style={{ color: BTC_COLOR }}>
                <span className="price-rp">Rp</span>
                <span className="price-num">{formatNum(hargaBtc)}</span>
              </div>
            ) : error && !loading ? (
              <div style={{ color: "#FF6B6B", fontSize: "0.75rem" }}>{error}</div>
            ) : (
              <div style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>Memuat...</div>
            )}
            {btc && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", marginTop: "0.4rem" }}>
                <span style={{ fontSize: "0.66rem", color: "var(--profit)", whiteSpace: "nowrap" }}>▲ {formatRp(btc.buy)}</span>
                <span style={{ fontSize: "0.66rem", color: "var(--loss)", whiteSpace: "nowrap" }}>▼ {formatRp(btc.sell)}</span>
              </div>
            )}
          </div>

          {/* ETH Price */}
          <div className="card-box" style={{
            background: "var(--eth-dim)",
            border: "1px solid rgba(98,126,234,0.25)",
            borderRadius: "10px",
            padding: "0.75rem",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginBottom: "0.5rem" }}>
              <EthereumIcon size={16} />
              <span style={{ fontSize: "0.72rem", color: ETH_COLOR, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>ETH / IDR</span>
            </div>
            {hargaEth > 0 ? (
              <div className="price-row" style={{ color: ETH_COLOR }}>
                <span className="price-rp">Rp</span>
                <span className="price-num">{formatNum(hargaEth)}</span>
              </div>
            ) : error && !loading ? (
              <div style={{ color: "#FF6B6B", fontSize: "0.75rem" }}>{error}</div>
            ) : (
              <div style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>Memuat...</div>
            )}
            {eth && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", marginTop: "0.4rem" }}>
                <span style={{ fontSize: "0.66rem", color: "var(--profit)", whiteSpace: "nowrap" }}>▲ {formatRp(eth.buy)}</span>
                <span style={{ fontSize: "0.66rem", color: "var(--loss)", whiteSpace: "nowrap" }}>▼ {formatRp(eth.sell)}</span>
              </div>
            )}
          </div>
        </div>
        <div style={{ marginTop: "0.6rem", fontSize: "0.68rem", color: "var(--text-muted)", textAlign: "right" }}>
          Auto-refresh setiap 30 detik
        </div>
      </div>

      {/* Asset Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "0.85rem", marginBottom: "1.25rem" }}>
        {[
          { label: "Total Bitcoin", value: formatCoin(totalBtc, "BTC"), color: BTC_COLOR, icon: <BitcoinIcon size={18} />, sub: hargaBtc > 0 ? `@ ${formatRp(hargaBtc)}` : "—" },
          { label: "Total Ethereum", value: formatCoin(totalEth, "ETH"), color: ETH_COLOR, icon: <EthereumIcon size={18} />, sub: hargaEth > 0 ? `@ ${formatRp(hargaEth)}` : "—" },
          { label: "Nilai BTC (Rp)", value: hasPrices ? formatRp(nilaiBtc) : "—", color: BTC_COLOR, icon: <BitcoinIcon size={18} /> },
          { label: "Nilai ETH (Rp)", value: hasPrices ? formatRp(nilaiEth) : "—", color: ETH_COLOR, icon: <EthereumIcon size={18} /> },
          { label: "Total Aset", value: hasPrices ? formatRp(totalAset) : "—", color: ACCENT, special: true },
          { label: "Total Modal Bersih", value: formatRp(totalModalBersih), color: "var(--text)" },
        ].map(card => (
          <div key={card.label} className="card-box card-pad" style={{
            background: "var(--card)",
            border: (card as {special?: boolean}).special ? "1px solid var(--border-strong)" : "1px solid var(--border)",
            borderRadius: "12px",
            boxShadow: (card as {special?: boolean}).special ? "var(--accent-glow)" : "none",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginBottom: "0.5rem" }}>
              {(card as {icon?: React.ReactNode}).icon && <span>{(card as {icon?: React.ReactNode}).icon}</span>}
              <span style={{ fontSize: "0.72rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>{card.label}</span>
            </div>
            <div className="card-val" style={{ color: card.color }}>
              {card.value}
            </div>
            {(card as {sub?: string}).sub && (
              <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
                {(card as {sub?: string}).sub}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Profit BTC & ETH Breakdown */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.85rem", marginBottom: "1.25rem" }}>
        {/* Profit BTC */}
        <div className="card-box card-pad" style={{
          background: !hasPrices || btcTx.length === 0 ? "var(--card)" : isProfitBtc ? "rgba(100,255,218,0.06)" : "rgba(255,107,107,0.06)",
          border: `1px solid ${!hasPrices || btcTx.length === 0 ? "rgba(247,147,26,0.2)" : isProfitBtc ? "rgba(100,255,218,0.25)" : "rgba(255,107,107,0.25)"}`,
          borderRadius: "12px",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginBottom: "0.6rem" }}>
            <BitcoinIcon size={16} />
            <span style={{ fontSize: "0.72rem", color: BTC_COLOR, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>
              Profit BTC
            </span>
          </div>
          <div className="card-val" style={{
            fontWeight: 800,
            color: !hasPrices || btcTx.length === 0 ? "var(--text-muted)" : isProfitBtc ? "var(--profit)" : "var(--loss)",
          }}>
            {!hasPrices ? "Memuat..." : btcTx.length === 0 ? "—" : `${isProfitBtc ? "+" : ""}${formatRp(profitBtc)}`}
          </div>
          {hasPrices && btcTx.length > 0 && (
            <div style={{
              display: "inline-flex", alignItems: "center", gap: "0.25rem",
              marginTop: "0.4rem",
              background: isProfitBtc ? "rgba(100,255,218,0.1)" : "rgba(255,107,107,0.1)",
              borderRadius: "20px", padding: "0.2rem 0.6rem",
              color: isProfitBtc ? "var(--profit)" : "var(--loss)",
              fontSize: "0.75rem", fontWeight: 700, fontFamily: "'JetBrains Mono', monospace",
            }}>
              {isProfitBtc ? <TrendUpIcon size={12} /> : <TrendDownIcon size={12} />}
              {isProfitBtc ? "+" : ""}{profitBtcPct.toFixed(2)}%
            </div>
          )}
        </div>

        {/* Profit ETH */}
        <div className="card-box card-pad" style={{
          background: !hasPrices || ethTx.length === 0 ? "var(--card)" : isProfitEth ? "rgba(100,255,218,0.06)" : "rgba(255,107,107,0.06)",
          border: `1px solid ${!hasPrices || ethTx.length === 0 ? "rgba(98,126,234,0.2)" : isProfitEth ? "rgba(100,255,218,0.25)" : "rgba(255,107,107,0.25)"}`,
          borderRadius: "12px",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginBottom: "0.6rem" }}>
            <EthereumIcon size={16} />
            <span style={{ fontSize: "0.72rem", color: ETH_COLOR, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>
              Profit ETH
            </span>
          </div>
          <div className="card-val" style={{
            fontWeight: 800,
            color: !hasPrices || ethTx.length === 0 ? "var(--text-muted)" : isProfitEth ? "var(--profit)" : "var(--loss)",
          }}>
            {!hasPrices ? "Memuat..." : ethTx.length === 0 ? "—" : `${isProfitEth ? "+" : ""}${formatRp(profitEth)}`}
          </div>
          {hasPrices && ethTx.length > 0 && (
            <div style={{
              display: "inline-flex", alignItems: "center", gap: "0.25rem",
              marginTop: "0.4rem",
              background: isProfitEth ? "rgba(100,255,218,0.1)" : "rgba(255,107,107,0.1)",
              borderRadius: "20px", padding: "0.2rem 0.6rem",
              color: isProfitEth ? "var(--profit)" : "var(--loss)",
              fontSize: "0.75rem", fontWeight: 700, fontFamily: "'JetBrains Mono', monospace",
            }}>
              {isProfitEth ? <TrendUpIcon size={12} /> : <TrendDownIcon size={12} />}
              {isProfitEth ? "+" : ""}{profitEthPct.toFixed(2)}%
            </div>
          )}
        </div>
      </div>

      {/* Profit / Loss */}
      <div style={{
        background: !hasPrices ? "var(--card)" : isProfit ? "rgba(100,255,218,0.07)" : "rgba(255,107,107,0.07)",
        border: `1px solid ${!hasPrices ? "var(--border)" : isProfit ? "rgba(100,255,218,0.3)" : "rgba(255,107,107,0.3)"}`,
        borderRadius: "14px",
        padding: "1.25rem 1.5rem",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: "0.75rem",
        boxShadow: !hasPrices ? "none" : isProfit ? "0 0 20px rgba(100,255,218,0.12)" : "0 0 20px rgba(255,107,107,0.08)",
      }}>
        <div>
          <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.35rem" }}>
            {!hasPrices ? "Profit / Loss" : isProfit ? "🚀 Total Profit" : "📉 Total Loss"}
          </div>
          <div className="card-val-profit" style={{
            color: !hasPrices ? "var(--text-muted)" : isProfit ? "var(--profit)" : "var(--loss)",
            textShadow: !hasPrices ? "none" : isProfit ? "0 0 20px rgba(100,255,218,0.5)" : "0 0 20px rgba(255,107,107,0.5)",
          }}>
            {!hasPrices ? "Menunggu harga..." : `${isProfit ? "+" : ""}${formatRp(profit)}`}
          </div>
        </div>
        {hasPrices && (
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: "0.4rem",
            background: isProfit ? "rgba(100,255,218,0.12)" : "rgba(255,107,107,0.12)",
            borderRadius: "30px",
            padding: "0.5rem 1rem",
            color: isProfit ? "var(--profit)" : "var(--loss)",
            fontWeight: 700,
            fontSize: "1rem",
            fontFamily: "'JetBrains Mono', monospace",
          }}>
            {isProfit ? <TrendUpIcon size={18} /> : <TrendDownIcon size={18} />}
            {isProfit ? "+" : ""}{profitPct.toFixed(2)}%
          </div>
        )}
      </div>

      {transactions.length === 0 && (
        <div style={{
          marginTop: "1.5rem",
          textAlign: "center",
          color: "var(--text-muted)",
          fontSize: "0.88rem",
          padding: "2rem",
          background: "var(--card)",
          borderRadius: "12px",
          border: "1px dashed var(--border-strong)",
        }}>
          Belum ada transaksi. Tambahkan transaksi di tab BTC atau ETH.
        </div>
      )}

      {/* Export / Import */}
      <div style={{ marginTop: "1.5rem", display: "flex", gap: "0.75rem" }}>
        <button
          onClick={handleExport}
          disabled={transactions.length === 0 || exportStatus.state === "loading"}
          style={{
            flex: 1,
            display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem",
            padding: "0.75rem 1rem",
            background: transactions.length === 0 || exportStatus.state === "loading"
              ? "var(--bg-2)"
              : exportStatus.state === "ok"
              ? "rgba(100,255,218,0.12)"
              : exportStatus.state === "err"
              ? "rgba(255,107,107,0.1)"
              : "var(--accent-dim)",
            border: `1px solid ${
              exportStatus.state === "ok" ? "rgba(100,255,218,0.4)"
              : exportStatus.state === "err" ? "rgba(255,107,107,0.4)"
              : "var(--border-strong)"
            }`,
            borderRadius: "10px",
            color: transactions.length === 0 || exportStatus.state === "loading"
              ? "var(--text-muted)"
              : exportStatus.state === "ok" ? "var(--profit)"
              : exportStatus.state === "err" ? "var(--loss)"
              : "var(--accent)",
            fontFamily: "'Space Grotesk', sans-serif",
            fontWeight: 600, fontSize: "0.88rem",
            cursor: transactions.length === 0 || exportStatus.state === "loading" ? "not-allowed" : "pointer",
            transition: "all 0.2s",
          }}
        >
          {exportStatus.state === "loading" ? (
            <>
              <svg width="14" height="14" viewBox="0 0 28 28" fill="none" style={{ animation: "spin 0.9s linear infinite", flexShrink: 0 }}>
                <circle cx="14" cy="14" r="11" stroke="rgba(100,255,218,0.2)" strokeWidth="2.5" />
                <path d="M14 3 A11 11 0 0 1 25 14" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" />
              </svg>
              Menyimpan...
            </>
          ) : exportStatus.state === "ok" ? (
            <>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              Export Berhasil
            </>
          ) : exportStatus.state === "err" ? (
            <>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              Gagal
            </>
          ) : (
            <>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              Export Data
              {transactions.length > 0 && (
                <span style={{
                  background: "rgba(100,255,218,0.15)", borderRadius: "20px",
                  padding: "0.1rem 0.5rem", fontSize: "0.75rem", fontWeight: 700,
                }}>
                  {transactions.length}
                </span>
              )}
            </>
          )}
        </button>

        <button
          onClick={() => importRef.current?.click()}
          style={{
            flex: 1,
            display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem",
            padding: "0.75rem 1rem",
            background: "var(--bg-2)",
            border: "1px solid var(--border-strong)",
            borderRadius: "10px",
            color: "var(--text)",
            fontFamily: "'Space Grotesk', sans-serif",
            fontWeight: 600, fontSize: "0.88rem",
            cursor: "pointer",
            transition: "all 0.2s",
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(255,255,255,0.3)";
            (e.currentTarget as HTMLButtonElement).style.background = "var(--card)";
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--border-strong)";
            (e.currentTarget as HTMLButtonElement).style.background = "var(--bg-2)";
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/>
            <line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
          Import Data
        </button>

        <input
          ref={importRef}
          type="file"
          accept=".json,application/json"
          onChange={handleImportFile}
          style={{ display: "none" }}
        />
      </div>

      {(exportStatus.state === "ok" || exportStatus.state === "err") && (
        <div className="fade-in" style={{
          marginTop: "0.75rem",
          padding: "0.65rem 1rem",
          borderRadius: "8px",
          fontSize: "0.85rem",
          fontWeight: 500,
          background: exportStatus.state === "ok" ? "rgba(100,255,218,0.08)" : "rgba(255,107,107,0.08)",
          border: `1px solid ${exportStatus.state === "ok" ? "rgba(100,255,218,0.3)" : "rgba(255,107,107,0.3)"}`,
          color: exportStatus.state === "ok" ? "var(--profit)" : "var(--loss)",
          fontFamily: "'JetBrains Mono', monospace",
          wordBreak: "break-all",
        }}>
          {exportStatus.state === "ok" ? `✓ Export berhasil — ${exportStatus.msg.replace("Export berhasil — ", "")}` : `✗ ${exportStatus.msg}`}
        </div>
      )}

      {importMsg && (
        <div className="fade-in" style={{
          marginTop: "0.75rem",
          padding: "0.65rem 1rem",
          borderRadius: "8px",
          fontSize: "0.85rem",
          fontWeight: 500,
          background: importMsg.ok ? "rgba(100,255,218,0.08)" : "rgba(255,107,107,0.08)",
          border: `1px solid ${importMsg.ok ? "rgba(100,255,218,0.3)" : "rgba(255,107,107,0.3)"}`,
          color: importMsg.ok ? "var(--profit)" : "var(--loss)",
        }}>
          {importMsg.text}
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [activeTab, setActiveTab] = useState<TabType>("BTC");
  const [showSettings, setShowSettings] = useState(false);
  const [showIndodaxApi, setShowIndodaxApi] = useState(false);

  // Local state backed by LocalStorage for immediate UI response and offline support
  const [transactions, setTransactions] = useState<Transaction[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });

  // GUNAKAN LOGIKA ACTIVE POSITION UNTUK TAMPILAN UTAMA
  const btcTx = filterActivePosition(transactions.filter(t => t.coin === "BTC"));
  const ethTx = filterActivePosition(transactions.filter(t => t.coin === "ETH"));

  // Sync local state to LocalStorage whenever it changes
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(transactions));
  }, [transactions]);

  // Remote data source (Database)
  const dbTransactionsQuery = useListTransactions();
  const createMutation = useCreateTransaction();
  const deleteMutation = useDeleteTransaction();
  const importMutation = useImportTransactions();

  // Robust Sync: Whenever DB data arrives, merge it into local state if missing
  useEffect(() => {
    // Guard: Pastikan data ada dan berupa Array untuk mencegah crash layar hitam
    if (!dbTransactionsQuery.data || !Array.isArray(dbTransactionsQuery.data)) {
      return;
    }

    setTransactions(prev => {
      const existingIds = new Set(prev.map(t => t.id));
      const dbRows = dbTransactionsQuery.data!;

      const missingFromLocal = dbRows.filter(row => row && row.id && !existingIds.has(row.id));
      if (missingFromLocal.length === 0) return prev;

      const newFromDb = missingFromLocal.map((row: any): Transaction => ({
        id: row.id,
        type: row.type || "BUY",
        // Normalisasi tanggal ke YYYY-MM-DD
        date: row.date instanceof Date
          ? row.date.toISOString().split('T')[0]
          : String(row.date || "").split('T')[0] || today(),
        coin: row.coin,
        jumlahBeli: row.jumlahBeli,
        fee: row.fee,
        hargaBeliPerCoin: row.hargaBeliPerCoin,
      }));

      if (newFromDb.length === 0) return prev;
      console.log(`[Sync] Hydrated ${newFromDb.length} transactions from database`);
      return [...newFromDb, ...prev];
    });
  }, [dbTransactionsQuery.data]);

  const addTransaction = useCallback(async (tx: Transaction) => {
    // 1. Update local UI immediately
    setTransactions(prev => [tx, ...prev]);

    // 2. Persist to remote Database
    try {
      await createMutation.mutateAsync({
        data: {
          id: tx.id,
          date: tx.date,
          type: tx.type,
          coin: tx.coin,
          jumlahBeli: tx.jumlahBeli,
          fee: tx.fee,
          hargaBeliPerCoin: tx.hargaBeliPerCoin,
          source: "manual",
        }
      });
      dbTransactionsQuery.refetch();
    } catch (err) {
      console.error("Failed to save transaction to database:", err);
    }
  }, [createMutation, dbTransactionsQuery]);

  const deleteTransaction = useCallback(async (id: string) => {
    // 1. Update local UI immediately
    setTransactions(prev => prev.filter(t => t.id !== id));

    // 2. Remove from remote Database
    try {
      await deleteMutation.mutateAsync({ id });
      dbTransactionsQuery.refetch();
    } catch (err) {
      console.error("Failed to delete transaction from database:", err);
    }
  }, [deleteMutation, dbTransactionsQuery]);

  const handleImportTransactions = useCallback(
    async (txs: Transaction[]): Promise<{ imported: number; skipped: number }> => {
      // 1. Send to remote Database
      const result = await importMutation.mutateAsync({
        data: {
          transactions: txs.map(t => ({
            id: t.id,
            date: toDateOnlyString(t.date),
            type: t.type,
            coin: t.coin,
            jumlahBeli: t.jumlahBeli,
            fee: t.fee,
            hargaBeliPerCoin: t.hargaBeliPerCoin,
            source: "indodax_sync" as const,
          })),
        },
      });

      // 2. Refresh DB query cache
      await dbTransactionsQuery.refetch();

      // 3. Logic update state local
      const txsToMerge = (result.transactions && result.transactions.length > 0)
        ? result.transactions
        : txs;

      setTransactions(prev => {
        const existingIds = new Set(prev.map(t => t.id));
        const newOnes = txsToMerge
          .filter((row: any) => !existingIds.has(row.id))
          .map((row: any): Transaction => ({
            id: row.id,
            type: row.type || "BUY",
            date: row.date instanceof Date
              ? row.date.toISOString().split('T')[0]
              : String(row.date).split('T')[0],
            coin: row.coin,
            jumlahBeli: row.jumlahBeli,
            fee: row.fee,
            hargaBeliPerCoin: row.hargaBeliPerCoin,
          }));

        return newOnes.length > 0 ? [...newOnes, ...prev] : prev;
      });

      return { imported: result.imported, skipped: result.skipped };
    },
    [importMutation, dbTransactionsQuery],
  );

  const existingTransactionIds = new Set(transactions.map(t => t.id));

  const [isFastSyncing, setIsFastSyncing] = useState(false);

  const handleFastSync = useCallback(async () => {
    const creds = readSavedIndodaxCredentials();
    if (!creds) {
      toast.error("Atur API Indodax terlebih dahulu di Pengaturan");
      return;
    }

    setIsFastSyncing(true);
    try {
      const results = await syncIndodaxTradeHistoryPreview(creds.apiKey, creds.secretKey);
      const { transactions: preview } = buildTradeHistoryPreview(results);
      const buys = preview.filter(t => t.type === "BUY");
      const sells = preview.filter(t => t.type === "SELL");

      const txsToSync: Transaction[] = [...buys, ...sells].map(t => ({
        id: indodaxTransactionId(t),
        date: t.date,
        type: t.type,
        coin: t.coin,
        jumlahBeli: t.jumlahBeli,
        fee: t.fee,
        hargaBeliPerCoin: t.hargaBeliPerCoin,
      }));

      if (txsToSync.length === 0) {
        toast.info("Tidak ada riwayat transaksi di Indodax");
        return;
      }

      const result = await handleImportTransactions(txsToSync);

      // Tentukan apakah ada data yang benar-benar baru di state local
      const newCount = txsToSync.filter(t => !existingTransactionIds.has(t.id)).length;

      if (newCount > 0) {
        toast.success(`Sinkronisasi berhasil: ${newCount} transaksi baru diimpor`, { duration: 4000 });
      } else {
        toast.success("Sinkronisasi berhasil: data database telah diperbarui", { duration: 3000 });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gagal sinkronisasi");
    } finally {
      setIsFastSyncing(false);
    }
  }, [existingTransactionIds, handleImportTransactions]);

  return (
    <div style={{
      minHeight: "100dvh",
      background: "var(--bg)",
      backgroundImage: "radial-gradient(ellipse at 20% 0%, rgba(100,255,218,0.04) 0%, transparent 60%), radial-gradient(ellipse at 80% 100%, rgba(98,126,234,0.04) 0%, transparent 60%)",
      paddingBottom: "2rem",
    }}>
      <header style={{
        borderBottom: "1px solid var(--border)",
        background: "rgba(10,25,47,0.85)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        position: "sticky",
        top: 0,
        zIndex: 100,
      }}>
        <div style={{ maxWidth: "900px", margin: "0 auto", padding: "0 1rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", paddingTop: "1rem", paddingBottom: "0.5rem" }}>
            <div style={{
              width: "36px", height: "36px", borderRadius: "10px",
              overflow: "hidden",
              border: "1px solid var(--border-strong)",
              boxShadow: "var(--accent-glow)",
              flexShrink: 0,
            }}>
              <img src="/app-logo.png" alt="Logo"
                style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
            </div>
            <div>
              <h1 style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text)", lineHeight: 1.2 }}>
                Aset Coin
              </h1>
              <p style={{ fontSize: "0.72rem", color: "var(--text-muted)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                Investment Tracker
              </p>
            </div>
            <div style={{ marginLeft: "auto", display: "flex", gap: "0.4rem" }}>
              <div style={{
                background: "var(--btc-dim)",
                border: "1px solid rgba(247,147,26,0.3)",
                borderRadius: "20px", padding: "0.2rem 0.6rem",
                fontSize: "0.72rem", fontWeight: 700, color: BTC_COLOR,
              }}>₿ BTC</div>
              <div style={{
                background: "var(--eth-dim)",
                border: "1px solid rgba(98,126,234,0.3)",
                borderRadius: "20px", padding: "0.2rem 0.6rem",
                fontSize: "0.72rem", fontWeight: 700, color: ETH_COLOR,
              }}>Ξ ETH</div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                <button
                  onClick={() => setShowSettings(true)}
                  aria-label="Pengaturan"
                  title="Pengaturan"
                  style={{
                    background: "var(--bg-2)",
                    border: "1px solid var(--border-strong)",
                    borderRadius: "20px",
                    width: "28px", height: "28px",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    color: "var(--text-muted)",
                    cursor: "pointer",
                  }}
                >
                  <SettingsIcon size={15} />
                </button>
                <button
                  onClick={handleFastSync}
                  disabled={isFastSyncing}
                  aria-label="Sinkron Cepat"
                  title="Sinkron Cepat"
                  style={{
                    background: "var(--accent-dim)",
                    border: "1px solid var(--border-strong)",
                    borderRadius: "20px",
                    width: "28px", height: "28px",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    color: "var(--accent)",
                    cursor: isFastSyncing ? "not-allowed" : "pointer",
                    opacity: isFastSyncing ? 0.7 : 1,
                  }}
                >
                  <RefreshIcon size={14} spinning={isFastSyncing} />
                </button>
              </div>
            </div>
          </div>
          <nav style={{ display: "flex", gap: 0 }}>
            {tabs.map(tab => {
              const isActive = activeTab === tab;
              const tabColor = tab === "BTC" ? BTC_COLOR : tab === "ETH" ? ETH_COLOR : ACCENT;
              return (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  style={{
                    padding: "0.6rem 1.25rem",
                    background: "none",
                    border: "none",
                    borderBottom: isActive ? `2px solid ${tabColor}` : "2px solid transparent",
                    color: isActive ? tabColor : "var(--text-muted)",
                    fontFamily: "'Space Grotesk', sans-serif",
                    fontWeight: isActive ? 700 : 500,
                    fontSize: "0.88rem",
                    cursor: "pointer",
                    transition: "all 0.2s",
                    display: "flex",
                    alignItems: "center",
                    gap: "0.4rem",
                    textShadow: isActive && tab !== "Dashboard" ? (tab === "BTC" ? "0 0 10px rgba(247,147,26,0.4)" : "0 0 10px rgba(98,126,234,0.4)") : "none",
                  }}
                >
                  {tab === "BTC" && <BitcoinIcon size={14} />}
                  {tab === "ETH" && <EthereumIcon size={14} />}
                  {tab === "Dashboard" && <TrendUpIcon size={14} />}
                  {tab}
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      <main style={{ maxWidth: "900px", margin: "0 auto", padding: "1.5rem 1rem 0" }}>
        {(activeTab === "BTC" || activeTab === "ETH") && (
          <div className="fade-in">
            <CoinSummaryCard coin={activeTab} transactions={activeTab === "BTC" ? btcTx : ethTx} />
            <TransactionForm onAdd={addTransaction} defaultCoin={activeTab} />
            <div style={{ marginTop: "0.5rem" }}>
              <h2 style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.75rem" }}>
                Riwayat Transaksi {activeTab} (Posisi Aktif)
              </h2>
              <TransactionTable transactions={activeTab === "BTC" ? btcTx : ethTx} coin={activeTab} onDelete={deleteTransaction} />
            </div>
          </div>
        )}
        {activeTab === "Dashboard" && (
          <DashboardTab transactions={transactions} onImport={setTransactions} />
        )}
      </main>

      {showSettings && (
        <SettingsDialog
          onClose={() => setShowSettings(false)}
          onOpenIndodaxApi={() => {
            setShowSettings(false);
            setShowIndodaxApi(true);
          }}
        />
      )}

      {showIndodaxApi && (
        <IndodaxApiDialog
          onClose={() => setShowIndodaxApi(false)}
          existingTransactionIds={existingTransactionIds}
          onImportTransactions={handleImportTransactions}
        />
      )}
      <Toaster richColors position="top-center" />
    </div>
  );
}

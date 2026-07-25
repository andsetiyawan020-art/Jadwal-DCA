import { useState } from "react";
import type { DcaSettings, DcaGuardrails } from "../types";
import { formatIdrInput, parseIdrInput, ACCENT } from "../utils";

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "0.75rem",
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
};

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h4
      style={{
        fontSize: "0.8rem",
        fontWeight: 700,
        color: ACCENT,
        textTransform: "uppercase",
        letterSpacing: "0.07em",
        marginBottom: "1rem",
        paddingBottom: "0.5rem",
        borderBottom: "1px solid var(--border)",
      }}
    >
      {children}
    </h4>
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

function ToggleRow({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        padding: "0.75rem 0",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <div>
        <div style={{ fontSize: "0.88rem", fontWeight: 500, color: "var(--text)" }}>{label}</div>
        {description && (
          <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: "2px" }}>
            {description}
          </div>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        onClick={() => onChange(!value)}
        style={{
          width: "42px",
          height: "24px",
          borderRadius: "12px",
          border: "none",
          background: value ? "var(--accent)" : "var(--muted)",
          cursor: "pointer",
          position: "relative",
          transition: "background 0.2s",
          flexShrink: 0,
          marginLeft: "1rem",
        }}
      >
        <span
          style={{
            position: "absolute",
            top: "3px",
            left: value ? "21px" : "3px",
            width: "18px",
            height: "18px",
            borderRadius: "50%",
            background: value ? "#0A192F" : "var(--text-muted)",
            transition: "left 0.2s",
          }}
        />
      </button>
    </div>
  );
}

// ── Guardrails Form ────────────────────────────────────────────────────────────

interface GuardrailsFormProps {
  guardrails: DcaGuardrails;
  onSave: (g: DcaGuardrails) => void;
}

function GuardrailsForm({ guardrails, onSave }: GuardrailsFormProps) {
  const [maxDaily, setMaxDaily] = useState(() =>
    guardrails.maxDailyTotal > 0 ? new Intl.NumberFormat("id-ID").format(guardrails.maxDailyTotal) : ""
  );
  const [maxPerTx, setMaxPerTx] = useState(() =>
    guardrails.maxPerTransaction > 0 ? new Intl.NumberFormat("id-ID").format(guardrails.maxPerTransaction) : ""
  );
  const [minInterval, setMinInterval] = useState(
    guardrails.minIntervalMinutes > 0 ? String(guardrails.minIntervalMinutes) : ""
  );
  const [saved, setSaved] = useState(false);

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    onSave({
      maxDailyTotal: parseIdrInput(maxDaily) || 0,
      maxPerTransaction: parseIdrInput(maxPerTx) || 0,
      minIntervalMinutes: parseInt(minInterval) || 0,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <form onSubmit={handleSave} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div>
        <label style={labelStyle}>Total Beli Maksimal per Hari (Rp)</label>
        <input
          type="text"
          inputMode="numeric"
          placeholder="0 = tidak ada batas"
          value={maxDaily}
          onChange={(e) => setMaxDaily(formatIdrInput(e.target.value))}
          onPaste={(e) => { e.preventDefault(); setMaxDaily(formatIdrInput(e.clipboardData.getData("text"))); }}
          style={inputStyle}
        />
        <div style={{ fontSize: "0.68rem", color: "var(--text-muted)", marginTop: "3px" }}>
          Isi 0 atau kosongkan untuk tanpa batas.
        </div>
      </div>

      <div>
        <label style={labelStyle}>Maksimal per Transaksi (Rp)</label>
        <input
          type="text"
          inputMode="numeric"
          placeholder="0 = tidak ada batas"
          value={maxPerTx}
          onChange={(e) => setMaxPerTx(formatIdrInput(e.target.value))}
          onPaste={(e) => { e.preventDefault(); setMaxPerTx(formatIdrInput(e.clipboardData.getData("text"))); }}
          style={inputStyle}
        />
        <div style={{ fontSize: "0.68rem", color: "var(--text-muted)", marginTop: "3px" }}>
          Jadwal dengan nominal di atas ini akan ditolak saat dibuat.
        </div>
      </div>

      <div>
        <label style={labelStyle}>Jeda Minimum Antar Transaksi (Menit)</label>
        <input
          type="number"
          inputMode="numeric"
          placeholder="0 = tanpa jeda"
          value={minInterval}
          onChange={(e) => setMinInterval(e.target.value)}
          min="0"
          style={inputStyle}
        />
      </div>

      <button
        type="submit"
        style={{
          padding: "0.7rem",
          background: saved ? "rgba(100,255,218,0.15)" : "var(--accent)",
          color: saved ? "var(--accent)" : "#0A192F",
          border: saved ? "1px solid var(--accent)" : "none",
          borderRadius: "8px",
          fontFamily: "'Space Grotesk', sans-serif",
          fontWeight: 700,
          fontSize: "0.9rem",
          cursor: "pointer",
          transition: "all 0.3s",
        }}
      >
        {saved ? "✓ Tersimpan" : "Simpan Guardrails"}
      </button>
    </form>
  );
}

// ── Settings Form ─────────────────────────────────────────────────────────────

interface SettingsFormProps {
  settings: DcaSettings;
  onSave: (s: DcaSettings) => void;
}

function SettingsForm({ settings, onSave }: SettingsFormProps) {
  const [form, setForm] = useState<DcaSettings>(settings);
  const [showKey, setShowKey] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [saved, setSaved] = useState(false);

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    onSave(form);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <form onSubmit={handleSave} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      {/* API Key */}
      <div>
        <label style={labelStyle}>API Key Indodax</label>
        <div style={{ position: "relative" }}>
          <input
            type={showKey ? "text" : "password"}
            placeholder="Masukkan API Key"
            value={form.apiKey}
            onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
            style={{ ...inputStyle, paddingRight: "2.5rem" }}
            autoComplete="off"
          />
          <button
            type="button"
            onClick={() => setShowKey((v) => !v)}
            style={{
              position: "absolute",
              right: "0.75rem",
              top: "50%",
              transform: "translateY(-50%)",
              background: "none",
              border: "none",
              color: "var(--text-muted)",
              cursor: "pointer",
              padding: 0,
              lineHeight: 0,
            }}
          >
            {showKey ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        </div>
      </div>

      {/* Secret Key */}
      <div>
        <label style={labelStyle}>Secret Key Indodax</label>
        <div style={{ position: "relative" }}>
          <input
            type={showSecret ? "text" : "password"}
            placeholder="Masukkan Secret Key"
            value={form.secretKey}
            onChange={(e) => setForm((f) => ({ ...f, secretKey: e.target.value }))}
            style={{ ...inputStyle, paddingRight: "2.5rem" }}
            autoComplete="off"
          />
          <button
            type="button"
            onClick={() => setShowSecret((v) => !v)}
            style={{
              position: "absolute",
              right: "0.75rem",
              top: "50%",
              transform: "translateY(-50%)",
              background: "none",
              border: "none",
              color: "var(--text-muted)",
              cursor: "pointer",
              padding: 0,
              lineHeight: 0,
            }}
          >
            {showSecret ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        </div>
      </div>

      {/* Mode */}
      <div>
        <label style={labelStyle}>Mode Auto DCA</label>
        <select
          value={form.mode}
          onChange={(e) => setForm((f) => ({ ...f, mode: e.target.value as DcaSettings["mode"] }))}
          style={inputStyle}
        >
          <option value="simulation">Simulasi (Dry Run)</option>
          <option value="live">Live (Eksekusi Nyata)</option>
        </select>
        <div style={{ fontSize: "0.68rem", color: "#FF6B6B", marginTop: "3px" }}>
          {form.mode === "live"
            ? "⚠️ Mode Live: jadwal akan mengeksekusi order nyata di Indodax."
            : "Mode Simulasi: tidak ada order nyata yang dibuat."}
        </div>
      </div>

      {/* Toggles */}
      <div style={{ background: "var(--bg-2)", borderRadius: "10px", padding: "0 0.75rem" }}>
        <ToggleRow
          label="Notifikasi"
          description="Tampilkan notifikasi saat eksekusi selesai."
          value={form.notificationsEnabled}
          onChange={(v) => setForm((f) => ({ ...f, notificationsEnabled: v }))}
        />
        <ToggleRow
          label="Auto Retry"
          description="Coba ulang otomatis jika eksekusi gagal."
          value={form.autoRetry}
          onChange={(v) => setForm((f) => ({ ...f, autoRetry: v }))}
        />
      </div>

      <button
        type="submit"
        style={{
          padding: "0.7rem",
          background: saved ? "rgba(100,255,218,0.15)" : "var(--accent)",
          color: saved ? "var(--accent)" : "#0A192F",
          border: saved ? "1px solid var(--accent)" : "none",
          borderRadius: "8px",
          fontFamily: "'Space Grotesk', sans-serif",
          fontWeight: 700,
          fontSize: "0.9rem",
          cursor: "pointer",
          transition: "all 0.3s",
        }}
      >
        {saved ? "✓ Tersimpan" : "Simpan Pengaturan"}
      </button>
    </form>
  );
}

// ── Main Export ────────────────────────────────────────────────────────────────

interface Props {
  settings: DcaSettings;
  guardrails: DcaGuardrails;
  onSaveSettings: (s: DcaSettings) => void;
  onSaveGuardrails: (g: DcaGuardrails) => void;
}

export function SettingsPanel({ settings, guardrails, onSaveSettings, onSaveGuardrails }: Props) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      {/* API & Mode */}
      <div
        style={{
          background: "var(--card)",
          border: "1px solid var(--border-strong)",
          borderRadius: "14px",
          padding: "1.25rem",
        }}
      >
        <SectionTitle>API &amp; Mode</SectionTitle>
        <SettingsForm settings={settings} onSave={onSaveSettings} />
      </div>

      {/* Guardrails */}
      <div
        style={{
          background: "var(--card)",
          border: "1px solid var(--border-strong)",
          borderRadius: "14px",
          padding: "1.25rem",
        }}
      >
        <SectionTitle>Guardrails</SectionTitle>
        <div
          style={{
            fontSize: "0.78rem",
            color: "var(--text-muted)",
            marginBottom: "1rem",
            lineHeight: 1.5,
          }}
        >
          Batasi total pembelian harian dan per transaksi agar tidak melebihi anggaran.
          Nilai 0 berarti tidak ada batas.
        </div>
        <GuardrailsForm guardrails={guardrails} onSave={onSaveGuardrails} />
      </div>
    </div>
  );
}

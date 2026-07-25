import { useState, useEffect } from "react";
import type { DcaSchedule, Coin } from "../types";
import type { DcaGuardrails } from "../types";
import {
  formatIdrInput,
  parseIdrInput,
  validateSchedule,
  BTC_COLOR,
  ETH_COLOR,
  ACCENT,
} from "../utils";

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

const errorStyle: React.CSSProperties = {
  fontSize: "0.72rem",
  color: "#FF6B6B",
  marginTop: "0.25rem",
};

interface FormValues {
  coin: Coin;
  nominal: string;       // formatted with dots
  intervalDays: string;  // string agar input number bisa kosong sementara
  startDate: string;
  executeTime: string;
  status: "ACTIVE" | "INACTIVE";
}

function today(): string {
  return new Date().toISOString().split("T")[0];
}

/** Preset interval yang umum dipakai */
const INTERVAL_PRESETS = [
  { label: "1 hari", value: 1 },
  { label: "3 hari", value: 3 },
  { label: "7 hari", value: 7 },
  { label: "14 hari", value: 14 },
  { label: "30 hari", value: 30 },
];

interface Props {
  guardrails: DcaGuardrails;
  editingSchedule?: DcaSchedule | null;
  onSubmit: (data: Omit<DcaSchedule, "id" | "createdAt" | "updatedAt">) => void;
  onCancel: () => void;
}

export function ScheduleForm({ guardrails, editingSchedule, onSubmit, onCancel }: Props) {
  const [form, setForm] = useState<FormValues>(() => {
    if (editingSchedule) {
      return {
        coin: editingSchedule.coin,
        nominal: new Intl.NumberFormat("id-ID").format(editingSchedule.nominal),
        intervalDays: String(editingSchedule.intervalDays),
        startDate: editingSchedule.startDate,
        executeTime: editingSchedule.executeTime,
        status: editingSchedule.status,
      };
    }
    return {
      coin: "BTC",
      nominal: "",
      intervalDays: "7",
      startDate: today(),
      executeTime: "08:00",
      status: "ACTIVE",
    };
  });

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Reset form saat editingSchedule berubah
  useEffect(() => {
    if (editingSchedule) {
      setForm({
        coin: editingSchedule.coin,
        nominal: new Intl.NumberFormat("id-ID").format(editingSchedule.nominal),
        intervalDays: String(editingSchedule.intervalDays),
        startDate: editingSchedule.startDate,
        executeTime: editingSchedule.executeTime,
        status: editingSchedule.status,
      });
    }
    setFieldErrors({});
  }, [editingSchedule]);

  function handleNominalChange(raw: string) {
    setForm((f) => ({ ...f, nominal: formatIdrInput(raw) }));
    setFieldErrors((e) => ({ ...e, nominal: "" }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const nominalNum = parseIdrInput(form.nominal);
    const intervalNum = parseInt(form.intervalDays, 10);

    const errors = validateSchedule(
      {
        nominal: nominalNum,
        startDate: form.startDate,
        executeTime: form.executeTime,
        intervalDays: intervalNum,
      },
      guardrails
    );

    if (errors.length > 0) {
      const mapped: Record<string, string> = {};
      errors.forEach((err) => { mapped[err.field] = err.message; });
      setFieldErrors(mapped);
      return;
    }

    onSubmit({
      coin: form.coin,
      nominal: nominalNum,
      intervalDays: intervalNum,
      startDate: form.startDate,
      executeTime: form.executeTime,
      status: form.status,
    });
  }

  const coinColor = form.coin === "BTC" ? BTC_COLOR : ETH_COLOR;

  return (
    <div
      className="fade-in"
      style={{
        background: "var(--card)",
        border: "1px solid var(--border-strong)",
        borderRadius: "14px",
        padding: "1.5rem",
        marginBottom: "1.25rem",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "1.25rem",
        }}
      >
        <h3 style={{ fontSize: "1rem", fontWeight: 600, color: ACCENT }}>
          {editingSchedule ? "Edit Jadwal" : "Jadwal Baru"}
        </h3>
        <button
          onClick={onCancel}
          style={{
            background: "none",
            border: "none",
            color: "var(--text-muted)",
            cursor: "pointer",
            fontSize: "1.3rem",
            lineHeight: 1,
          }}
        >
          ×
        </button>
      </div>

      <form onSubmit={handleSubmit}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>

          {/* Coin */}
          <div>
            <label style={labelStyle}>Coin</label>
            <select
              value={form.coin}
              onChange={(e) => setForm((f) => ({ ...f, coin: e.target.value as Coin }))}
              style={{ ...inputStyle, color: coinColor, fontWeight: 600 }}
            >
              <option value="BTC">₿ Bitcoin (BTC)</option>
              <option value="ETH">Ξ Ethereum (ETH)</option>
            </select>
          </div>

          {/* Interval hari */}
          <div>
            <label style={labelStyle}>Interval (Hari)</label>
            <input
              type="number"
              inputMode="numeric"
              placeholder="7"
              min="1"
              step="1"
              value={form.intervalDays}
              onChange={(e) => {
                setForm((f) => ({ ...f, intervalDays: e.target.value }));
                setFieldErrors((err) => ({ ...err, intervalDays: "" }));
              }}
              style={{
                ...inputStyle,
                borderColor: fieldErrors.intervalDays ? "#FF6B6B" : "var(--border-strong)",
              }}
            />
            {fieldErrors.intervalDays && (
              <div style={errorStyle}>{fieldErrors.intervalDays}</div>
            )}
            {/* Preset cepat */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", marginTop: "0.5rem" }}>
              {INTERVAL_PRESETS.map((p) => {
                const isSelected = form.intervalDays === String(p.value);
                return (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => {
                      setForm((f) => ({ ...f, intervalDays: String(p.value) }));
                      setFieldErrors((err) => ({ ...err, intervalDays: "" }));
                    }}
                    style={{
                      padding: "0.2rem 0.55rem",
                      fontSize: "0.7rem",
                      fontWeight: isSelected ? 700 : 500,
                      borderRadius: "20px",
                      border: `1px solid ${isSelected ? ACCENT : "var(--border-strong)"}`,
                      background: isSelected ? "var(--accent-dim)" : "transparent",
                      color: isSelected ? ACCENT : "var(--text-muted)",
                      cursor: "pointer",
                      transition: "all 0.15s",
                      fontFamily: "'Space Grotesk', sans-serif",
                    }}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Nominal */}
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={labelStyle}>Nominal Pembelian (IDR)</label>
            <input
              type="text"
              inputMode="numeric"
              placeholder="500.000"
              value={form.nominal}
              onChange={(e) => handleNominalChange(e.target.value)}
              onPaste={(e) => {
                e.preventDefault();
                handleNominalChange(e.clipboardData.getData("text"));
              }}
              style={{
                ...inputStyle,
                borderColor: fieldErrors.nominal ? "#FF6B6B" : "var(--border-strong)",
              }}
            />
            {fieldErrors.nominal && <div style={errorStyle}>{fieldErrors.nominal}</div>}
            {guardrails.maxPerTransaction > 0 && (
              <div style={{ fontSize: "0.68rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
                Batas per transaksi:{" "}
                <span style={{ color: ACCENT }}>
                  Rp {guardrails.maxPerTransaction.toLocaleString("id-ID")}
                </span>
              </div>
            )}
          </div>

          {/* Tanggal mulai */}
          <div>
            <label style={labelStyle}>Tanggal Mulai</label>
            <input
              type="date"
              value={form.startDate}
              min={today()}
              onChange={(e) => {
                setForm((f) => ({ ...f, startDate: e.target.value }));
                setFieldErrors((err) => ({ ...err, startDate: "" }));
              }}
              style={{
                ...inputStyle,
                colorScheme: "dark",
                borderColor: fieldErrors.startDate ? "#FF6B6B" : "var(--border-strong)",
              }}
              required
            />
            {fieldErrors.startDate && <div style={errorStyle}>{fieldErrors.startDate}</div>}
          </div>

          {/* Jam eksekusi */}
          <div>
            <label style={labelStyle}>Jam Eksekusi</label>
            <input
              type="time"
              value={form.executeTime}
              onChange={(e) => {
                setForm((f) => ({ ...f, executeTime: e.target.value }));
                setFieldErrors((err) => ({ ...err, executeTime: "" }));
              }}
              style={{
                ...inputStyle,
                colorScheme: "dark",
                borderColor: fieldErrors.executeTime ? "#FF6B6B" : "var(--border-strong)",
              }}
              required
            />
            {fieldErrors.executeTime && <div style={errorStyle}>{fieldErrors.executeTime}</div>}
          </div>

          {/* Status awal */}
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={labelStyle}>Status Awal</label>
            <div style={{ display: "flex", gap: "0.75rem" }}>
              {(["ACTIVE", "INACTIVE"] as const).map((s) => (
                <label
                  key={s}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    cursor: "pointer",
                    fontSize: "0.88rem",
                    color: form.status === s ? ACCENT : "var(--text-muted)",
                    fontWeight: form.status === s ? 600 : 400,
                  }}
                >
                  <input
                    type="radio"
                    name="status"
                    value={s}
                    checked={form.status === s}
                    onChange={() => setForm((f) => ({ ...f, status: s }))}
                    style={{ accentColor: ACCENT }}
                  />
                  {s === "ACTIVE" ? "Aktif" : "Nonaktif"}
                </label>
              ))}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: "0.75rem", marginTop: "1.25rem" }}>
          <button
            type="submit"
            style={{
              flex: 1,
              padding: "0.75rem",
              background: ACCENT,
              color: "#0A192F",
              border: "none",
              borderRadius: "8px",
              fontFamily: "'Space Grotesk', sans-serif",
              fontWeight: 700,
              fontSize: "0.9rem",
              cursor: "pointer",
            }}
          >
            {editingSchedule ? "Simpan Perubahan" : "Buat Jadwal"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            style={{
              padding: "0.75rem 1.25rem",
              background: "transparent",
              border: "1px solid var(--border-strong)",
              borderRadius: "8px",
              color: "var(--text-muted)",
              fontFamily: "'Space Grotesk', sans-serif",
              cursor: "pointer",
            }}
          >
            Batal
          </button>
        </div>
      </form>
    </div>
  );
}

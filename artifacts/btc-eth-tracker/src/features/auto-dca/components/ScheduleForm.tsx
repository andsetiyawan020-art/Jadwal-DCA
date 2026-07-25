import { useState, useEffect } from "react";
import type { DcaSchedule, Coin, Frequency } from "../types";
import type { DcaGuardrails } from "../types";
import {
  formatIdrInput,
  parseIdrInput,
  validateSchedule,
  FREQUENCY_LABELS,
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
  nominal: string;    // formatted with dots
  startDate: string;
  executeTime: string;
  frequency: Frequency;
  status: "ACTIVE" | "INACTIVE";
}

function today(): string {
  return new Date().toISOString().split("T")[0];
}

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
        startDate: editingSchedule.startDate,
        executeTime: editingSchedule.executeTime,
        frequency: editingSchedule.frequency,
        status: editingSchedule.status,
      };
    }
    return {
      coin: "BTC",
      nominal: "",
      startDate: today(),
      executeTime: "08:00",
      frequency: "MONTHLY",
      status: "ACTIVE",
    };
  });

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Reset form when editingSchedule changes
  useEffect(() => {
    if (editingSchedule) {
      setForm({
        coin: editingSchedule.coin,
        nominal: new Intl.NumberFormat("id-ID").format(editingSchedule.nominal),
        startDate: editingSchedule.startDate,
        executeTime: editingSchedule.executeTime,
        frequency: editingSchedule.frequency,
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
    const errors = validateSchedule(
      { nominal: nominalNum, startDate: form.startDate, executeTime: form.executeTime },
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
      startDate: form.startDate,
      executeTime: form.executeTime,
      frequency: form.frequency,
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

          {/* Frekuensi */}
          <div>
            <label style={labelStyle}>Frekuensi</label>
            <select
              value={form.frequency}
              onChange={(e) => setForm((f) => ({ ...f, frequency: e.target.value as Frequency }))}
              style={inputStyle}
            >
              {(["DAILY", "WEEKLY", "MONTHLY"] as Frequency[]).map((f) => (
                <option key={f} value={f}>
                  {FREQUENCY_LABELS[f]}
                </option>
              ))}
            </select>
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
                <span style={{ color: "var(--accent)" }}>
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
                setFieldErrors((e2) => ({ ...e2, startDate: "" }));
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
                setFieldErrors((e2) => ({ ...e2, executeTime: "" }));
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

          {/* Status */}
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
                    color: form.status === s ? "var(--accent)" : "var(--text-muted)",
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
              background: "var(--accent)",
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

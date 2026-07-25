import type { DcaSchedule } from "../types";
import {
  FREQUENCY_LABELS,
  COIN_LABELS,
  BTC_COLOR,
  ETH_COLOR,
  formatRp,
  formatNextRun,
  formatDate,
} from "../utils";

function BitcoinIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <circle cx="16" cy="16" r="16" fill={BTC_COLOR} fillOpacity="0.15" />
      <path
        d="M22 13.5c.3-2-1.2-3-3.3-3.7l.7-2.7-1.6-.4-.6 2.6c-.4-.1-.9-.2-1.4-.3l.6-2.6-1.6-.4-.7 2.7c-.4-.1-.7-.2-1-.2l-2.1-.5-.4 1.7s1.2.3 1.2.3c.7.2.8.7.8 1l-2 7.8c-.1.3-.4.7-1 .5 0 0-1.2-.3-1.2-.3l-.8 1.8 2 .5c.4.1.7.2 1 .3l-.7 2.7 1.6.4.7-2.7c.4.1.9.2 1.4.3l-.7 2.7 1.6.4.7-2.7c2.8.5 4.9.3 5.8-2.2.7-2-.1-3.2-1.5-3.9 1.1-.3 1.9-1 2.1-2.4zm-3.8 5.3c-.5 2-3.9 1-5 .7l.9-3.5c1.1.3 4.6.8 4.1 2.8zm.5-5.3c-.5 1.8-3.4.9-4.3.7l.8-3.2c.9.2 3.9.7 3.5 2.5z"
        fill={BTC_COLOR}
      />
    </svg>
  );
}

function EthereumIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <circle cx="16" cy="16" r="16" fill={ETH_COLOR} fillOpacity="0.15" />
      <path d="M16 5l-6.5 11.5L16 19.5l6.5-3L16 5z" fill={ETH_COLOR} />
      <path d="M9.5 16.5L16 27l6.5-10.5L16 19.5l-6.5-3z" fill={ETH_COLOR} fillOpacity="0.7" />
    </svg>
  );
}

function EditIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

function TrashIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4h6v2" />
    </svg>
  );
}

interface Props {
  schedule: DcaSchedule;
  onEdit: (schedule: DcaSchedule) => void;
  onDelete: (id: string) => void;
  onToggle: (id: string, current: "ACTIVE" | "INACTIVE") => void;
}

export function ScheduleCard({ schedule, onEdit, onDelete, onToggle }: Props) {
  const coinColor = schedule.coin === "BTC" ? BTC_COLOR : ETH_COLOR;
  const isActive = schedule.status === "ACTIVE";
  const nextRun = formatNextRun(schedule);

  return (
    <div
      className="fade-in"
      style={{
        background: "var(--card)",
        border: `1px solid ${isActive ? "var(--border-strong)" : "var(--border)"}`,
        borderRadius: "12px",
        padding: "1rem 1.25rem",
        display: "flex",
        flexDirection: "column",
        gap: "0.75rem",
        opacity: isActive ? 1 : 0.65,
        transition: "opacity 0.2s",
      }}
    >
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
        {schedule.coin === "BTC" ? <BitcoinIcon /> : <EthereumIcon />}
        <span style={{ fontWeight: 700, fontSize: "0.95rem", color: coinColor }}>
          {COIN_LABELS[schedule.coin]}
        </span>
        {/* Frequency badge */}
        <span
          style={{
            marginLeft: "auto",
            fontSize: "0.7rem",
            fontWeight: 600,
            padding: "0.2rem 0.6rem",
            borderRadius: "20px",
            background: isActive ? "var(--accent-dim)" : "var(--muted)",
            color: isActive ? "var(--accent)" : "var(--text-muted)",
            border: `1px solid ${isActive ? "var(--border-strong)" : "var(--border)"}`,
          }}
        >
          {FREQUENCY_LABELS[schedule.frequency]}
        </span>
        {/* Active/Inactive badge */}
        <span
          style={{
            fontSize: "0.7rem",
            fontWeight: 700,
            padding: "0.2rem 0.6rem",
            borderRadius: "20px",
            background: isActive ? "rgba(100,255,218,0.12)" : "rgba(255,107,107,0.1)",
            color: isActive ? "var(--accent)" : "#FF6B6B",
            border: `1px solid ${isActive ? "rgba(100,255,218,0.25)" : "rgba(255,107,107,0.25)"}`,
          }}
        >
          {isActive ? "Aktif" : "Nonaktif"}
        </span>
      </div>

      {/* Info grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "0.5rem 1rem",
        }}
      >
        <div>
          <span style={{ fontSize: "0.68rem", color: "var(--text-muted)", display: "block", marginBottom: "2px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Nominal
          </span>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "0.9rem", fontWeight: 700, color: "var(--text)" }}>
            {formatRp(schedule.nominal)}
          </span>
        </div>
        <div>
          <span style={{ fontSize: "0.68rem", color: "var(--text-muted)", display: "block", marginBottom: "2px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Mulai
          </span>
          <span style={{ fontSize: "0.85rem", color: "var(--text)" }}>
            {formatDate(schedule.startDate)} · {schedule.executeTime}
          </span>
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <span style={{ fontSize: "0.68rem", color: "var(--text-muted)", display: "block", marginBottom: "2px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Jadwal Berikutnya
          </span>
          <span style={{ fontSize: "0.85rem", color: isActive ? "var(--accent)" : "var(--text-muted)" }}>
            {nextRun}
          </span>
        </div>
      </div>

      {/* Action row */}
      <div style={{ display: "flex", gap: "0.5rem", borderTop: "1px solid var(--border)", paddingTop: "0.75rem" }}>
        {/* Toggle active */}
        <button
          onClick={() => onToggle(schedule.id, schedule.status)}
          style={{
            flex: 1,
            padding: "0.45rem",
            background: isActive ? "rgba(255,107,107,0.08)" : "var(--accent-dim)",
            border: `1px solid ${isActive ? "rgba(255,107,107,0.25)" : "var(--border-strong)"}`,
            borderRadius: "8px",
            color: isActive ? "#FF6B6B" : "var(--accent)",
            fontFamily: "'Space Grotesk', sans-serif",
            fontWeight: 600,
            fontSize: "0.78rem",
            cursor: "pointer",
            transition: "all 0.2s",
          }}
        >
          {isActive ? "Nonaktifkan" : "Aktifkan"}
        </button>

        {/* Edit */}
        <button
          onClick={() => onEdit(schedule)}
          title="Edit jadwal"
          style={{
            padding: "0.45rem 0.75rem",
            background: "var(--bg-2)",
            border: "1px solid var(--border-strong)",
            borderRadius: "8px",
            color: "var(--text-muted)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            transition: "all 0.2s",
          }}
        >
          <EditIcon />
        </button>

        {/* Delete */}
        <button
          onClick={() => onDelete(schedule.id)}
          title="Hapus jadwal"
          style={{
            padding: "0.45rem 0.75rem",
            background: "rgba(255,107,107,0.08)",
            border: "1px solid rgba(255,107,107,0.2)",
            borderRadius: "8px",
            color: "#FF6B6B",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            transition: "all 0.2s",
          }}
        >
          <TrashIcon />
        </button>
      </div>
    </div>
  );
}

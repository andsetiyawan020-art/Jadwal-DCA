import type { DcaHistoryEntry, DcaHistoryStatus } from "../types";
import { formatRp, formatDateTime, BTC_COLOR, ETH_COLOR } from "../utils";

const STATUS_CONFIG: Record<
  DcaHistoryStatus,
  { label: string; bg: string; color: string; border: string }
> = {
  SUCCESS: {
    label: "Berhasil",
    bg: "rgba(100,255,218,0.08)",
    color: "var(--accent)",
    border: "rgba(100,255,218,0.2)",
  },
  FAILED: {
    label: "Gagal",
    bg: "rgba(255,107,107,0.1)",
    color: "#FF6B6B",
    border: "rgba(255,107,107,0.25)",
  },
  CANCELLED: {
    label: "Dibatalkan",
    bg: "rgba(136,146,176,0.1)",
    color: "var(--text-muted)",
    border: "rgba(136,146,176,0.2)",
  },
  SKIPPED: {
    label: "Dilewati",
    bg: "rgba(247,147,26,0.08)",
    color: "#F7931A",
    border: "rgba(247,147,26,0.2)",
  },
};

function StatusBadge({ status }: { status: DcaHistoryStatus }) {
  const cfg = STATUS_CONFIG[status];
  return (
    <span
      style={{
        fontSize: "0.7rem",
        fontWeight: 700,
        padding: "0.2rem 0.55rem",
        borderRadius: "20px",
        background: cfg.bg,
        color: cfg.color,
        border: `1px solid ${cfg.border}`,
        whiteSpace: "nowrap",
      }}
    >
      {cfg.label}
    </span>
  );
}

interface Props {
  history: DcaHistoryEntry[];
  onClear: () => void;
}

export function HistoryTable({ history, onClear }: Props) {
  if (history.length === 0) {
    return (
      <div
        style={{
          textAlign: "center",
          padding: "3rem 1rem",
          color: "var(--text-muted)",
          fontSize: "0.9rem",
          background: "var(--card)",
          borderRadius: "14px",
          border: "1px dashed var(--border-strong)",
        }}
      >
        <div style={{ fontSize: "2rem", marginBottom: "0.5rem", opacity: 0.35 }}>📋</div>
        Belum ada riwayat eksekusi Auto DCA.
      </div>
    );
  }

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "0.75rem",
        }}
      >
        <span
          style={{
            fontSize: "0.78rem",
            color: "var(--text-muted)",
            fontWeight: 600,
          }}
        >
          {history.length} entri
        </span>
        <button
          onClick={onClear}
          style={{
            padding: "0.3rem 0.75rem",
            background: "rgba(255,107,107,0.08)",
            border: "1px solid rgba(255,107,107,0.2)",
            borderRadius: "8px",
            color: "#FF6B6B",
            fontFamily: "'Space Grotesk', sans-serif",
            fontSize: "0.75rem",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Hapus Semua
        </button>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table
          style={{
            width: "100%",
            borderCollapse: "separate",
            borderSpacing: "0 5px",
          }}
        >
          <thead>
            <tr>
              {["Waktu", "Coin", "Nominal", "Status", "Catatan"].map((h) => (
                <th
                  key={h}
                  style={{
                    padding: "0.4rem 0.75rem",
                    textAlign: "left",
                    fontSize: "0.68rem",
                    fontWeight: 600,
                    color: "var(--text-muted)",
                    letterSpacing: "0.05em",
                    textTransform: "uppercase",
                    whiteSpace: "nowrap",
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {history.map((entry) => {
              const coinColor = entry.coin === "BTC" ? BTC_COLOR : ETH_COLOR;
              return (
                <tr
                  key={entry.id}
                  style={{
                    background: "var(--card)",
                  }}
                >
                  <td
                    style={{
                      padding: "0.6rem 0.75rem",
                      borderRadius: "8px 0 0 8px",
                      fontSize: "0.8rem",
                      color: "var(--text-muted)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {formatDateTime(entry.executedAt)}
                  </td>
                  <td
                    style={{
                      padding: "0.6rem 0.75rem",
                      fontSize: "0.82rem",
                      fontWeight: 700,
                      color: coinColor,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {entry.coin}
                  </td>
                  <td
                    style={{
                      padding: "0.6rem 0.75rem",
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: "0.82rem",
                      color: "var(--text)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {formatRp(entry.nominal)}
                  </td>
                  <td style={{ padding: "0.6rem 0.75rem" }}>
                    <StatusBadge status={entry.status} />
                  </td>
                  <td
                    style={{
                      padding: "0.6rem 0.75rem",
                      borderRadius: "0 8px 8px 0",
                      fontSize: "0.78rem",
                      color: "var(--text-muted)",
                    }}
                  >
                    {entry.note ?? "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

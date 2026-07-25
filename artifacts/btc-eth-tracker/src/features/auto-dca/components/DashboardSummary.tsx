import type { DcaSchedule } from "../types";
import {
  formatRp,
  formatNextRun,
  findNextSchedule,
  computeDailyTotal,
  computeWeeklyTotal,
  computeMonthlyTotal,
  COIN_LABELS,
  BTC_COLOR,
  ETH_COLOR,
  ACCENT,
} from "../utils";

function StatCard({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
}) {
  return (
    <div
      style={{
        background: "var(--card)",
        border: "1px solid var(--border-strong)",
        borderRadius: "12px",
        padding: "1rem 1.25rem",
        display: "flex",
        flexDirection: "column",
        gap: "0.35rem",
        minWidth: 0,
      }}
    >
      <span
        style={{
          fontSize: "0.7rem",
          fontWeight: 600,
          color: "var(--text-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: "1.05rem",
          fontWeight: 700,
          color: color ?? "var(--accent)",
          wordBreak: "break-word",
        }}
      >
        {value}
      </span>
      {sub && (
        <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>{sub}</span>
      )}
    </div>
  );
}

interface Props {
  schedules: DcaSchedule[];
}

export function DashboardSummary({ schedules }: Props) {
  const active = schedules.filter((s) => s.status === "ACTIVE");
  const nextSchedule = findNextSchedule(schedules);

  const dailyTotal = computeDailyTotal(schedules);
  const weeklyTotal = computeWeeklyTotal(schedules);
  const monthlyTotal = computeMonthlyTotal(schedules);

  const nextCoinColor =
    nextSchedule?.coin === "BTC" ? BTC_COLOR : nextSchedule?.coin === "ETH" ? ETH_COLOR : ACCENT;

  return (
    <div
      style={{
        background: "var(--card)",
        border: "1px solid var(--border-strong)",
        borderRadius: "14px",
        padding: "1.25rem",
        marginBottom: "1.25rem",
      }}
    >
      <h3
        style={{
          fontSize: "0.82rem",
          fontWeight: 600,
          color: "var(--text-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          marginBottom: "1rem",
        }}
      >
        Ringkasan Auto DCA
      </h3>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
          gap: "0.75rem",
        }}
      >
        <StatCard
          label="Jadwal Aktif"
          value={String(active.length)}
          sub={`dari ${schedules.length} jadwal`}
          color={ACCENT}
        />
        <StatCard
          label="Total / Hari"
          value={dailyTotal > 0 ? formatRp(dailyTotal) : "—"}
          color={ACCENT}
        />
        <StatCard
          label="Total / Minggu"
          value={weeklyTotal > 0 ? formatRp(weeklyTotal) : "—"}
          color={ACCENT}
        />
        <StatCard
          label="Total / Bulan"
          value={monthlyTotal > 0 ? formatRp(monthlyTotal) : "—"}
          color={ACCENT}
        />
        <StatCard
          label="Jadwal Berikutnya"
          value={
            nextSchedule
              ? `${COIN_LABELS[nextSchedule.coin]}`
              : "—"
          }
          sub={nextSchedule ? formatNextRun(nextSchedule) : undefined}
          color={nextCoinColor}
        />
      </div>
    </div>
  );
}

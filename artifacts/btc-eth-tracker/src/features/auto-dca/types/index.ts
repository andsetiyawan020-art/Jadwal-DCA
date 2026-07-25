export type Coin = "BTC" | "ETH";
export type Frequency = "DAILY" | "WEEKLY" | "MONTHLY";
export type ScheduleStatus = "ACTIVE" | "INACTIVE";
export type DcaHistoryStatus = "SUCCESS" | "FAILED" | "CANCELLED" | "SKIPPED";

export interface DcaSchedule {
  id: string;
  coin: Coin;
  /** Nominal pembelian dalam Rupiah (angka murni, bukan formatted) */
  nominal: number;
  /** Format: YYYY-MM-DD */
  startDate: string;
  /** Format: HH:MM (24-hour) */
  executeTime: string;
  frequency: Frequency;
  status: ScheduleStatus;
  createdAt: string;
  updatedAt: string;
}

export interface DcaHistoryEntry {
  id: string;
  scheduleId: string;
  coin: Coin;
  nominal: number;
  /** ISO datetime string */
  executedAt: string;
  status: DcaHistoryStatus;
  note?: string;
}

export interface DcaSettings {
  apiKey: string;
  secretKey: string;
  /** "simulation" = dry-run, "live" = eksekusi nyata */
  mode: "simulation" | "live";
  notificationsEnabled: boolean;
  autoRetry: boolean;
}

export interface DcaGuardrails {
  /** Batas total pembelian per hari (Rp). 0 = tidak ada batas */
  maxDailyTotal: number;
  /** Batas maksimal satu transaksi (Rp). 0 = tidak ada batas */
  maxPerTransaction: number;
  /** Jeda minimum antar transaksi (menit). 0 = tidak ada jeda */
  minIntervalMinutes: number;
}

export interface AutoDcaState {
  schedules: DcaSchedule[];
  history: DcaHistoryEntry[];
  settings: DcaSettings;
  guardrails: DcaGuardrails;
}

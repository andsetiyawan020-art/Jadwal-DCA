import type { Coin, DcaGuardrails, DcaSchedule } from "../types";

export const COIN_LABELS: Record<Coin, string> = {
  BTC: "₿ Bitcoin",
  ETH: "Ξ Ethereum",
};

export const BTC_COLOR = "#F7931A";
export const ETH_COLOR = "#627EEA";
export const ACCENT = "#64FFDA";

/** Format angka sebagai Rupiah. Contoh: 1500000 → "Rp 1.500.000" */
export function formatRp(n: number): string {
  return `Rp ${Math.round(n).toLocaleString("id-ID")}`;
}

/**
 * Format input mentah menjadi string ribuan dengan titik (id-ID).
 * Contoh: "1500000" → "1.500.000"
 */
export function formatIdrInput(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  return new Intl.NumberFormat("id-ID").format(Number(digits));
}

/**
 * Kebalikan formatIdrInput: hapus titik, kembalikan angka murni.
 * Kembalikan NaN jika kosong / tidak valid.
 */
export function parseIdrInput(formatted: string): number {
  const digits = formatted.replace(/\D/g, "");
  return digits ? Number(digits) : NaN;
}

/** Format tanggal YYYY-MM-DD ke tampilan Indonesia. Contoh: "25 Jul 2026" */
export function formatDate(dateStr: string): string {
  if (!dateStr) return "-";
  const d = new Date(dateStr + "T00:00:00");
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}

/** Format ISO datetime ke tampilan. Contoh: "25 Jul 2026, 08:00" */
export function formatDateTime(isoStr: string): string {
  if (!isoStr) return "-";
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return isoStr;
  return d.toLocaleDateString("id-ID", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

/** Hasilkan ID unik sederhana */
export function generateDcaId(): string {
  return "dca_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/**
 * Label interval hari untuk tampilan.
 * Contoh: 1 → "Setiap hari", 7 → "Setiap 7 hari"
 */
export function intervalLabel(intervalDays: number): string {
  if (intervalDays === 1) return "Setiap hari";
  return `Setiap ${intervalDays} hari`;
}

/**
 * Hitung waktu eksekusi berikutnya dari sebuah jadwal.
 *
 * Algoritma:
 * 1. Ambil tanggal startDate dan jam executeTime.
 * 2. Hitung berapa siklus (intervalDays) sudah berlalu sejak startDate.
 * 3. next = startDate + ceil(elapsed/intervalDays) * intervalDays (hari pertama setelah now).
 * 4. Jika candidate (next) hari ini tapi jamnya sudah lewat → maju 1 interval lagi.
 */
export function computeNextRun(schedule: DcaSchedule): Date | null {
  const interval = Math.max(1, Math.floor(schedule.intervalDays));
  const [hh, mm] = schedule.executeTime.split(":").map(Number);
  if (isNaN(hh) || isNaN(mm)) return null;

  const start = new Date(schedule.startDate + "T00:00:00");
  if (isNaN(start.getTime())) return null;

  const now = new Date();

  function atTime(base: Date): Date {
    const d = new Date(base);
    d.setHours(hh, mm, 0, 0);
    return d;
  }

  function addDays(d: Date, n: number): Date {
    const r = new Date(d);
    r.setDate(r.getDate() + n);
    return r;
  }

  // First candidate: startDate at executeTime
  let candidate = atTime(start);

  // If start is in the future, that's the next run
  if (candidate > now) return candidate;

  // Advance by interval until we exceed now
  const msPerDay = 24 * 60 * 60 * 1000;
  const msInterval = interval * msPerDay;
  const elapsed = now.getTime() - candidate.getTime();
  const cycles = Math.floor(elapsed / msInterval);
  candidate = addDays(candidate, (cycles + 1) * interval);

  // Safety: should already be > now, but verify
  while (candidate <= now) {
    candidate = addDays(candidate, interval);
  }

  return candidate;
}

/** Format nextRun untuk tampilan singkat */
export function formatNextRun(schedule: DcaSchedule): string {
  if (schedule.status === "INACTIVE") return "Tidak aktif";
  const next = computeNextRun(schedule);
  if (!next) return "-";
  return next.toLocaleDateString("id-ID", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

/**
 * Hitung rata-rata total nominal per hari dari semua jadwal aktif.
 * interval 1 → nominal/hari, interval 7 → nominal/7/hari, dst.
 */
export function computeDailyTotal(schedules: DcaSchedule[]): number {
  return schedules
    .filter((s) => s.status === "ACTIVE")
    .reduce((sum, s) => sum + s.nominal / Math.max(1, s.intervalDays), 0);
}

/** Total nominal per minggu (7 hari) dari semua jadwal aktif. */
export function computeWeeklyTotal(schedules: DcaSchedule[]): number {
  return computeDailyTotal(schedules) * 7;
}

/** Total nominal per bulan (30 hari) dari semua jadwal aktif. */
export function computeMonthlyTotal(schedules: DcaSchedule[]): number {
  return computeDailyTotal(schedules) * 30;
}

/** Jadwal berikutnya dari semua jadwal aktif (yang paling cepat). */
export function findNextSchedule(schedules: DcaSchedule[]): DcaSchedule | null {
  const active = schedules.filter((s) => s.status === "ACTIVE");
  if (!active.length) return null;
  return active.reduce<DcaSchedule | null>((earliest, s) => {
    const next = computeNextRun(s);
    if (!next) return earliest;
    if (!earliest) return s;
    const earliestNext = computeNextRun(earliest);
    if (!earliestNext) return s;
    return next < earliestNext ? s : earliest;
  }, null);
}

// ── Validation ────────────────────────────────────────────────────────────────

export interface ScheduleValidationError {
  field: string;
  message: string;
}

export function validateSchedule(
  values: {
    nominal: number;
    startDate: string;
    executeTime: string;
    intervalDays: number;
  },
  guardrails: DcaGuardrails
): ScheduleValidationError[] {
  const errors: ScheduleValidationError[] = [];
  const now = new Date();

  if (!values.nominal || values.nominal <= 0) {
    errors.push({ field: "nominal", message: "Nominal harus lebih dari 0" });
  }

  if (guardrails.maxPerTransaction > 0 && values.nominal > guardrails.maxPerTransaction) {
    errors.push({
      field: "nominal",
      message: `Nominal melebihi batas per transaksi (${formatRp(guardrails.maxPerTransaction)})`,
    });
  }

  if (!Number.isInteger(values.intervalDays) || values.intervalDays < 1) {
    errors.push({ field: "intervalDays", message: "Interval minimal 1 hari" });
  }

  if (!values.startDate) {
    errors.push({ field: "startDate", message: "Tanggal mulai wajib diisi" });
  } else {
    const startDateObj = new Date(values.startDate + "T00:00:00");
    const todayOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (startDateObj < todayOnly) {
      errors.push({ field: "startDate", message: "Tanggal mulai tidak boleh di masa lalu" });
    }

    // Jika tanggal hari ini, cek apakah jam sudah lewat
    if (values.executeTime && startDateObj.getTime() === todayOnly.getTime()) {
      const [hh, mmVal] = values.executeTime.split(":").map(Number);
      const executeMinutes = hh * 60 + mmVal;
      const nowMinutes = now.getHours() * 60 + now.getMinutes();
      if (executeMinutes <= nowMinutes) {
        errors.push({
          field: "executeTime",
          message: "Jam sudah lewat untuk hari ini. Pilih jam yang akan datang atau ganti tanggal.",
        });
      }
    }
  }

  if (!values.executeTime) {
    errors.push({ field: "executeTime", message: "Jam eksekusi wajib diisi" });
  }

  return errors;
}

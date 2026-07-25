import type {
  DcaSchedule,
  DcaHistoryEntry,
  DcaSettings,
  DcaGuardrails,
} from "../types";

const KEYS = {
  SCHEDULES: "auto_dca_schedules",
  HISTORY: "auto_dca_history",
  SETTINGS: "auto_dca_settings",
  GUARDRAILS: "auto_dca_guardrails",
} as const;

const DEFAULT_SETTINGS: DcaSettings = {
  apiKey: "",
  secretKey: "",
  mode: "simulation",
  notificationsEnabled: false,
  autoRetry: false,
};

const DEFAULT_GUARDRAILS: DcaGuardrails = {
  maxDailyTotal: 0,
  maxPerTransaction: 0,
  minIntervalMinutes: 0,
};

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson<T>(key: string, value: T): void {
  localStorage.setItem(key, JSON.stringify(value));
}

export const AutoDcaStorage = {
  // ── Schedules ──────────────────────────────────────────
  getSchedules(): DcaSchedule[] {
    return readJson<DcaSchedule[]>(KEYS.SCHEDULES, []);
  },

  saveSchedules(schedules: DcaSchedule[]): void {
    writeJson(KEYS.SCHEDULES, schedules);
  },

  addSchedule(schedule: DcaSchedule): void {
    const all = AutoDcaStorage.getSchedules();
    writeJson(KEYS.SCHEDULES, [schedule, ...all]);
  },

  updateSchedule(id: string, updates: Partial<DcaSchedule>): void {
    const all = AutoDcaStorage.getSchedules().map((s) =>
      s.id === id ? { ...s, ...updates, updatedAt: new Date().toISOString() } : s
    );
    writeJson(KEYS.SCHEDULES, all);
  },

  deleteSchedule(id: string): void {
    const all = AutoDcaStorage.getSchedules().filter((s) => s.id !== id);
    writeJson(KEYS.SCHEDULES, all);
  },

  // ── History ────────────────────────────────────────────
  getHistory(): DcaHistoryEntry[] {
    return readJson<DcaHistoryEntry[]>(KEYS.HISTORY, []);
  },

  saveHistory(history: DcaHistoryEntry[]): void {
    writeJson(KEYS.HISTORY, history);
  },

  addHistoryEntry(entry: DcaHistoryEntry): void {
    const all = AutoDcaStorage.getHistory();
    writeJson(KEYS.HISTORY, [entry, ...all]);
  },

  // ── Settings ───────────────────────────────────────────
  getSettings(): DcaSettings {
    return readJson<DcaSettings>(KEYS.SETTINGS, DEFAULT_SETTINGS);
  },

  saveSettings(settings: DcaSettings): void {
    writeJson(KEYS.SETTINGS, settings);
  },

  // ── Guardrails ─────────────────────────────────────────
  getGuardrails(): DcaGuardrails {
    return readJson<DcaGuardrails>(KEYS.GUARDRAILS, DEFAULT_GUARDRAILS);
  },

  saveGuardrails(guardrails: DcaGuardrails): void {
    writeJson(KEYS.GUARDRAILS, guardrails);
  },
};

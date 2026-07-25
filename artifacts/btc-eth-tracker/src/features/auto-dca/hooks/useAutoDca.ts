import { useState, useCallback, useEffect } from "react";
import { AutoDcaStorage } from "../services/AutoDcaStorage";
import { DcaNotificationService } from "../services/DcaNotificationService";
import type {
  DcaSchedule,
  DcaHistoryEntry,
  DcaSettings,
  DcaGuardrails,
  ScheduleStatus,
} from "../types";
import { generateDcaId } from "../utils";

export function useAutoDca() {
  const [schedules, setSchedules] = useState<DcaSchedule[]>(() =>
    AutoDcaStorage.getSchedules()
  );
  const [history, setHistory] = useState<DcaHistoryEntry[]>(() =>
    AutoDcaStorage.getHistory()
  );
  const [settings, setSettings] = useState<DcaSettings>(() =>
    AutoDcaStorage.getSettings()
  );
  const [guardrails, setGuardrails] = useState<DcaGuardrails>(() =>
    AutoDcaStorage.getGuardrails()
  );

  /** Re-jadwalkan notifikasi setiap kali daftar jadwal berubah (hanya jika notifikasi aktif). */
  function syncNotifications(updatedSchedules: DcaSchedule[], updatedSettings?: DcaSettings) {
    const activeSettings = updatedSettings ?? settings;
    if (activeSettings.notificationsEnabled) {
      DcaNotificationService.scheduleAll(updatedSchedules).catch(() => {});
    } else {
      DcaNotificationService.cancelAll().catch(() => {});
    }
  }

  // ── Schedules ─────────────────────────────────────────────────────────────

  const addSchedule = useCallback(
    (data: Omit<DcaSchedule, "id" | "createdAt" | "updatedAt">) => {
      const now = new Date().toISOString();
      const schedule: DcaSchedule = {
        ...data,
        id: generateDcaId(),
        createdAt: now,
        updatedAt: now,
      };
      AutoDcaStorage.addSchedule(schedule);
      const updated = AutoDcaStorage.getSchedules();
      setSchedules(updated);
      syncNotifications(updated);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settings]
  );

  const updateSchedule = useCallback(
    (id: string, updates: Partial<Omit<DcaSchedule, "id" | "createdAt">>) => {
      AutoDcaStorage.updateSchedule(id, updates);
      const updated = AutoDcaStorage.getSchedules();
      setSchedules(updated);
      syncNotifications(updated);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settings]
  );

  const deleteSchedule = useCallback(
    (id: string) => {
      AutoDcaStorage.deleteSchedule(id);
      const updated = AutoDcaStorage.getSchedules();
      setSchedules(updated);
      syncNotifications(updated);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settings]
  );

  const toggleScheduleStatus = useCallback(
    (id: string, currentStatus: ScheduleStatus) => {
      const next: ScheduleStatus = currentStatus === "ACTIVE" ? "INACTIVE" : "ACTIVE";
      AutoDcaStorage.updateSchedule(id, { status: next });
      const updated = AutoDcaStorage.getSchedules();
      setSchedules(updated);
      syncNotifications(updated);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settings]
  );

  // ── History ───────────────────────────────────────────────────────────────

  const addHistoryEntry = useCallback(
    (entry: Omit<DcaHistoryEntry, "id">) => {
      const full: DcaHistoryEntry = { ...entry, id: generateDcaId() };
      AutoDcaStorage.addHistoryEntry(full);
      setHistory(AutoDcaStorage.getHistory());
    },
    []
  );

  const clearHistory = useCallback(() => {
    AutoDcaStorage.saveHistory([]);
    setHistory([]);
  }, []);

  // ── Settings ──────────────────────────────────────────────────────────────

  const saveSettings = useCallback(
    (next: DcaSettings) => {
      AutoDcaStorage.saveSettings(next);
      setSettings(next);
      // Re-sync notifikasi dengan settings baru
      syncNotifications(schedules, next);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [schedules]
  );

  // ── Guardrails ────────────────────────────────────────────────────────────

  const saveGuardrails = useCallback((next: DcaGuardrails) => {
    AutoDcaStorage.saveGuardrails(next);
    setGuardrails(next);
  }, []);

  return {
    // state
    schedules,
    history,
    settings,
    guardrails,
    // schedule actions
    addSchedule,
    updateSchedule,
    deleteSchedule,
    toggleScheduleStatus,
    // history actions
    addHistoryEntry,
    clearHistory,
    // settings
    saveSettings,
    // guardrails
    saveGuardrails,
  };
}

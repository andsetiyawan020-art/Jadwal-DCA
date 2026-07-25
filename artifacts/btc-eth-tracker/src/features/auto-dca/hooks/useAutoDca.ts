import { useState, useCallback } from "react";
import { AutoDcaStorage } from "../services/AutoDcaStorage";
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
      setSchedules(AutoDcaStorage.getSchedules());
    },
    []
  );

  const updateSchedule = useCallback(
    (id: string, updates: Partial<Omit<DcaSchedule, "id" | "createdAt">>) => {
      AutoDcaStorage.updateSchedule(id, updates);
      setSchedules(AutoDcaStorage.getSchedules());
    },
    []
  );

  const deleteSchedule = useCallback((id: string) => {
    AutoDcaStorage.deleteSchedule(id);
    setSchedules(AutoDcaStorage.getSchedules());
  }, []);

  const toggleScheduleStatus = useCallback((id: string, currentStatus: ScheduleStatus) => {
    const next: ScheduleStatus = currentStatus === "ACTIVE" ? "INACTIVE" : "ACTIVE";
    AutoDcaStorage.updateSchedule(id, { status: next });
    setSchedules(AutoDcaStorage.getSchedules());
  }, []);

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

  const saveSettings = useCallback((next: DcaSettings) => {
    AutoDcaStorage.saveSettings(next);
    setSettings(next);
  }, []);

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

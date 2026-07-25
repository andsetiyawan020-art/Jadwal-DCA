import { useState } from "react";
import { useAutoDca } from "../hooks/useAutoDca";
import { DashboardSummary } from "../components/DashboardSummary";
import { ScheduleCard } from "../components/ScheduleCard";
import { ScheduleForm } from "../components/ScheduleForm";
import { HistoryTable } from "../components/HistoryTable";
import { SettingsPanel } from "../components/SettingsPanel";
import type { DcaSchedule } from "../types";
import { ACCENT } from "../utils";

type SubTab = "jadwal" | "riwayat" | "pengaturan";

const SUB_TABS: { key: SubTab; label: string; icon: string }[] = [
  { key: "jadwal", label: "Jadwal", icon: "📅" },
  { key: "riwayat", label: "Riwayat", icon: "📋" },
  { key: "pengaturan", label: "Pengaturan", icon: "⚙️" },
];

function PlusIcon({ size = 17 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

export function AutoDcaPage() {
  const {
    schedules,
    history,
    settings,
    guardrails,
    addSchedule,
    updateSchedule,
    deleteSchedule,
    toggleScheduleStatus,
    clearHistory,
    saveSettings,
    saveGuardrails,
  } = useAutoDca();

  const [activeSubTab, setActiveSubTab] = useState<SubTab>("jadwal");
  const [showForm, setShowForm] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<DcaSchedule | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  function handleAdd(data: Omit<DcaSchedule, "id" | "createdAt" | "updatedAt">) {
    addSchedule(data);
    setShowForm(false);
  }

  function handleEdit(schedule: DcaSchedule) {
    setEditingSchedule(schedule);
    setShowForm(true);
    setActiveSubTab("jadwal");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function handleEditSubmit(data: Omit<DcaSchedule, "id" | "createdAt" | "updatedAt">) {
    if (editingSchedule) {
      updateSchedule(editingSchedule.id, data);
    }
    setEditingSchedule(null);
    setShowForm(false);
  }

  function handleCancelForm() {
    setShowForm(false);
    setEditingSchedule(null);
  }

  function handleDeleteRequest(id: string) {
    setDeleteConfirmId(id);
  }

  function handleDeleteConfirm() {
    if (deleteConfirmId) {
      deleteSchedule(deleteConfirmId);
      setDeleteConfirmId(null);
    }
  }

  return (
    <div className="fade-in">
      {/* Sub-tab navigation */}
      <nav
        style={{
          display: "flex",
          gap: 0,
          borderBottom: "1px solid var(--border)",
          marginBottom: "1.5rem",
        }}
      >
        {SUB_TABS.map((tab) => {
          const isActive = activeSubTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => {
                setActiveSubTab(tab.key);
                setShowForm(false);
                setEditingSchedule(null);
              }}
              style={{
                padding: "0.55rem 1rem",
                background: "none",
                border: "none",
                borderBottom: isActive ? `2px solid ${ACCENT}` : "2px solid transparent",
                color: isActive ? ACCENT : "var(--text-muted)",
                fontFamily: "'Space Grotesk', sans-serif",
                fontWeight: isActive ? 700 : 500,
                fontSize: "0.85rem",
                cursor: "pointer",
                transition: "all 0.2s",
                display: "flex",
                alignItems: "center",
                gap: "0.4rem",
              }}
            >
              <span>{tab.icon}</span>
              {tab.label}
              {tab.key === "jadwal" && schedules.length > 0 && (
                <span
                  style={{
                    fontSize: "0.65rem",
                    fontWeight: 700,
                    background: isActive ? "var(--accent-dim)" : "var(--muted)",
                    color: isActive ? ACCENT : "var(--text-muted)",
                    borderRadius: "10px",
                    padding: "0.1rem 0.4rem",
                    minWidth: "18px",
                    textAlign: "center",
                  }}
                >
                  {schedules.length}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* ── Tab: Jadwal ─────────────────────────────────────────────────────── */}
      {activeSubTab === "jadwal" && (
        <div>
          {/* Dashboard summary */}
          <DashboardSummary schedules={schedules} />

          {/* Form: new or edit */}
          {showForm ? (
            <ScheduleForm
              guardrails={guardrails}
              editingSchedule={editingSchedule}
              onSubmit={editingSchedule ? handleEditSubmit : handleAdd}
              onCancel={handleCancelForm}
            />
          ) : (
            <button
              onClick={() => { setShowForm(true); setEditingSchedule(null); }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                padding: "0.75rem 1.25rem",
                background: "var(--accent-dim)",
                border: "1px solid var(--border-strong)",
                borderRadius: "10px",
                color: ACCENT,
                fontFamily: "'Space Grotesk', sans-serif",
                fontWeight: 600,
                fontSize: "0.9rem",
                cursor: "pointer",
                width: "100%",
                justifyContent: "center",
                marginBottom: "1.25rem",
                transition: "all 0.2s",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.boxShadow = "var(--accent-glow)";
                (e.currentTarget as HTMLButtonElement).style.borderColor = ACCENT;
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.boxShadow = "none";
                (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--border-strong)";
              }}
            >
              <PlusIcon /> Tambah Jadwal Auto DCA
            </button>
          )}

          {/* Schedule list */}
          {schedules.length === 0 && !showForm ? (
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
              <div style={{ fontSize: "2rem", marginBottom: "0.5rem", opacity: 0.35 }}>🗓️</div>
              Belum ada jadwal. Klik tombol di atas untuk membuat jadwal Auto DCA pertama kamu!
            </div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
                gap: "0.85rem",
              }}
            >
              {schedules.map((schedule) => (
                <ScheduleCard
                  key={schedule.id}
                  schedule={schedule}
                  onEdit={handleEdit}
                  onDelete={handleDeleteRequest}
                  onToggle={toggleScheduleStatus}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Tab: Riwayat ────────────────────────────────────────────────────── */}
      {activeSubTab === "riwayat" && (
        <div>
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
            Riwayat Eksekusi Auto DCA
          </h3>
          <HistoryTable history={history} onClear={clearHistory} />
        </div>
      )}

      {/* ── Tab: Pengaturan ─────────────────────────────────────────────────── */}
      {activeSubTab === "pengaturan" && (
        <div>
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
            Pengaturan Auto DCA
          </h3>
          <SettingsPanel
            settings={settings}
            guardrails={guardrails}
            onSaveSettings={saveSettings}
            onSaveGuardrails={saveGuardrails}
          />
        </div>
      )}

      {/* ── Delete confirmation overlay ──────────────────────────────────────── */}
      {deleteConfirmId !== null && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(10,25,47,0.85)",
            backdropFilter: "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
            zIndex: 200,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "1.5rem",
          }}
          onClick={() => setDeleteConfirmId(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="fade-in"
            style={{
              background: "var(--card)",
              border: "1px solid var(--border-strong)",
              borderRadius: "16px",
              padding: "1.75rem",
              maxWidth: "360px",
              width: "100%",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: "2rem", marginBottom: "0.75rem" }}>🗑️</div>
            <h3 style={{ fontSize: "1rem", fontWeight: 700, color: "var(--text)", marginBottom: "0.5rem" }}>
              Hapus Jadwal?
            </h3>
            <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: "1.5rem" }}>
              Jadwal ini akan dihapus permanen dan tidak dapat dikembalikan.
            </p>
            <div style={{ display: "flex", gap: "0.75rem" }}>
              <button
                onClick={handleDeleteConfirm}
                style={{
                  flex: 1,
                  padding: "0.7rem",
                  background: "rgba(255,107,107,0.15)",
                  border: "1px solid rgba(255,107,107,0.4)",
                  borderRadius: "8px",
                  color: "#FF6B6B",
                  fontFamily: "'Space Grotesk', sans-serif",
                  fontWeight: 700,
                  fontSize: "0.9rem",
                  cursor: "pointer",
                }}
              >
                Ya, Hapus
              </button>
              <button
                onClick={() => setDeleteConfirmId(null)}
                style={{
                  flex: 1,
                  padding: "0.7rem",
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
          </div>
        </div>
      )}
    </div>
  );
}

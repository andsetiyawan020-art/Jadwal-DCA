/**
 * DcaNotificationService
 *
 * Mengelola notifikasi lokal untuk jadwal Auto DCA menggunakan
 * @capacitor/local-notifications.
 *
 * ── Platform behaviour ────────────────────────────────────────────────────────
 *
 * NATIVE (APK via Capacitor):
 *   - Notifikasi dijadwalkan melalui Android AlarmManager (via Capacitor plugin).
 *   - Notifikasi TETAP muncul saat aplikasi di background atau device terkunci,
 *     selama izin POST_NOTIFICATIONS diberikan (Android 13+).
 *   - Klik notifikasi membuka aplikasi dan memicu event localNotificationActionPerformed,
 *     yang di-handle di sini untuk mengarahkan ke tab Auto DCA.
 *
 * WEB (browser biasa):
 *   - Menggunakan Web Notifications API (browser permission).
 *   - Tidak ada background trigger — tab browser harus terbuka agar bisa memantau waktu.
 *   - Tidak bisa menjadwalkan notifikasi di masa depan secara native di browser.
 *   - Untuk keperluan pengujian notifikasi sebelum build APK, service ini tetap
 *     berfungsi sebatas "tampilkan notifikasi sekarang jika waktu sudah tiba"
 *     melalui polling interval.
 *
 * ── Cara kerja di APK ─────────────────────────────────────────────────────────
 *   1. `requestPermission()` → tampilkan dialog izin Android 13+ (POST_NOTIFICATIONS).
 *   2. `scheduleAll(schedules)` → hitung nextRun tiap jadwal aktif, daftarkan ke
 *      LocalNotifications. Plugin menangani wakeup device sendiri.
 *   3. `listenForTap(callback)` → saat notifikasi diklik, callback dipanggil
 *      sehingga app bisa berpindah ke tab Auto DCA.
 */

import { LocalNotifications, type ActionType } from "@capacitor/local-notifications";
import { Capacitor } from "@capacitor/core";
import type { DcaSchedule } from "../types";
import { computeNextRun } from "../utils";

/** localStorage key yang dipakai untuk meneruskan navigasi saat app di-restart. */
const NAV_KEY = "auto_dca_pending_nav";

/** Konversi schedule.id (string) ke integer ID yang dibutuhkan LocalNotifications. */
function scheduleToNotifId(scheduleId: string): number {
  let hash = 0;
  for (let i = 0; i < scheduleId.length; i++) {
    hash = ((hash << 5) - hash + scheduleId.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 2_000_000_000; // pastikan positif & < MAX_INT
}

export const DcaNotificationService = {
  /**
   * Minta izin notifikasi.
   * - Android 13+: muncul dialog POST_NOTIFICATIONS.
   * - Versi lama: langsung granted.
   * - Web: muncul permission prompt browser.
   * Kembalikan true jika izin diberikan.
   */
  async requestPermission(): Promise<boolean> {
    if (Capacitor.isNativePlatform()) {
      const { display } = await LocalNotifications.requestPermissions();
      return display === "granted";
    }

    // Web fallback
    if (!("Notification" in window)) return false;
    if (Notification.permission === "granted") return true;
    if (Notification.permission === "denied") return false;
    const result = await Notification.requestPermission();
    return result === "granted";
  },

  /**
   * Cek apakah izin sudah diberikan tanpa menampilkan dialog.
   */
  async hasPermission(): Promise<boolean> {
    if (Capacitor.isNativePlatform()) {
      const { display } = await LocalNotifications.checkPermissions();
      return display === "granted";
    }
    return "Notification" in window && Notification.permission === "granted";
  },

  /**
   * Batalkan semua notifikasi yang terdaftar, lalu jadwalkan ulang
   * untuk semua jadwal aktif.
   *
   * Panggil ini setiap kali jadwal ditambah / diubah / dihapus / di-toggle.
   */
  async scheduleAll(schedules: DcaSchedule[]): Promise<void> {
    if (!(await DcaNotificationService.hasPermission())) return;

    // Batalkan semua notifikasi lama
    await DcaNotificationService.cancelAll();

    const activeSchedules = schedules.filter((s) => s.status === "ACTIVE");
    if (!activeSchedules.length) return;

    if (Capacitor.isNativePlatform()) {
      await DcaNotificationService._scheduleNative(activeSchedules);
    }
    // Web: tidak ada scheduling ke depan; gunakan polling (lihat useNotificationPoller)
  },

  /** Schedule notifikasi via Capacitor LocalNotifications (native only). */
  async _scheduleNative(schedules: DcaSchedule[]): Promise<void> {
    const now = new Date();
    const notifications = schedules
      .map((s) => {
        const nextRun = computeNextRun(s);
        if (!nextRun || nextRun <= now) return null;

        return {
          id: scheduleToNotifId(s.id),
          title: `⏰ Auto DCA ${s.coin}`,
          body: `Saatnya beli ${s.coin} — Rp ${s.nominal.toLocaleString("id-ID")}`,
          schedule: { at: nextRun, allowWhileIdle: true },
          extra: { scheduleId: s.id, tab: "AutoDCA" },
          channelId: "dca-reminders",
          smallIcon: "ic_stat_icon_config_sample",
        };
      })
      .filter(Boolean);

    if (!notifications.length) return;

    // Pastikan channel ada (Android 8+)
    await LocalNotifications.createChannel({
      id: "dca-reminders",
      name: "Auto DCA Reminders",
      description: "Pengingat jadwal beli crypto otomatis",
      importance: 4, // HIGH
      visibility: 1,
      sound: "default",
      vibration: true,
    });

    await LocalNotifications.schedule({
      notifications: notifications as Parameters<typeof LocalNotifications.schedule>[0]["notifications"],
    });
  },

  /** Batalkan semua notifikasi DCA yang terdaftar. */
  async cancelAll(): Promise<void> {
    if (!Capacitor.isNativePlatform()) return;
    try {
      const pending = await LocalNotifications.getPending();
      if (pending.notifications.length > 0) {
        await LocalNotifications.cancel({ notifications: pending.notifications });
      }
    } catch {
      // Abaikan jika tidak ada
    }
  },

  /**
   * Daftarkan handler saat notifikasi diklik.
   *
   * Di APK: klik notifikasi memanggil `callback` sehingga app bisa pindah tab.
   * Juga menyimpan flag localStorage untuk kasus app di-restart.
   *
   * Kembalikan fungsi untuk membersihkan listener.
   */
  listenForTap(callback: () => void): () => void {
    if (!Capacitor.isNativePlatform()) return () => {};

    const handle = LocalNotifications.addListener(
      "localNotificationActionPerformed",
      (action) => {
        const extra = (action.notification as unknown as { extra?: { tab?: string } }).extra;
        if (extra?.tab === "AutoDCA") {
          // Simpan flag untuk kasus app direstart
          localStorage.setItem(NAV_KEY, "AutoDCA");
          callback();
        }
      }
    );

    return () => {
      handle.then((h) => h.remove());
    };
  },

  /**
   * Cek apakah ada pending navigation dari tap notifikasi saat app masih mati.
   * Gunakan di App.tsx untuk menentukan tab awal.
   * Otomatis membersihkan flag setelah dibaca.
   */
  consumePendingNav(): string | null {
    const val = localStorage.getItem(NAV_KEY);
    if (val) localStorage.removeItem(NAV_KEY);
    return val;
  },

  /**
   * Tampilkan notifikasi SEGERA (dipakai di web untuk pengujian manual).
   * Di native, ini juga bisa dipakai untuk notifikasi instan.
   */
  async showImmediate(title: string, body: string): Promise<void> {
    if (Capacitor.isNativePlatform()) {
      const granted = await DcaNotificationService.hasPermission();
      if (!granted) return;
      await LocalNotifications.schedule({
        notifications: [{
          id: Date.now() % 2_000_000_000,
          title,
          body,
          schedule: { at: new Date(Date.now() + 1000) },
          channelId: "dca-reminders",
        }],
      });
    } else if ("Notification" in window && Notification.permission === "granted") {
      new Notification(title, { body, icon: "/icon-ac-v5-192.png" });
    }
  },
};

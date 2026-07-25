import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Capacitor } from "@capacitor/core";
import { setBaseUrl } from "@workspace/api-client-react";
import { DcaNotificationService } from "./features/auto-dca/services/DcaNotificationService";
import App from "./App";
import "./index.css";

// Minta izin notifikasi saat pertama buka app.
// - Native (APK): memunculkan dialog POST_NOTIFICATIONS (Android 13+).
// - Web: memunculkan permission prompt browser jika belum pernah diminta.
// Dilakukan tanpa menunggu agar tidak menghambat render utama.
DcaNotificationService.requestPermission().catch(() => {});

if (Capacitor.isNativePlatform()) {
  const apiOrigin = import.meta.env.VITE_API_ORIGIN as string | undefined;
  if (apiOrigin) {
    console.log("[Main] Setting Base URL to:", apiOrigin);
    setBaseUrl(apiOrigin);
  } else {
    console.error("[Main] VITE_API_ORIGIN kosong! Panggilan API akan gagal.");
  }

  // Defensive cleanup for APKs built before service-worker registration was
  // made web-only: a stale SW + precache from a previous build is the
  // classic cause of "app flashes then goes blank" in the Android WebView.
  // A fresh install has nothing to unregister, so this is a no-op there.
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.getRegistrations().then((regs) => {
      regs.forEach((r) => r.unregister());
    }).catch(() => {});
  }
  if ("caches" in window) {
    caches.keys().then((keys) => {
      keys.forEach((k) => caches.delete(k));
    }).catch(() => {});
  }
} else {
  // Web only: register the PWA service worker so installed/bookmarked web
  // usage still gets offline support and update prompts.
  import("virtual:pwa-register").then(({ registerSW }) => {
    registerSW({ immediate: true });
  });
}

const queryClient = new QueryClient();

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <App />
  </QueryClientProvider>,
);
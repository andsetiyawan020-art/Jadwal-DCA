import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
import { VitePWA } from "vite-plugin-pwa";

const rawPort = process.env.PORT ?? "5173";
const port = Number(rawPort);

// Baked into the built bundle so the native Android APK (which has no dev
// server / Vite proxy to fall back on) knows the absolute origin of our own
// API server. Web/dev-server usage ignores this and keeps using relative
// "/api/..." paths (see the "/api" proxy below), since only native builds
// call setBaseUrl() with it (see src/main.tsx).
const apiOrigin = process.env.REPLIT_DEV_DOMAIN
  ? `https://${process.env.REPLIT_DEV_DOMAIN}`
  : "";

export default defineConfig({
  base: "/",
  define: {
    "import.meta.env.VITE_API_ORIGIN": JSON.stringify(apiOrigin),
  },
  plugins: [
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    VitePWA({
      registerType: "autoUpdate",
      // Registration is done manually in main.tsx (web only). Auto-injecting
      // the registration script would also run inside the Capacitor Android
      // WebView, where a stale service worker + precache from a previous
      // build is the classic cause of "app flashes then goes blank" after
      // rebuilding — the WebView is not a browser tab a user revisits across
      // deploys, so a persistent SW cache has no upside there and only risk.
      injectRegister: false,
      strategies: "generateSW",
      includeAssets: [
        "favicon.svg",
        "icon-ac-v5-192.png",
        "icon-ac-v5-512.png",
        "icon-maskable-192.png",
        "icon-maskable-512.png",
      ],
      manifest: {
        name: "Aset Coin",
        short_name: "Aset Coin",
        description: "Aset Coin Investment Tracker",
        theme_color: "#050816",
        background_color: "#050816",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        scope: "/",
        lang: "id",
        icons: [
          {
            src: "icon-ac-v5-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "icon-ac-v5-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "icon-maskable-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "maskable",
          },
          {
            src: "icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2,woff,ttf}"],
        cleanupOutdatedCaches: true,
        skipWaiting: true,
        clientsClaim: true,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts-stylesheets",
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts-webfonts",
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/indodax\.com\/.*/i,
            handler: "NetworkFirst",
            options: {
              cacheName: "indodax-api",
              networkTimeoutSeconds: 10,
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 5 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: {
        enabled: false,
      },
    }),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist"),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    proxy: {
      // Forward all /api/* requests to the Express API server.
      // Without this proxy, customFetch("/api/...") is handled by Vite itself
      // (404) and never reaches the Express process on port 8080.
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: false,
      },
      "/indodax": {
        target: "https://indodax.com",
        changeOrigin: true,
        secure: false,
        rewrite: (p) => p.replace(/^\/indodax/, ""),
      },
      // Proxy untuk Indodax Trade API v2 (GET /api/v2/myTrades)
      // Menggantikan TAPI tradeHistory yang sudah dekomisi per 7 April 2026.
      "/tapi-v2": {
        target: "https://tapi.indodax.com",
        changeOrigin: true,
        secure: true,
        rewrite: (p) => p.replace(/^\/tapi-v2/, ""),
      },
      "/binance": {
        target: "https://api.binance.com",
        changeOrigin: true,
        secure: true,
        rewrite: (p) => p.replace(/^\/binance/, ""),
      },
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});

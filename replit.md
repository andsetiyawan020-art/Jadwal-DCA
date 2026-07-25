# BTC & ETH Tracker

A React web app (in Indonesian) for tracking live Bitcoin and Ethereum prices from Indodax, viewing candlestick charts, and recording DCA (dollar-cost averaging) buy transactions.

## Run & Operate

- `pnpm --filter @workspace/btc-eth-tracker run dev` — run the frontend (port 5173, main workflow)
- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080); optional for current price-tracking flow
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Optional env: `DATABASE_URL` — Postgres connection string (only needed when DB features are used)

## Stack

- pnpm workspaces (pnpm-workspace.yaml), Node.js 24, TypeScript 5.9
- Frontend: React 19 + Vite 7, Tailwind CSS v4, Recharts
- API: Express 5 (optional backend for chart proxy & future features)
- DB: PostgreSQL + Drizzle ORM (optional; required only if DB features used)
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Data flow

The frontend fetches live BTC/ETH prices directly from Indodax via a Vite dev-proxy (`/indodax/...`). The API server (`/api/price/:pair`, `/api/chart/:pair`) provides an optional server-side route for the same data but is not used by the tracker's core price-fetching path. Transactions are stored in `localStorage`.

## Where things live

_Populate as you build — short repo map plus pointers to the source-of-truth file for DB schema, API contracts, theme files, etc._

## Architecture decisions

_Populate as you build — non-obvious choices a reader couldn't infer from the code (3-5 bullets)._

## Product

_Describe the high-level user-facing capabilities of this app once they exist._

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Fitur Auto DCA

Ditambahkan sebagai tab ke-4 ("Auto DCA") di navigasi utama. Arsitektur feature-based:

```
src/features/auto-dca/
  types/index.ts              — Semua TypeScript types (DcaSchedule, DcaHistoryEntry, dll)
  services/AutoDcaStorage.ts  — Service localStorage (tidak langsung di komponen)
  utils/index.ts              — Format Rp, parse input, hitung nextRun, validasi
  hooks/useAutoDca.ts         — Custom hook utama untuk state management
  components/
    DashboardSummary.tsx      — Ringkasan statistik (jadwal aktif, total/hari/minggu/bulan)
    ScheduleCard.tsx          — Kartu satu jadwal DCA
    ScheduleForm.tsx          — Form buat/edit jadwal + validasi guardrails
    HistoryTable.tsx          — Tabel riwayat eksekusi
    SettingsPanel.tsx         — API key + mode + notifikasi + guardrails
  pages/AutoDcaPage.tsx       — Halaman utama (sub-tab Jadwal/Riwayat/Pengaturan)
```

LocalStorage keys yang digunakan: `auto_dca_schedules`, `auto_dca_history`, `auto_dca_settings`, `auto_dca_guardrails`.

## Android build (Capacitor)

- The real Capacitor Android project is `artifacts/btc-eth-tracker/android` (appId `com.andisetiyawan.btcethtracker`). The root-level `./android` folder is a stale leftover with only icon resources (no Gradle files) — ignore it.
- After `git pull` (including when opening the project in Android Studio), dependencies are not committed, so run `pnpm install` from the repo root first — otherwise `vite`/`cap` commands fail with "command not found".
- To get web changes into the APK: `pnpm --filter @workspace/btc-eth-tracker run build`, then `cd artifacts/btc-eth-tracker && npx cap sync android` (copies `dist/` into `android/app/src/main/assets/public`).
- The Capacitor CLI (`cap`) requires Node.js ≥22; the frontend itself only needs ≥20. Both are installed in this repl (`nodejs-20` and `nodejs-22` modules).

## Gotchas

- Requires Node.js 20+ (Vite 7 needs it); the imported repl defaulted to Node 18, so the `nodejs-20` module was installed. Node 18 will fail with `crypto.hash is not a function`.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details

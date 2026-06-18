export const MAX_PRINTERS = 10;

// Public URL shown in copy-paste API examples. Falls back to the production
// alias when no Vercel-injected URL is available (local dev, etc.).
export const PUBLIC_BASE_URL =
  process.env.NEXT_PUBLIC_BASE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : 'https://cloudprnt-rc2c.vercel.app');

export const API_KEY_PLACEHOLDER = '<your-api-key>';

// Neon compute heartbeat: idle Postgres touches (pending-state read +
// last_seen write) align to this single cadence so the compute can
// auto-suspend (Neon Free floor = 5 min). See
// docs/superpowers/specs/2026-06-18-reduce-neon-compute-design.md
export const HEARTBEAT_SEC = 1800; // 30 min

// Online-pill threshold — MUST exceed HEARTBEAT_SEC, otherwise a printer
// flickers offline between heartbeats when last_seen wasn't refreshed yet.
export const ONLINE_THRESHOLD_SEC = 2100; // 35 min

export const MAX_PRINTERS = 10;

// Public URL shown in copy-paste API examples. Falls back to the production
// alias when no Vercel-injected URL is available (local dev, etc.).
export const PUBLIC_BASE_URL =
  process.env.NEXT_PUBLIC_BASE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : 'https://starprinter-hub.vercel.app');

export const API_KEY_PLACEHOLDER = '<your-api-key>';

#!/bin/bash
# Push env vars from .env.local to Vercel production.
# Run once before first `vercel --prod` deploy, and re-run if any secret changes.
#
# Skips:
#   - VERCEL_OIDC_TOKEN     (Vercel-managed)
#   - DATABASE_URL*         (Vercel Postgres marketplace artifacts — we use POSTGRES_URL)
#   - POSTGRES_PRISMA_URL   (Prisma-only, we don't use it)
#   - PG*, NEON_*           (Neon raw fields — only POSTGRES_URL needed)
#
# Note: re-running with same values is safe — Vercel CLI will overwrite.

set -e

if [ ! -f .env.local ]; then
  echo "Error: .env.local not found. Run from web/ directory."
  exit 1
fi

KEEP_KEYS="POSTGRES_URL POSTGRES_URL_NON_POOLING ADMIN_PASSWORD ADMIN_COOKIE_SECRET ZOHO_API_KEY CRON_SECRET"

while IFS= read -r line; do
  [[ -z "$line" || "$line" =~ ^# ]] && continue
  key="${line%%=*}"
  value="${line#*=}"

  # Only push keys we explicitly use
  if [[ ! " $KEEP_KEYS " =~ " $key " ]]; then
    continue
  fi

  if [ -z "$value" ]; then
    echo "  ⚠  Skipping $key — empty value"
    continue
  fi

  echo "  → $key"
  # Remove existing first (ignore errors if not set), then add fresh.
  vercel env rm "$key" production --yes 2>/dev/null || true
  printf '%s' "$value" | vercel env add "$key" production
done < .env.local

echo
echo "Done. Verify: vercel env ls production"

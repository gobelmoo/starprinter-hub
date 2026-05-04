#!/bin/bash
# End-to-end flow test against the running server.
# Default BASE = local dev. Set BASE/PRINTER_ID/MAC to test other targets.
#
# Prerequisite: at least one active printer in the DB.

set -e

BASE="${BASE:-http://localhost:3000}"
MAC="${MAC:-00:11:62:00:00:01}"

if [ ! -f .env.local ]; then
  echo "Error: .env.local not found. Run from web/ directory."
  exit 1
fi

ZOHO_KEY=$(grep '^ZOHO_API_KEY=' .env.local | cut -d= -f2-)
if [ -z "$ZOHO_KEY" ]; then
  echo "Error: ZOHO_API_KEY not found in .env.local"
  exit 1
fi

# Look up first active printer with the given MAC if PRINTER_ID not set
PRINTER_ID="${PRINTER_ID:-}"
if [ -z "$PRINTER_ID" ]; then
  PG_URL=$(grep '^STARPRINTER_DB_URL=' .env.local | cut -d= -f2-)
  if [ -z "$PG_URL" ]; then
    echo "Error: PRINTER_ID not set and STARPRINTER_DB_URL missing"
    exit 1
  fi
  PRINTER_ID=$(node -e "
    const { neon } = require('@neondatabase/serverless');
    const sql = neon(process.argv[1]);
    sql\`SELECT id FROM printers WHERE mac_address = \${process.argv[2]} AND is_active LIMIT 1\`
      .then(r => process.stdout.write(r[0]?.id ?? ''))
      .catch(e => { console.error(e.message); process.exit(1); });
  " "$PG_URL" "$MAC")
fi
echo "Using printerId: $PRINTER_ID"
echo "Using mac:       $MAC"

JOB_ID="TEST-$(date +%s)"
hr() { echo; echo "─── $1 ───"; }

hr "1. Submit markup job ($JOB_ID)"
curl -s -X POST "$BASE/api/print/jobs" \
  -H "x-api-key: $ZOHO_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"printerId\": \"$PRINTER_ID\",
    \"jobId\": \"$JOB_ID\",
    \"markup\": \"[align: centre][mag: w 2; h 2]ทดสอบ[mag]\\n[align: left]\\nรายการ 1   100.00\\n[cut]\"
  }"
echo

hr "2. Printer polls"
curl -s -X POST "$BASE/api/cloudprnt" \
  -H "Content-Type: application/json" \
  -d "{\"printerMAC\":\"$MAC\",\"statusCode\":\"200%20OK\"}"
echo

hr "3. Printer fetches StarPRNT bytes (via cputil)"
curl -s "$BASE/api/cloudprnt?mac=$MAC" | xxd | head -3

hr "4. Printer ACKs"
curl -s -X DELETE -o /dev/null -w "HTTP %{http_code}\n" \
  "$BASE/api/cloudprnt?mac=$MAC&code=200"

hr "5. Re-submit same jobId (idempotency)"
curl -s -X POST "$BASE/api/print/jobs" \
  -H "x-api-key: $ZOHO_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"printerId\": \"$PRINTER_ID\",
    \"jobId\": \"$JOB_ID\",
    \"markup\": \"[align: left]different content\\n[cut]\"
  }"
echo

hr "Done"

#!/bin/bash
# End-to-end flow test against the running server.
# Default BASE = local dev. Set BASE/PRINTER_ID/MAC to test other targets.

set -e

BASE="${BASE:-http://localhost:3000}"
MAC="${MAC:-00:11:62:00:00:01}"

if [ ! -f .env.local ]; then
  echo "Error: .env.local not found. Run from web/ directory."
  exit 1
fi

API_KEY=$(grep '^PRINT_API_KEY=' .env.local | cut -d= -f2-)
if [ -z "$API_KEY" ]; then
  echo "Error: PRINT_API_KEY not found in .env.local"
  exit 1
fi

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

REF_ID="TEST-$(date +%s)"
hr() { echo; echo "─── $1 ───"; }

hr "1. Submit markup job (referenceId=$REF_ID)"
curl -s -X POST "$BASE/api/print/jobs" \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"printerId\": \"$PRINTER_ID\",
    \"referenceId\": \"$REF_ID\",
    \"markup\": \"[align: centre][mag: w 2; h 2]ทดสอบ[mag]\\n[align: left]\\nรายการ 1   100.00\\n[cut]\"
  }"
echo

hr "2. Re-submit same referenceId (each call = new job, no dedup)"
curl -s -X POST "$BASE/api/print/jobs" \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"printerId\": \"$PRINTER_ID\",
    \"referenceId\": \"$REF_ID\",
    \"markup\": \"[align: centre]Re-print same reference\\n[cut]\"
  }"
echo

hr "3. Printer polls"
curl -s -X POST "$BASE/api/cloudprnt" \
  -H "Content-Type: application/json" \
  -d "{\"printerMAC\":\"$MAC\",\"statusCode\":\"200%20OK\"}"
echo

hr "4. Printer fetches StarPRNT bytes (via cputil)"
curl -s "$BASE/api/cloudprnt?mac=$MAC" | xxd | head -3

hr "5. Printer ACKs"
curl -s -X DELETE -o /dev/null -w "HTTP %{http_code}\n" \
  "$BASE/api/cloudprnt?mac=$MAC&code=200"

hr "Done"

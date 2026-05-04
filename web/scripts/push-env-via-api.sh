#!/bin/bash
# Push env vars from .env.local to Vercel production via REST API.
# Reliable replacement for `vercel env add` which has stdin issues with multi-byte values.

set -e

if [ ! -f .env.local ]; then
  echo "Error: .env.local not found"
  exit 1
fi

TOKEN=$(python3 -c 'import json; print(json.load(open("/Users/gobelmo/Library/Application Support/com.vercel.cli/auth.json")).get("token",""))')
PROJECT_ID=$(python3 -c 'import json; print(json.load(open(".vercel/project.json"))["projectId"])')
TEAM_ID=$(python3 -c 'import json; print(json.load(open(".vercel/project.json"))["orgId"])')

if [ -z "$TOKEN" ]; then
  echo "Error: no Vercel auth token found"
  exit 1
fi

KEEP_KEYS="STARPRINTER_DB_URL ADMIN_PASSWORD ADMIN_COOKIE_SECRET ZOHO_API_KEY CRON_SECRET"

# 1) List existing env vars; collect IDs of any KEEP_KEYS to delete first.
echo "Fetching existing env vars..."
EXISTING=$(curl -s "https://api.vercel.com/v9/projects/$PROJECT_ID/env?teamId=$TEAM_ID" \
  -H "Authorization: Bearer $TOKEN")

# Delete each existing one (if matches our keys)
for KEY in $KEEP_KEYS; do
  ID=$(echo "$EXISTING" | python3 -c "
import sys, json
d = json.load(sys.stdin)
for env in d.get('envs', []):
    if env.get('key') == '$KEY' and 'production' in env.get('target', []):
        print(env['id'])
        break
")
  if [ -n "$ID" ]; then
    echo "  ✗ deleting old $KEY ($ID)"
    curl -s -X DELETE "https://api.vercel.com/v9/projects/$PROJECT_ID/env/$ID?teamId=$TEAM_ID" \
      -H "Authorization: Bearer $TOKEN" > /dev/null
  fi
done

# 2) Add fresh values from .env.local
while IFS= read -r line; do
  [[ -z "$line" || "$line" =~ ^# ]] && continue
  key="${line%%=*}"
  value="${line#*=}"

  if [[ ! " $KEEP_KEYS " =~ " $key " ]]; then continue; fi
  if [ -z "$value" ]; then echo "  ⚠  skip $key (empty)"; continue; fi

  echo "  + $key"
  RESPONSE=$(python3 -c "
import json, urllib.request, sys
data = json.dumps({
    'key': '$key',
    'value': sys.argv[1],
    'type': 'encrypted',
    'target': ['production']
}).encode()
req = urllib.request.Request(
    'https://api.vercel.com/v10/projects/$PROJECT_ID/env?teamId=$TEAM_ID',
    data=data,
    headers={
        'Authorization': 'Bearer $TOKEN',
        'Content-Type': 'application/json',
    },
    method='POST',
)
try:
    resp = urllib.request.urlopen(req)
    print('OK', resp.status)
except urllib.error.HTTPError as e:
    print('ERR', e.code, e.read().decode()[:200])
" "$value")
  echo "    → $RESPONSE"
done < .env.local

echo
echo "Done."

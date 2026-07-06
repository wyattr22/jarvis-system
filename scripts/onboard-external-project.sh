#!/usr/bin/env bash
# Onboard an external project (splitwatch, swing, etc.) as an opportunity
# source for Jarvis.
#
# What it does:
#   1. If the project dir isn't a git repo, init it
#   2. Create a private GitHub repo + push
#   3. Register an MCP client for the project with write:opportunities scope
#   4. Print the env vars you need to set in the project (JARVIS_INGEST_URL,
#      JARVIS_INGEST_TOKEN) and the curl example for pushing opportunities
#
# Usage:
#   ./scripts/onboard-external-project.sh <project-dir> <project-name>
#
# Example:
#   ./scripts/onboard-external-project.sh /Users/wyattrantz/splitwatch splitwatch
#
# Required env vars in current shell:
#   CRON_SECRET (or pass --secret <value>)
#   JARVIS_URL (defaults to https://jarvis-system-flame.vercel.app)

set -euo pipefail

PROJECT_DIR="${1:-}"
PROJECT_NAME="${2:-}"
JARVIS_URL="${JARVIS_URL:-https://jarvis-system-flame.vercel.app}"
SECRET="${CRON_SECRET:-}"

if [[ -z "$PROJECT_DIR" || -z "$PROJECT_NAME" ]]; then
  echo "Usage: $0 <project-dir> <project-name>"
  echo "Example: $0 /Users/wyattrantz/splitwatch splitwatch"
  exit 1
fi

if [[ -z "$SECRET" ]]; then
  echo "ERROR: CRON_SECRET not set in shell." >&2
  echo "Run: export CRON_SECRET='...'" >&2
  exit 1
fi

if [[ ! -d "$PROJECT_DIR" ]]; then
  echo "ERROR: $PROJECT_DIR does not exist" >&2
  exit 1
fi

cd "$PROJECT_DIR"

echo "→ Onboarding $PROJECT_NAME at $PROJECT_DIR"
echo

# Step 1+2: git init + GitHub repo
if [[ ! -d .git ]]; then
  echo "→ Initializing git repo"
  git init
  git add .
  git commit -m "chore: bootstrap $PROJECT_NAME"
else
  echo "→ Git repo already initialized — skipping init"
fi

if ! git remote get-url origin > /dev/null 2>&1; then
  echo "→ Creating GitHub repo wyattr22/$PROJECT_NAME"
  gh repo create "wyattr22/$PROJECT_NAME" --private --source=. --remote=origin --push
else
  echo "→ Origin remote already set — skipping repo creation"
fi

echo
echo "→ Registering MCP client for $PROJECT_NAME"
RESP=$(curl -sS -X POST "$JARVIS_URL/api/admin/mcp-clients" \
  -H "Authorization: Bearer $SECRET" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"$PROJECT_NAME\",\"scopes\":[\"write:opportunities\"]}")

TOKEN=$(echo "$RESP" | python3 -c "import sys, json; print(json.load(sys.stdin)['token'])" 2>/dev/null || true)

if [[ -z "$TOKEN" ]]; then
  echo "ERROR: failed to register client. Response:"
  echo "$RESP"
  exit 1
fi

echo "✓ Client registered."
echo
cat <<EOF
========================================
NEXT STEPS — set these in $PROJECT_NAME:
========================================

1. Add to your Vercel environment (or local .env):

   JARVIS_INGEST_URL=$JARVIS_URL/api/opportunities/ingest
   JARVIS_INGEST_TOKEN=$TOKEN

   NOTE: TOKEN is shown only once. Save it now.

2. Add a push helper to your detection flow. Example:

   curl -X POST "\$JARVIS_INGEST_URL" \\
     -H "Authorization: Bearer \$JARVIS_INGEST_TOKEN" \\
     -H "Content-Type: application/json" \\
     -d '{
       "source": "$PROJECT_NAME",
       "asset_class": "equity",
       "instrument": "TICKER",
       "side": "long",
       "thesis": "short rationale here",
       "expected_r": 2.0,
       "win_prob": 0.55,
       "entry_hint": 100.0,
       "stop_hint": 95.0,
       "confidence": 0.7
     }'

3. Open Jarvis /opportunities to verify the row appears after first push.

========================================
EOF

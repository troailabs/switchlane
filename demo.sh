#!/usr/bin/env bash
# Switchlane Demo Scenarios
# Runs 10 real-world task routing scenarios + API lifecycle tests
set -euo pipefail

BASE="http://localhost:3456"
RESULTS_FILE="/tmp/switchlane-demo-results.json"

echo '[]' > "$RESULTS_FILE"

route() {
  local label="$1"
  local task="$2"
  local extra="${3:-}"

  local body="{\"task\": \"$task\", \"limit\": 3${extra:+, $extra}}"
  local start_ms=$(($(python3 -c 'import time; print(int(time.time()*1000))')))
  local result
  result=$(curl -s -X POST "$BASE/v1/route" -H 'Content-Type: application/json' -d "$body")
  local end_ms=$(($(python3 -c 'import time; print(int(time.time()*1000))')))
  local wall_ms=$((end_ms - start_ms))

  # Extract fields
  local category=$(echo "$result" | python3 -c "import sys,json; print(json.load(sys.stdin)['task_profile']['category'])" 2>/dev/null || echo "error")
  local subcategory=$(echo "$result" | python3 -c "import sys,json; print(json.load(sys.stdin)['task_profile'].get('subcategory') or '-')" 2>/dev/null || echo "-")
  local complexity=$(echo "$result" | python3 -c "import sys,json; print(json.load(sys.stdin)['task_profile'].get('complexity','?'))" 2>/dev/null || echo "?")
  local match_path=$(echo "$result" | python3 -c "import sys,json; print(json.load(sys.stdin)['meta']['match_path'])" 2>/dev/null || echo "?")
  local n_recs=$(echo "$result" | python3 -c "import sys,json; print(len(json.load(sys.stdin)['recommendations']))" 2>/dev/null || echo "0")
  local top_agent=$(echo "$result" | python3 -c "import sys,json; r=json.load(sys.stdin)['recommendations']; print(r[0]['agent_id'] if r else '-')" 2>/dev/null || echo "-")
  local top_score=$(echo "$result" | python3 -c "import sys,json; r=json.load(sys.stdin)['recommendations']; print(r[0]['quality_score'] if r else '-')" 2>/dev/null || echo "-")
  local api_ms=$(echo "$result" | python3 -c "import sys,json; print(json.load(sys.stdin)['meta']['elapsed_ms'])" 2>/dev/null || echo "?")

  # Append to results
  python3 -c "
import json
with open('$RESULTS_FILE','r') as f: data=json.load(f)
data.append({
  'label':'$label','task':'$task','category':'$category','subcategory':'$subcategory',
  'complexity':'$complexity','match_path':'$match_path','n_recs':$n_recs,
  'top_agent':'$top_agent','top_score':'$top_score','api_ms':$api_ms,'wall_ms':$wall_ms
})
with open('$RESULTS_FILE','w') as f: json.dump(data,f)
"

  printf "  %-25s → %-20s %-14s %s (%s) %dms\n" "$label" "$category.$subcategory" "$match_path" "$top_agent" "$top_score" "$wall_ms"
}

echo "============================================"
echo " Switchlane Demo — $(date '+%Y-%m-%d %H:%M')"
echo "============================================"
echo ""

# --- Scenario 1: Developer Tools ---
echo "▸ Developer Tools"
route "Git PR Review"          "Review this pull request for code quality issues and suggest improvements"
route "Python Security Audit"  "Scan this Python codebase for security vulnerabilities like SQL injection and XSS"
route "Refactor TypeScript"    "Refactor this TypeScript module to use dependency injection pattern"

echo ""

# --- Scenario 2: Data & Analytics ---
echo "▸ Data & Analytics"
route "Sales Report"           "Analyze quarterly sales CSV data and generate revenue trends report"
route "SQL Query Builder"      "Write a PostgreSQL query to find top customers by lifetime value with window functions"
route "Web Scraping"           "Scrape product prices from 5 e-commerce websites and compare them"

echo ""

# --- Scenario 3: Communication & Social ---
echo "▸ Communication & Social"
route "Slack Notification"     "Send a deployment status message to the #engineering Slack channel"
route "Email Draft"            "Draft a professional follow-up email to a client about project timeline"
route "Reddit Research"        "Search Reddit for user discussions about MCP servers and AI agents"

echo ""

# --- Scenario 4: Infrastructure ---
echo "▸ Infrastructure"
route "K8s Deploy"             "Deploy a Docker container to Kubernetes cluster and configure auto-scaling"

echo ""

# --- Scenario 5: API Lifecycle ---
echo "▸ API Lifecycle"

# Register
echo "  Registering API key..."
REG=$(curl -s -X POST "$BASE/v1/billing/register" -H 'Content-Type: application/json' -d '{"email":"demo@troialabs.ai"}')
API_KEY=$(echo "$REG" | python3 -c "import sys,json; print(json.load(sys.stdin)['api_key'])")
echo "  Key: ${API_KEY:0:20}..."

# Authenticated route
echo "  Routing with API key..."
AUTH_RESULT=$(curl -s -X POST "$BASE/v1/route" -H "Content-Type: application/json" -H "Authorization: Bearer $API_KEY" -d '{"task":"Calculate compound interest formula","limit":3}')
echo "  → $(echo "$AUTH_RESULT" | python3 -c "import sys,json; r=json.load(sys.stdin); print(f\"{r['task_profile']['category']} | top: {r['recommendations'][0]['agent_id'] if r['recommendations'] else '-'}\")")"

# Feedback
echo "  Submitting feedback..."
FB=$(curl -s -X POST "$BASE/v1/feedback" -H "Content-Type: application/json" -d '{"agent_id":"ethanhenrickson-math-mcp","score":0.92,"comment":"Demo: accurate math results"}')
echo "  → score updated to $(echo "$FB" | python3 -c "import sys,json; print(json.load(sys.stdin)['new_combined_score'])")"

# Usage
USAGE=$(curl -s "$BASE/v1/billing/usage" -H "Authorization: Bearer $API_KEY")
echo "  → usage: $(echo "$USAGE" | python3 -c "import sys,json; u=json.load(sys.stdin); print(f\"{u['requests_this_month']}/{u['monthly_limit']} requests\")")"

# Taxonomy
TAX=$(curl -s "$BASE/v1/tasks/taxonomy")
TOTAL_AGENTS=$(echo "$TAX" | python3 -c "import sys,json; print(json.load(sys.stdin)['total_agents'])")
TOTAL_TOOLS=$(echo "$TAX" | python3 -c "import sys,json; print(json.load(sys.stdin)['total_tools'])")
TOP_TAGS=$(echo "$TAX" | python3 -c "import sys,json; tags=json.load(sys.stdin)['tags'][:5]; print(', '.join(f\"{t['tag']}({t['count']})\" for t in tags))")
echo "  → Registry: $TOTAL_AGENTS agents, $TOTAL_TOOLS tools | Top tags: $TOP_TAGS"

echo ""
echo "============================================"
echo " All scenarios complete. Results: $RESULTS_FILE"
echo "============================================"

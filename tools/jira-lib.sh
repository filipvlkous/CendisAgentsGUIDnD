#!/usr/bin/env bash
# Shared helpers for the read-only Jira quest tools. Mirrors the jira-workflow skill and the
# jira-intake agent: credentials from ./.loc.env, /myself check first, retries on 429/5xx/timeouts,
# and failures reported as "BLOCKED: <cause> — <error>" with intake's cause names.
# Sourced, never run. The token stays inside these scripts; agents only see their output.

blocked() { # $1 = cause, $2 = detail
  echo "BLOCKED: $1 — $2" >&2
  exit 3
}

jira_load_credentials() {
  [ -f ./.loc.env ] || blocked no-credentials ".loc.env not found in $(pwd)"
  set -a
  # shellcheck disable=SC1091
  . ./.loc.env
  set +a
  local v
  for v in JIRA_DOMAIN JIRA_EMAIL JIRA_API_TOKEN; do
    [ -n "${!v:-}" ] || blocked no-credentials "$v is empty in .loc.env"
  done
}

# GET https://$JIRA_DOMAIN<path> and print the body. Extra args go to curl (e.g. --get --data-urlencode).
# Retries up to 3 times on 429, 5xx and network errors, like the intake agent.
jira_get() {
  local path=$1
  shift
  local body status attempt wait
  body=$(mktemp)
  for attempt in 1 2 3 4; do
    status=$(curl -s -o "$body" -w '%{http_code}' --max-time 30 \
      -u "$JIRA_EMAIL:$JIRA_API_TOKEN" -H 'Accept: application/json' "$@" \
      "https://$JIRA_DOMAIN$path") || status=000
    case $status in
      2??) cat "$body"; rm -f "$body"; return 0 ;;
      429 | 5?? | 000)
        [ "$attempt" -eq 4 ] && break
        wait=$((attempt * 5))
        echo "# Jira answered $status, retrying in ${wait}s ($attempt/3)" >&2
        sleep "$wait"
        ;;
      *) break ;;
    esac
  done
  local msg
  msg=$(jq -r '(.errorMessages // []) + ((.errors // {}) | [.[]]) | join("; ")' "$body" 2>/dev/null | head -c 300)
  rm -f "$body"
  case $status in
    401 | 403) [ "$path" = /rest/api/3/myself ] && blocked invalid-credentials "HTTP $status from /myself" ;;
  esac
  blocked jira-error "HTTP $status on ${path%%\?*}${msg:+: $msg}"
}

# /search/jql answers unauthenticated requests with 200 and zero issues, so always check the login first.
jira_whoami() {
  jira_get /rest/api/3/myself | jq -r .displayName
}

# ADF → prose, keeping each image where it sits as [[image: …]] (the skill's step 3 query).
ADF_PROSE='[.. | objects
  | select(has("text") or .type == "media" or .type == "mediaInline")
  | if .text then .text else "\n[[image: \(.attrs.alt // .attrs.url // .attrs.id)]]\n" end]
  | join(" ")'

# Every link in an ADF tree: marks, card attrs and bare URLs typed as plain text.
ADF_LINKS='([.. | (.attrs?.url, .attrs?.href, .marks?[]?.attrs?.href) // empty]
  + ([.. | .text? // empty] | join(" ") | [scan("https?://[^ )\\]]+")]))
  | map(select(. != null)) | unique[]'

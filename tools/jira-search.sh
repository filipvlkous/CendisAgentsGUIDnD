#!/usr/bin/env bash
# Read-only Jira search for quests. Usage: jira-search.sh "<JQL>"
# Loads JIRA_DOMAIN / JIRA_EMAIL / JIRA_API_TOKEN from ./.loc.env in the working directory, so the
# token never appears in the agent's command or context. Prints "# logged in as: <name>" and then
# one JSON line per issue. Allow it in a quest with: Bash(<abs path>/tools/jira-search.sh:*)
set -euo pipefail
. "$(dirname "$0")/jira-lib.sh"

JQL=${1:?usage: jira-search.sh \"<JQL>\"}
jira_load_credentials
echo "# logged in as: $(jira_whoami)"

token=""
while :; do
  args=(--get --data-urlencode "jql=$JQL" --data-urlencode "fields=summary,status,issuetype,priority,updated,parent,project" --data maxResults=100)
  [ -n "$token" ] && args+=(--data-urlencode "nextPageToken=$token")
  page=$(jira_get /rest/api/3/search/jql "${args[@]}")
  jq -c '.issues[] | {key, summary: .fields.summary, status: .fields.status.name,
    category: .fields.status.statusCategory.key, type: .fields.issuetype.name,
    priority: .fields.priority.name, updated: .fields.updated[0:10], parent: .fields.parent.key,
    project: .fields.project.name}' <<<"$page"
  # More pages exist exactly when a nextPageToken is returned. (Not `.isLast // true`: jq's `//` treats false as missing.)
  token=$(jq -r '.nextPageToken // empty' <<<"$page")
  [ -z "$token" ] && break
done

#!/usr/bin/env bash
# Decides whether this Daily Emails run should send (prints send=true|false).
#
# GitHub starts scheduled runs late — often hours late — so the old "only in
# the 6 o'clock hour" check skipped every run from 2026-10-02 to 10-12 and no
# morning email went out. Now the workflow runs hourly and the FIRST run at or
# after 6 AM New York time sends; any later run that day sees an earlier run
# already reached the send step and skips, so nobody gets two emails.
#
# A manual "Run workflow" always sends; a dispatch with GATED=true (Vercel Cron)
# goes through the same gate as a scheduled run. Needs GH_TOKEN (actions: read),
# GITHUB_REPOSITORY, GITHUB_RUN_ID, EVENT_NAME and optionally GATED.
set -euo pipefail

if [ "${EVENT_NAME}" != "schedule" ] && [ "${GATED:-false}" != "true" ]; then
  echo "Manual run (${EVENT_NAME}): sending." >&2
  echo "send=true"
  exit 0
fi

hour=$(TZ=America/New_York date +%-H)
if [ "${hour}" -lt 6 ]; then
  echo "Before 6 AM in New York (hour=${hour}): not yet." >&2
  echo "send=false"
  exit 0
fi

today=$(TZ=America/New_York date +%F)
since=$(date -u -d "TZ=\"America/New_York\" ${today} 00:00" +%Y-%m-%dT%H:%M:%SZ)
workflow_id=$(gh api "repos/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}" --jq '.workflow_id')
run_ids=$(gh api "repos/${GITHUB_REPOSITORY}/actions/workflows/${workflow_id}/runs?created=>=${since}&per_page=100" \
  --jq ".workflow_runs[] | select(.id != ${GITHUB_RUN_ID}) | .id")

for id in ${run_ids}; do
  # "success" or "failure" both mean the digest step ran (possibly partly), so a
  # second send could duplicate emails. Only "skipped" / not-yet-run counts as unsent.
  ran=$(gh api "repos/${GITHUB_REPOSITORY}/actions/runs/${id}/jobs" \
    --jq '[.jobs[].steps[] | select(.name == "Send morning bid digest") | select(.conclusion == "success" or .conclusion == "failure")] | length')
  if [ "${ran}" != "0" ]; then
    echo "Run ${id} already sent today's emails (New York date ${today}): skipping." >&2
    echo "send=false"
    exit 0
  fi
done

echo "First run at or after 6 AM New York time on ${today} (hour=${hour}, event=${EVENT_NAME}): sending." >&2
echo "send=true"

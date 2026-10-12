#!/usr/bin/env bash
# Decides whether this Sync Bids run should go ahead (prints run=true|false).
#
# Vercel Cron (/api/cron/sync-bids, owner 2026-10-12) starts the sync on time
# with gated=true; GitHub's own schedule stays as a late backup. So a sync is
# skipped when another Sync Bids run already started within the last
# WINDOW_MINUTES (default 210) — a late GitHub start right after a Vercel start
# must not run the same multi-minute scrape twice. A manual "Run workflow"
# without gated=true always runs.
#
# Needs GH_TOKEN (actions: read), GITHUB_REPOSITORY, GITHUB_RUN_ID, EVENT_NAME,
# optionally GATED and WINDOW_MINUTES.
set -euo pipefail

if [ "${EVENT_NAME}" != "schedule" ] && [ "${GATED:-false}" != "true" ]; then
  echo "Manual run (${EVENT_NAME}): syncing." >&2
  echo "run=true"
  exit 0
fi

window="${WINDOW_MINUTES:-210}"
since=$(date -u -d "-${window} minutes" +%Y-%m-%dT%H:%M:%SZ)
workflow_id=$(gh api "repos/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}" --jq '.workflow_id')
# Any other run started in the window that did not get skipped by this gate
# (a run whose sync job was skipped has conclusion "skipped" on that job).
for id in $(gh api "repos/${GITHUB_REPOSITORY}/actions/workflows/${workflow_id}/runs?created=>=${since}&per_page=100" \
  --jq ".workflow_runs[] | select(.id != ${GITHUB_RUN_ID}) | select(.id < ${GITHUB_RUN_ID}) | .id"); do
  ran=$(gh api "repos/${GITHUB_REPOSITORY}/actions/runs/${id}/jobs" \
    --jq '[.jobs[] | select(.name == "Run bid sync") | select(.status == "in_progress" or .status == "queued" or .conclusion == "success" or .conclusion == "failure")] | length')
  if [ "${ran}" != "0" ]; then
    echo "Run ${id} already synced within the last ${window} minutes: skipping." >&2
    echo "run=false"
    exit 0
  fi
done

echo "No sync in the last ${window} minutes (event=${EVENT_NAME}): syncing." >&2
echo "run=true"

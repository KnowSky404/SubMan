#!/usr/bin/env bash
set -euo pipefail

repo=$1
sha=$2

gh api --method GET "repos/$repo/actions/workflows/ci.yml/runs" \
  -f branch=main -f event=push -f head_sha="$sha" -F per_page=100 |
  jq -er --arg sha "$sha" '
    [.workflow_runs[] | select(
      .head_sha == $sha and .head_branch == "main" and .event == "push"
    )] | max_by(.id) |
    select(.status == "completed" and .conclusion == "success") | .html_url
  '

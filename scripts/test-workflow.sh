#!/usr/bin/env bash
set -euo pipefail

scripts=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
temp=$(mktemp -d)
trap 'rm -rf "$temp"' EXIT
git init -q "$temp"
cd "$temp"
git config user.name 'Workflow fixture'
git config user.email 'fixture@example.invalid'
git config commit.gpgSign false

mkdir -p docs/wiki src/lib/server
touch docs/wiki/User-Guide.md src/lib/server/auth.ts
git add .
git commit -qm base
base=$(git rev-parse HEAD)

expect_scope() {
  local expected=$1 head candidate
  git add -A
  head=$(git commit-tree "$(git write-tree)" -p "$base" -m head)
  candidate=$(git commit-tree "$(git write-tree)" -p "$base" -p "$head" -m merge)
  test "$(bash "$scripts/ci-scope.sh" "$base" "$candidate" "$head")" = "$expected"
  if bash "$scripts/ci-scope.sh" "$base" "$candidate" "$base"; then
    echo 'Accepted stale PR evidence' >&2
    exit 1
  fi
  git reset -q --hard "$base"
}

echo 'Guide edit' > docs/wiki/User-Guide.md
expect_scope docs
touch src/app.css
echo 'Guide edit' > docs/wiki/User-Guide.md
expect_scope ui
echo 'Feature' > src/feature.ts
expect_scope full
touch src/app.css
echo 'Auth' > src/lib/server/auth.ts
expect_scope full
touch docs/wiki/Development.md
expect_scope full
mv src/lib/server/auth.ts docs/wiki/Old-Auth.md
expect_scope full
touch $'docs/wiki/Guide\nAGENTS.md' AGENTS.md
expect_scope full

gh() {
  test "$*" = 'api --method GET repos/Owner/Repo/actions/workflows/ci.yml/runs -f branch=main -f event=push -f head_sha=candidate -F per_page=100' ||
    return 2
  printf '%s\n' "$CI_RESPONSE"
}
export -f gh

ok='{"id":1,"head_sha":"candidate","head_branch":"main","event":"push","status":"completed","conclusion":"success","html_url":"https://github.com/Owner/Repo/actions/runs/1"}'
export CI_RESPONSE
CI_RESPONSE="{\"workflow_runs\":[$ok]}"
test "$(bash "$scripts/production-ci.sh" Owner/Repo candidate)" = 'https://github.com/Owner/Repo/actions/runs/1'
cancelled=$(jq -c '.id = 2 | .conclusion = "cancelled"' <<< "$ok")
pending=$(jq -c '.id = 3 | .status = "in_progress" | .conclusion = null' <<< "$ok")
for response in '[]' 'null' \
  "[${ok/candidate/previous}]" \
  "[${ok/push/pull_request}]" \
  "[${ok/main/topic}]" \
  "[$ok,$cancelled]" \
  "[$ok,$pending]"; do
  CI_RESPONSE="{\"workflow_runs\":$response}"
  if bash "$scripts/production-ci.sh" Owner/Repo candidate 2>/dev/null; then
    echo 'Accepted stale or incomplete release evidence' >&2
    exit 1
  fi
done

echo 'Workflow fixtures passed'

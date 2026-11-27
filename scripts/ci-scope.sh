#!/usr/bin/env bash
set -euo pipefail

base=$1
candidate=$2
head=$3
[[ "$(git rev-parse "$candidate^1")" == "$base" ]]
[[ "$(git rev-parse "$candidate^2")" == "$head" ]]

files=$(mktemp)
trap 'rm -f "$files"' EXIT
git diff --no-renames --name-only -z "$base" "$candidate" -- > "$files"

scope=docs
while IFS= read -r -d '' path; do
  case "$path" in
    docs/wiki/Development*.md) scope=full; break ;;
    docs/wiki/*.md) ;;
    src/app.css) scope=ui ;;
    *) scope=full; break ;;
  esac
done < "$files"
echo "$scope"

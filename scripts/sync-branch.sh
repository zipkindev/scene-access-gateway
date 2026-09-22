#!/bin/sh
set -eu

repository_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$repository_root"

branch=$(git symbolic-ref --quiet --short HEAD) || {
  echo "refusing to sync a detached HEAD" >&2
  exit 1
}
if [ -n "$(git status --porcelain --untracked-files=normal)" ]; then
  echo "commit or remove all non-ignored changes before syncing" >&2
  exit 1
fi
if ! git remote get-url origin >/dev/null 2>&1; then
  echo "origin is not configured" >&2
  exit 1
fi

git fetch origin
git rebase origin/main
"$repository_root/scripts/test.sh"
git push --set-upstream origin "$branch"

echo "synced $branch; GitHub CI will run the container build and smoke tests"

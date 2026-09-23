#!/bin/sh
set -eu

repository_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

"$repository_root/scripts/verify-build-inputs.sh"
"$repository_root/scripts/prepare-workspace-assets.sh"

for source_file in "$repository_root"/backend/src/*.js; do
  node --check "$source_file"
done

sh -n "$repository_root"/scripts/*.sh
docker compose -f "$repository_root/compose.yaml" config --quiet
docker compose -f "$repository_root/compose.yaml" -f "$repository_root/compose.maxmind.yaml" config --quiet

if [ -d "$repository_root/backend/src/node_modules" ]; then
  (cd "$repository_root/backend/src" && npm test)
else
  echo "dependency-backed tests skipped: run npm ci in backend/src or build the backend image" >&2
fi

#!/bin/sh
set -eu

repository_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
node_image=$(node -e "process.stdout.write(require('$repository_root/manifests/container-bases.json').images.node)" 2>/dev/null || true)

if command -v node >/dev/null 2>&1; then
  exec node "$repository_root/scripts/verify-build-inputs.mjs"
fi

if [ -z "$node_image" ]; then
  node_image=$(sed -n 's/.*"node": "\([^"]*\)".*/\1/p' "$repository_root/manifests/container-bases.json")
fi

if [ -n "${SAG_ARTWORK_ROOT:-}" ]; then
  exec docker run --rm \
    --read-only \
    --network none \
    --volume "$repository_root:/workspace:ro" \
    --volume "$SAG_ARTWORK_ROOT:/asset-input:ro" \
    --env SAG_ARTWORK_ROOT=/asset-input \
    --workdir /workspace \
    "$node_image" \
    node scripts/verify-build-inputs.mjs
else
  exec docker run --rm \
    --read-only \
    --network none \
    --volume "$repository_root:/workspace:ro" \
    --workdir /workspace \
    "$node_image" \
    node scripts/verify-build-inputs.mjs
fi

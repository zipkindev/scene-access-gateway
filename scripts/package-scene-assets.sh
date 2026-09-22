#!/bin/sh
set -eu

repository_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
output=${1:-"$repository_root/.local/releases/scene-access-gateway-assets-v1.tar.gz"}

"$repository_root/scripts/verify-build-inputs.sh"

if [ -e "$output" ]; then
  echo "refusing to overwrite existing bundle: $output" >&2
  exit 1
fi

mkdir -p "$(dirname -- "$output")"
(
  cd "$repository_root"
  tar --sort=name --mtime='UTC 1970-01-01' --owner=0 --group=0 --numeric-owner \
    -czf "$output" frontend/artwork
)

expected_hash=$(sed -n 's/^[[:space:]]*"sha256": "\([0-9a-f]*\)".*/\1/p' \
  "$repository_root/manifests/scene-assets-release.json")
actual_hash=$(sha256sum "$output" | awk '{print $1}')
if [ "$actual_hash" != "$expected_hash" ]; then
  echo "packaged asset checksum changed; create a new asset release manifest" >&2
  exit 1
fi

printf '%s  %s\n' "$actual_hash" "$output"

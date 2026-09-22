#!/bin/sh
set -eu

repository_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
node "$repository_root/scripts/import-audio.mjs" "${1:-}"
SAG_REQUIRE_AUDIO=1 "$repository_root/scripts/verify-build-inputs.sh"

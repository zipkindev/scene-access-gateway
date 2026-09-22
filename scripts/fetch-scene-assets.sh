#!/bin/sh
set -eu

repository_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
audio_root="$repository_root/frontend/artwork/audio"
missing=0

for filename in $(sed -n 's/^[[:space:]]*"filename": "\([^"]*\.mp3\)",/\1/p' "$audio_root/manifest.json"); do
  if [ ! -f "$audio_root/$filename" ]; then
    missing=1
  fi
done

if [ "$missing" -eq 0 ]; then
  exec "$repository_root/scripts/verify-build-inputs.sh"
fi

source=${1:-${SAG_AUDIO_SOURCE_DIR:-}}
if [ -z "$source" ]; then
  "$repository_root/scripts/verify-build-inputs.sh"
  echo "optional third-party audio is not installed; building the public source profile"
  exit 0
fi
exec "$repository_root/scripts/import-audio.sh" "$source"

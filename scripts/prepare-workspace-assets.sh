#!/bin/sh
set -eu

repository_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
asset_root="$repository_root/backend/src/assets"
audio_root="$repository_root/backend/src/audio-samples"

mkdir -p "$asset_root" "$asset_root/motion" "$asset_root/scene-bundles" "$audio_root"
cp -R "$repository_root/frontend/artwork/backgrounds/." "$asset_root/"
cp -R "$repository_root/frontend/artwork/motion/." "$asset_root/motion/"
cp -R "$repository_root/frontend/artwork/interactive/." "$asset_root/scene-bundles/"
set -- "$repository_root"/frontend/artwork/audio/*.mp3
if [ -e "$1" ]; then
  cp "$@" "$audio_root/"
fi

echo "prepared verified backend artwork and optional audio inputs"

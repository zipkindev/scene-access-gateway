#!/bin/sh
set -eu

repository_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$repository_root"

"$repository_root/scripts/fetch-scene-assets.sh"
docker compose build --pull=false "$@"
docker build --pull=false \
  -t "${SAG_IMAGE_NAMESPACE:-scene-access-gateway}/waf:${SAG_IMAGE_TAG:-dev}" \
  "$repository_root/deploy/waf"

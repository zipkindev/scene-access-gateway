#!/bin/sh
set -eu

repository_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
output_path=${1:-"$repository_root/.local/images/scene-access-gateway-${SAG_IMAGE_TAG:-dev}.tar"}
image_namespace=${SAG_IMAGE_NAMESPACE:-scene-access-gateway}
image_tag=${SAG_IMAGE_TAG:-dev}

mkdir -p "$(dirname -- "$output_path")"
docker image save \
  --output "$output_path" \
  "$image_namespace/frontend:$image_tag" \
  "$image_namespace/backend:$image_tag"

sha256sum "$output_path"

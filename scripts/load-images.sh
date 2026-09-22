#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
  echo "usage: $0 <scene-access-gateway-images.tar>" >&2
  exit 2
fi

docker image load --input "$1"

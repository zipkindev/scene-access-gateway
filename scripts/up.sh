#!/bin/sh
set -eu

repository_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
"$repository_root/scripts/bootstrap.sh"
cd "$repository_root"
docker compose up -d "$@"

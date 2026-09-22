#!/bin/sh
set -eu

repository_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

mkdir -p \
  "$repository_root/.local/data" \
  "$repository_root/.local/secrets" \
  "$repository_root/.local/tls"

if [ ! -e "$repository_root/.env" ]; then
  cp "$repository_root/.env.example" "$repository_root/.env"
  echo "created .env from .env.example; review it before starting services"
else
  echo "kept existing .env"
fi

echo "local directories are ready under $repository_root/.local"

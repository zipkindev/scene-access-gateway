#!/bin/sh
set -eu

repository_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

mkdir -p \
  "$repository_root/.local/data" \
  "$repository_root/.local/secrets" \
  "$repository_root/.local/tls"

source_intelligence_token="$repository_root/.local/secrets/source-intelligence-token"
if [ ! -e "$source_intelligence_token" ]; then
  umask 077
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 36 | tr -d '\n' >"$source_intelligence_token"
  elif command -v node >/dev/null 2>&1; then
    node -e "process.stdout.write(require('node:crypto').randomBytes(36).toString('base64'))" >"$source_intelligence_token"
  else
    echo "source-intelligence token generation requires either openssl or Node.js" >&2
    exit 1
  fi
  chmod 0600 "$source_intelligence_token"
  echo "created source-intelligence worker token"
fi

if [ ! -e "$repository_root/.env" ]; then
  cp "$repository_root/.env.example" "$repository_root/.env"
  echo "created .env from .env.example; review it before starting services"
else
  echo "kept existing .env"
fi

echo "local directories are ready under $repository_root/.local"

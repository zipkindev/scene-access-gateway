#!/bin/sh
set -eu

repository_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
secret_root="$repository_root/.local/secrets"
umask 077
mkdir -p "$secret_root"

random_base64() {
  byte_count=$1
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 "$byte_count" | tr -d '\n'
  elif command -v node >/dev/null 2>&1; then
    node -e "process.stdout.write(require('node:crypto').randomBytes(Number(process.argv[1])).toString('base64'))" "$byte_count"
  else
    echo "secret generation requires either openssl or Node.js" >&2
    exit 1
  fi
}

create_secret() {
  secret_path=$1
  byte_count=$2
  if [ -e "$secret_path" ]; then
    echo "kept existing ${secret_path##*/}"
    return
  fi
  random_base64 "$byte_count" >"$secret_path"
  chmod 0600 "$secret_path"
  echo "created ${secret_path##*/}"
}

create_secret "$secret_root/postgres-password" 36
create_secret "$secret_root/authentik-secret-key" 60
create_secret "$secret_root/source-intelligence-token" 36
chmod 0444 "$secret_root/source-intelligence-token"

if [ ! -e "$secret_root/smtp-password" ]; then
  : >"$secret_root/smtp-password"
  chmod 0600 "$secret_root/smtp-password"
  echo "created empty smtp-password; populate it only when SMTP is configured"
else
  echo "kept existing smtp-password"
fi

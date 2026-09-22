#!/bin/sh
set -eu

missing=0
for command_name in git docker; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "missing required command: $command_name" >&2
    missing=1
  fi
done

if command -v docker >/dev/null 2>&1 && ! docker compose version >/dev/null 2>&1; then
  echo "missing required Docker Compose v2 plugin" >&2
  missing=1
fi

if [ "$missing" -ne 0 ]; then
  exit 1
fi

echo "Git: $(git --version)"
echo "Docker: $(docker --version)"
docker compose version


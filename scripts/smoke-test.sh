#!/bin/sh
set -eu

repository_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
smoke_project="sag-smoke-$$"
smoke_port=${SAG_SMOKE_HTTP_PORT:-18080}
smoke_editor_port=${SAG_SMOKE_EDITOR_PORT:-18081}

cleanup() {
  docker compose -p "$smoke_project" -f "$repository_root/compose.yaml" down -v >/dev/null 2>&1 || true
}
trap cleanup EXIT HUP INT TERM

"$repository_root/scripts/bootstrap.sh"

SAG_HTTP_PORT=$smoke_port \
SAG_EDITOR_PORT=$smoke_editor_port \
SAG_PUBLIC_ORIGIN="http://localhost:$smoke_port" \
SAG_EDITOR_ORIGIN="http://localhost:$smoke_editor_port" \
docker compose -p "$smoke_project" -f "$repository_root/compose.yaml" up -d --wait

curl -fsS "http://127.0.0.1:$smoke_port/healthz" >/dev/null
curl -fsS "http://127.0.0.1:$smoke_port/" | grep -q '<title>ZArcade</title>'
curl -fsS "http://127.0.0.1:$smoke_port/assets/rain-city-qr-embossed-v6.png" >/dev/null
if [ -f "$repository_root/frontend/artwork/audio/freesound_community-calm-loop-80576.mp3" ]; then
  curl -fsS "http://127.0.0.1:$smoke_port/audio-samples/freesound_community-calm-loop-80576.mp3" >/dev/null
else
  test "$(curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:$smoke_port/audio-samples/freesound_community-calm-loop-80576.mp3")" = 404
fi
curl -fsS "http://127.0.0.1:$smoke_editor_port/" | grep -q '<title>Scene management</title>'
curl -fsS "http://127.0.0.1:$smoke_editor_port/healthz" >/dev/null
test "$(curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:$smoke_port/wp-login.php")" = 404
curl -fsS "http://127.0.0.1:$smoke_editor_port/api/security/summary" | grep -q '"retentionDays":'
curl -fsS "http://127.0.0.1:$smoke_editor_port/api/security/events?limit=20" | grep -q 'automated_scanner_probe'

echo "local frontend, backend, artwork, editor, and security monitoring smoke tests passed"

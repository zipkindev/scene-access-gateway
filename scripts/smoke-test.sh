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
curl -fsS "http://127.0.0.1:$smoke_editor_port/admin.js" | grep -q 'MaxMind GeoLite2'
curl -fsS "http://127.0.0.1:$smoke_editor_port/healthz" >/dev/null
probe_headers=$(curl -sS -D - -o /dev/null "http://127.0.0.1:$smoke_port/wp-login.php")
probe_status=$(printf '%s\n' "$probe_headers" | awk 'NR == 1 { print $2 }')
probe_request_id=$(printf '%s\n' "$probe_headers" | awk 'tolower($1) == "x-request-id:" { gsub("\\r", "", $2); print $2 }')
test "$probe_status" = 404
case "$probe_request_id" in
  ????????-????-????-????-????????????) ;;
  *) echo "probe response did not contain a request UUID" >&2; exit 1 ;;
esac
curl -fsS "http://127.0.0.1:$smoke_editor_port/api/security/summary" | grep -q '"retentionDays":'
curl -fsS "http://127.0.0.1:$smoke_editor_port/api/security/maxmind" | grep -q '"mode":"scene-management"'
security_events=$(curl -fsS "http://127.0.0.1:$smoke_editor_port/api/security/events?limit=20")
printf '%s\n' "$security_events" | grep -q 'automated_scanner_probe'
printf '%s\n' "$security_events" | grep -q '"status":404'
printf '%s\n' "$security_events" | grep -q "\"requestId\":\"$probe_request_id\""
frontend_logs=$(docker compose -p "$smoke_project" -f "$repository_root/compose.yaml" logs --no-color --no-log-prefix frontend)
printf '%s\n' "$frontend_logs" | grep -q "\"backend_request_id\":\"$probe_request_id\""
printf '%s\n' "$frontend_logs" | grep -q '"route":"/wp-login.php"'
if printf '%s\n' "$frontend_logs" | grep -q '"request_uri":'; then
  echo "frontend logs exposed the raw request URI" >&2
  exit 1
fi

test "$(curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:$smoke_port/.env")" = 404
test "$(curl -sS -o /dev/null -w '%{http_code}' -H 'X-Management-Source-IP: 127.0.0.1' "http://127.0.0.1:$smoke_port/internal/torrentharbor-management/status")" = 404
test "$(curl -sS -o /dev/null -w '%{http_code}' -H 'Host: attacker.invalid' "http://127.0.0.1:$smoke_port/")" = 421
test "$(curl -sS -o /dev/null -w '%{http_code}' -X TRACE "http://127.0.0.1:$smoke_port/")" = 405

versioned_headers=$(curl -sS -D - -o /dev/null "http://127.0.0.1:$smoke_port/scene-framing.js?v=23")
printf '%s\n' "$versioned_headers" | grep -qi '^cache-control: public, max-age=31536000, immutable'
printf '%s\n' "$versioned_headers" | grep -qi '^permissions-policy:'
compressed_headers=$(curl -sS -H 'Accept-Encoding: gzip' -D - -o /dev/null "http://127.0.0.1:$smoke_port/scene-framing.js?v=23")
printf '%s\n' "$compressed_headers" | grep -qi '^content-encoding: gzip'

rate_limited=false
attempt=0
while [ "$attempt" -lt 100 ]; do
  status=$(curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:$smoke_port/assets/rain-city-qr-embossed-v6.png")
  if [ "$status" = 429 ]; then rate_limited=true; break; fi
  attempt=$((attempt + 1))
done
test "$rate_limited" = true

echo "local frontend, backend, artwork, editor, and security monitoring smoke tests passed"

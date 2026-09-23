#!/bin/sh
set -eu

repository_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
waf_root="$repository_root/deploy/waf"

for marker in \
  'MODSEC_RULE_ENGINE: DetectionOnly' \
  'BLOCKING_PARANOIA: "1"' \
  'DETECTION_PARANOIA: "2"' \
  'MODSEC_AUDIT_LOG_PARTS: AHZ' \
  'network_mode: service:access-proxy' \
  'pid: service:access-waf'; do
  grep -F "$marker" "$waf_root/compose.example.yaml" >/dev/null
done

grep -F 'server_name ${WAF_SERVER_NAMES};' "$waf_root/default.conf.template" >/dev/null
grep -F 'location / { return 444; }' "$waf_root/default.conf.template" >/dev/null

if grep -E '(zipkin\.dev|192\.168\.|/mnt/)' "$waf_root"/*.yaml "$waf_root"/*.template >/dev/null; then
  echo 'WAF deployment source contains an environment-specific hostname, address, or path' >&2
  exit 1
fi

SAG_ORIGIN_IMAGE=example.invalid/origin:test \
SAG_ORIGIN_CONFIG=/protected/origin.conf \
SAG_TLS_DIR=/protected/tls \
SAG_WAF_AUDIT_DIR=/protected/waf-audit \
SAG_WAF_SERVER_NAMES='portal.example.invalid arcade.example.invalid' \
SAG_WAF_HEALTH_HOST=portal.example.invalid \
docker compose -f "$waf_root/compose.example.yaml" config --quiet

# Configuration

Copy `.env.example` to `.env` with `scripts/bootstrap.sh`, then review every
value. The `.env` file is ignored by Git.

The base `compose.yaml` starts the frontend, backend, and isolated
source-intelligence worker. It uses a named volume for portal state and does
not require external credentials merely to display the local portal and
editor. The worker is unexposed, uses a dedicated authentication secret, and
keeps active investigation disabled by default.
Portable Compose keeps `.local/secrets/` mode `0700` and presents this one
machine-to-machine token as a read-only mode-`0444` Compose secret so host and
container user IDs do not need to match. Other credential files remain mode
`0600`.

## Configuration ownership

| Input | Location | Public? |
| --- | --- | --- |
| Safe defaults and variable names | `.env.example` | Yes |
| Local environment values | `.env` | No; ignored |
| Generated secret files | `.local/secrets/` | No; ignored |
| Host, proxy, TLS, storage, and network overrides | `.local/` Compose overlays | No; ignored |
| Runtime scene and security state | `portal_data` volume | No |
| Licensed optional media and GeoIP databases | Protected local directories | No |

To add the local Authentik/PostgreSQL stack:

```sh
./scripts/init-secrets.sh
docker compose -f compose.yaml -f compose.authentik.yaml config
docker compose -f compose.yaml -f compose.authentik.yaml up -d
```

Set `SAG_AUTHENTIK_API_BASE_URL=http://authentik-server:9000` when the backend
should call the included Authentik service. SMTP remains disabled until its
host, sender, username, and protected password file are populated.

Never store TLS private keys, SMTP passwords, Authentik tokens, signing keys,
database exports, or active portal state in tracked configuration.

## Security events and GeoIP

Application security events are retained for 30 days by default. Set
`SAG_SECURITY_EVENT_RETENTION_DAYS` to a value from 1 through 365.
`SAG_SECURITY_EVENT_MAX_BYTES` defaults to 67108864 (64 MiB). To enrich source
IPs without sending them to a third party, add `compose.maxmind.yaml` and
connect a MaxMind account from Scene Management. Credentials and downloaded
databases stay in the protected persistent state volume and are never embedded
in an image. For host-managed installations, place current licensed GeoLite2
City and ASN databases in `SAG_GEOIP_DIR` and use `compose.geoip.yaml` instead.
`scripts/update-geoip.sh` remains available for headless database maintenance.

See [security monitoring](../security-monitoring.md) for the trusted-proxy
requirement, privacy limits, and public-exposure checklist.

Application routing and exceptions are inventoried in
`deploy/applications.json`; environment-specific values remain in `.env` or an
ignored deployment overlay. Update the contract and pass
`scripts/check-application-contracts.js` before adding proxy routes, Authentik
groups, QR destinations, CSP sources, cookies, or WAF exclusions.

`SAG_SOURCE_INTELLIGENCE_ACTIVE_ENABLED` defaults to `false`. Passive source
investigations still combine the local event ledger and GeoLite data with
RDAP, reverse-DNS, and routing evidence through the isolated, unexposed helper.
Enabling the setting permits only the fixed, explicitly confirmed ethical-
reconnaissance profile documented in [security monitoring](../security-monitoring.md).

`SAG_MANAGEMENT_SOURCE_IP` identifies the direct TCP peer allowed to use the
TorrentHarbor management API on the private backend network. Public Nginx
denies that route and removes caller-supplied management source headers. Do not
set this value to a shared public reverse proxy address or publish the backend
port.

`SAG_PUBLIC_HOST_ALIASES` is a comma-separated list of additional public DNS
hostnames served by the same portal, such as `arcade.example.com`. The backend
accepts the canonical `SAG_PUBLIC_ORIGIN` hostname and only these explicit
aliases, with either the canonical origin port or the default external port.
Do not use wildcards or include schemes, paths, or ports in the alias list.

Production TLS/WAF configuration must preserve normalized access logging,
secret-probe and management-route denials, source-header replacement, request
timeouts, compression, and rate limits. Keep new WAF policies in observation
mode during representative validation. Configure HSTS at TLS termination with
a short initial lifetime before considering broader coverage.

For WAF monitoring, provide a protected `SAG_WAF_TELEMETRY_DIR` to the
networkless collector, mount that directory read-only into the backend, and
set `WAF_EVENT_INPUT_PATH=/run/waf-telemetry/events.jsonl`. The normalized feed
is size-bounded and excludes headers, bodies, query values, credentials, and
uploads. Scene Management displays the configured WAF mode as read-only
deployment state; it controls monitoring and notification policy, not CRS
enforcement.

## Telegram security alerts

Add `compose.telegram.yaml` to attach the backend to a separate egress-capable
network, then complete onboarding in Scene Management → Security monitoring →
Telegram alerts. An administrator pastes the BotFather token into a write-only
field, verifies the bot, opens it in Telegram, sends a message, discovers the
chat, connects it, and sends a labeled test. The token is stored mode `0600` in
the protected persistent data volume and is never returned to the browser.

For headless deployments, `TELEGRAM_BOT_TOKEN_PATH` and
`TELEGRAM_CHAT_ID_PATH` may still point to externally mounted files. UI-managed
credentials take precedence and can be removed from Scene Management. Keep
outbound policy restricted to Telegram's HTTPS API in production.

The Platform root automatically combines Gateway and Wolf Compose files and
optionally includes `.local/compose.override.yaml`. Keep environment-specific
values in these runtime inputs rather than rebuilding public images for each
host.

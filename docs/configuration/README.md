# Configuration

Copy `.env.example` to `.env` with `scripts/bootstrap.sh`, then review every
value. The `.env` file is ignored by Git.

The base `compose.yaml` starts only the frontend and backend. It uses a named
volume for portal state and does not require credentials merely to display the
local portal and editor.

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
IPs without sending them to a third party, place current licensed
GeoLite2 City and ASN databases in the protected `SAG_GEOIP_DIR` and add
`compose.geoip.yaml` to the Compose command.

See [security monitoring](../security-monitoring.md) for the trusted-proxy
requirement, privacy limits, and public-exposure checklist.

The Platform root automatically combines Gateway and Wolf Compose files and
optionally includes `.local/compose.override.yaml`. Keep environment-specific
values in these runtime inputs rather than rebuilding public images for each
host.

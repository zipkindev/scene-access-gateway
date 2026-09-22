# Configuration

Copy `.env.example` to `.env` with `scripts/bootstrap.sh`, then review every
value. The `.env` file is ignored by Git.

The base `compose.yaml` starts only the frontend and backend. It uses a named
volume for portal state and does not require credentials merely to display the
local portal and editor.

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

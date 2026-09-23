# TrueNAS deployment overlay

TrueNAS uses the portable images plus a protected local Compose override. This
public directory intentionally contains no real hostnames, internal addresses,
TLS material, authentication files, storage paths, or network policy.

Copy `compose.override.example.yaml` to an ignored location such as
`.local/deploy/truenas/compose.override.yaml`. Store the reviewed Nginx
configuration beside it and set the required paths and values in `.env`.

Validate the merged model without deploying it:

```sh
docker compose \
  -f compose.yaml \
  -f .local/deploy/truenas/compose.override.yaml \
  config --quiet
```

The example demonstrates the boundary; it is not a ready-to-deploy production
configuration. A real cutover must separately define reviewed published ports,
networks, volumes, health checks, certificate paths, backups, rollback, and
active-session gates.

Telegram alerting is optional. When enabled, merge `compose.telegram.yaml`
and provide the two protected files named by `SAG_TELEGRAM_BOT_TOKEN_FILE` and
`SAG_TELEGRAM_CHAT_ID_FILE`. Review the target's outbound network policy before
attaching the backend to an egress-capable network. Scene Management controls
the alert policy but never accepts or returns either secret.

Normal Git pulls and rebases leave `.local/` untouched, so core application
updates can be tested with the same private deployment overlay without merging
environment values into public source.

## Deployment gate

There is intentionally no generic “deploy to TrueNAS” script. Before a real
cutover, review the exact target, image tags or digests, mounts, networks,
backups, rollback procedure, health checks, and active-session handling. A
local build, smoke test, Git push, or successful CI run does not authorize the
deployment; explicit approval is required for the reviewed procedure.

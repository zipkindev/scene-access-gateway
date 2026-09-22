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

Normal Git pulls and rebases leave `.local/` untouched, so core application
updates can be tested with the same private deployment overlay without merging
environment values into public source.

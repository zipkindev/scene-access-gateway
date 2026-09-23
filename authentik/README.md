# Authentik integration

This directory contains the portable identity-provider inputs used by Scene
Access Gateway. Authentik remains the authority for users, groups, enrollment,
and identity policy; the Gateway backend performs only the narrowly scoped
lookups and membership operations required by an approved access flow.

## Contents

- `blueprints/` contains declarative flows that can be reviewed and imported.
- `templates/` contains safe UI or policy template customizations.
- `compose.authentik.yaml` at the repository root defines the optional local
  Authentik, worker, and PostgreSQL services.

## Configuration boundary

This directory must not contain database exports, API tokens, SMTP
credentials, secret keys, or live user data.

Portable blueprints belong in `blueprints/`; safe template customizations
belong in `templates/`. Hostnames, addresses, credentials, and protected paths
are supplied through local configuration and Compose overrides.

Initialize protected local secret files with `../scripts/init-secrets.sh`, then
review [the configuration guide](../docs/configuration/README.md). Production
identity changes require separate review; importing a blueprint or starting a
local Compose overlay is not deployment approval.

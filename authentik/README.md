# Authentik integration

This directory contains declarative Authentik integration inputs. It must not
contain database exports, API tokens, SMTP credentials, secret keys, or live
user data.

Portable blueprints belong in `blueprints/`; safe template customizations
belong in `templates/`. Hostnames, addresses, credentials, and protected paths
are supplied through local configuration and Compose overrides.


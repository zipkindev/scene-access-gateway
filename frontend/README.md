# Frontend and gateway

This directory contains the Nginx frontend/gateway container and the public
portal artwork consumed by the backend renderer. The gateway exposes the
public portal and editor listeners while the Node backend stays on an internal
Compose network.

General Scene Access Gateway artwork belongs under `artwork/`. Optional game
runtimes and commercial game data do not.

## Runtime role

The container listens internally on the public portal and Scene Management
ports. The base Compose file binds both to loopback for development. Production
TLS, host routing, editor authentication, and trusted forwarding headers belong
in reviewed edge configuration, not in the image.

Nginx serves health checks and approved static routes, and proxies application
requests to the backend over the private Compose network. It must not expose
the backend's internal administration listener directly.

The portable configuration also:

- logs normalized routes without query strings or one-time URL tokens;
- rejects common dotfile, source-control, package-manifest, and server-status
  probes before they consume backend work;
- denies the public TorrentHarbor management path and removes caller-supplied
  management trust headers;
- bounds header, body, connection, and upstream wait time;
- compresses eligible text responses and rate-limits by trusted source; and
- allows the backend to cache explicitly versioned scripts immutably.

A production TLS/WAF configuration that replaces this file must preserve these
controls. Keep a new WAF rule set in observation mode until legitimate portal,
QR login, Scene Management, and private-service traffic have been exercised.
The portable edge emits a one-day HSTS starter policy, which browsers ignore
over local HTTP. Preserve it at TLS termination, then lengthen it only after
certificate renewal and every covered hostname are verified.

Build and route validation run through `../scripts/build.sh` and
`../scripts/smoke-test.sh`; the Platform root adds the optional extension
overlay and combined smoke checks.

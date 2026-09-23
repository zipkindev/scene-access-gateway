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

Build and route validation run through `../scripts/build.sh` and
`../scripts/smoke-test.sh`; the Platform root adds the optional extension
overlay and combined smoke checks.

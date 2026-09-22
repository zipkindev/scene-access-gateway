# Frontend and gateway

This directory contains the Nginx frontend/gateway container and the public
portal artwork consumed by the backend renderer. The gateway exposes the
public portal and editor listeners while the Node backend stays on an internal
Compose network.

General Scene Access Gateway artwork belongs under `artwork/`. Optional game
runtimes and commercial game data do not.

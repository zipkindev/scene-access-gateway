# Wolf3D extension

Wolfenstein 3D and Spear of Destiny support lives in the sibling
`scene-access-gateway-wolf3d` repository. Keeping the extension separate gives
the engine, CRT integration, mobile controls, import tools, and publishing
review their own history while keeping commercial game data outside Git.

## Repository contract

The main backend expects two optional paths:

- `/opt/scene-access-gateway/extensions/wolf3d` for the browser runtime;
- `/opt/scene-access-gateway/extensions/future-wolf3d-crt.js` for the portal
  controller.

The extension's `compose.extension.yaml` mounts both paths read-only. The core
portal has no duplicate copy of the controller or engine.

## Local use

Import and verify legally obtained data from the extension checkout first:

```sh
cd ../scene-access-gateway-wolf3d
./scripts/import-game-data.sh /path/to/owned/game/files ALL
./scripts/verify-game-data.sh
```

Then start from this repository:

```sh
export SAG_WOLF3D_EXTENSION_DIR="$(cd ../scene-access-gateway-wolf3d && pwd)"
docker compose \
  -f compose.yaml \
  -f "$SAG_WOLF3D_EXTENSION_DIR/compose.extension.yaml" \
  up -d --build
```

The extension repository documents its upstream sources and remaining public
publishing review. Never commit imported `.WL6`, `.SOD`, `.WL*`, or `.SD*`
files to either repository.

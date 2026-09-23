# Scripts

Scripts in this directory must be non-interactive where practical, fail closed,
and avoid embedding credentials or host-specific values.

The intended interface is:

- `check-prerequisites.sh`: verify Git, Docker, and Compose;
- `bootstrap.sh`: create ignored local directories and example configuration;
- `init-secrets.sh`: create protected local Authentik/PostgreSQL secret files;
- `test.sh`: run source, unit, and configuration validation;
- `smoke-test.sh`: launch and remove an isolated local route-test stack;
- `build.sh`: build immutable frontend and backend image tags;
- `fetch-scene-assets.sh`: use verified local audio when configured, otherwise
  build the public profile without optional third-party audio;
- `import-audio.sh`: verify and install all eight locally licensed audio files;
- `export-images.sh` / `load-images.sh`: support air-gapped hosts;
- `up.sh` / `down.sh`: wrap ordinary Compose lifecycle operations;
- `sync-branch.sh`: rebase, test, and safely push an already committed branch.

When working from Scene Access Platform, prefer its root wrappers for normal
integration work: `scripts/test.sh`, `scripts/build.sh`, `scripts/up.sh`, and
`scripts/down.sh`. They call the Gateway scripts and add the pinned Wolf
extension checks. Use the component scripts directly when developing or
validating Gateway in isolation.

TrueNAS deployment remains a separately reviewed operation driven by an
ignored local override; no generic script is allowed to mutate a NAS.

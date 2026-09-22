# Synchronizing a deployed release

Production is a verification source, not a Git source tree. A deployed
container combines reusable application code with local assets, commercial
game data, licensed audio, and private topology. Synchronization therefore
uses an explicit split rather than copying a container into either repository.

## Release-78 reference

The release-78 synchronization was audited against the verified application
manifest `abeb29dc52d39823ceb3615cf9dea464ea6d401d06d58305feddf45146fa44e2`.
Reusable portal changes were imported here. The exact GPL controller and
modified uWolf runtime files were imported into
`scene-access-gateway-wolf3d` and are protected there by SHA-256 parity tests.

The synchronization intentionally excludes production hostnames, addresses,
proxy policy, credentials, active state, container receipts, raw third-party
audio, and commercial Wolfenstein/Spear datasets.

## Repeatable workflow

1. Identify the exact deployed image and its verified recursive `/app`
   manifest. Stop if the release identity or receipt is ambiguous.
2. Extract the image into a disposable local audit directory. Never treat a
   dirty migration workspace as the release source.
3. Classify every changed path as portable gateway source, GPL Wolf extension,
   local licensed asset, commercial dataset, or private deployment material.
4. Import portable source on matching feature branches in both repositories.
   Preserve environment-variable defaults and the optional-extension boundary.
5. Keep licensed audio and commercial game data on their existing ignored,
   checksum-verified import paths.
6. Run source tests, topology scans, standalone Compose acceptance, and the
   combined gateway/extension smoke test.
7. Merge the backward-compatible gateway pull request first, then the
   extension pull request after its cross-repository CI passes.
8. Treat production deployment as a separate guarded procedure. A Git merge
   never authorizes a cutover.

This process makes later local improvements ordinary source changes: branch
from current `main`, change the portable source, test with the ignored local
overlay, and submit a pull request. Environment-only changes remain local.

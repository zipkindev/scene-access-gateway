# Artwork

This tree stores the general portal backgrounds, interactive scene assets, and
motion bundles used by Scene Access Gateway.

Every imported asset must have a known origin and redistribution status before
it is pushed publicly. Record third-party attribution and license information
in `SOURCES.md`. Production uploads and active scene state remain external
runtime data.

Project-generated artwork identified in `LICENSE.md` is available under CC BY
4.0. Audio is third-party Pixabay content and is not covered by CC BY 4.0 or
the repository's Apache-2.0 license. See `LICENSE.md`, `SOURCES.md`, and
`audio/manifest.json` for the exact boundary and attribution records.

`manifest.json` pins every generated artwork input. `audio/manifest.json` pins
the eight optional Future-table samples together with their playback order and
exact loop boundaries. Public builds omit the raw MP3 files; authorized local
copies can be installed with `scripts/import-audio.sh` and are then verified
before an image is built.

The repository preserves these categories:

- `backgrounds/`: original and optimized portal backgrounds;
- `concepts/`: additional background concepts retained for future scenes;
- `interactive/`: reusable interactive scene images and manifests;
- `motion/`: versioned motion bundles and their layer images;
- `audio/`: the optional-audio manifest and source register; raw MP3s stay
  local and ignored;
- `attribution/`: source and license records;
- `source-manifests/`: retained source and scene-bundle manifests.

## Asset pipeline

Tracked artwork is verified against `manifest.json`, copied into the backend
build context by `scripts/prepare-workspace-assets.sh`, and served through the
scene asset APIs. Production uploads and optimized derivatives live in runtime
state rather than this source tree.

From the Gateway repository root, run `./scripts/verify-build-inputs.sh` after
changing a manifest or asset. Run `./scripts/package-scene-assets.sh` when
reviewing the deterministic public asset bundle. Never add a file whose origin
or redistribution terms are unresolved.

Documentation screenshots and demonstrations are intentionally separate under
`docs/media/`. Current captures show the real Scene Management editor,
security globe, passive source-intelligence view, and QR sequence using only
disposable fixture state and RFC-reserved addresses; they are not runtime
artwork and are not included in scene asset manifests.

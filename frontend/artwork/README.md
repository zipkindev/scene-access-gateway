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
- `attribution/`: source and license records.
- `source-manifests/`: retained source and scene-bundle manifests.

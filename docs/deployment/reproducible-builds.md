# Reproducible build inputs

Scene Access Gateway validates presentation assets before invoking Compose. A
build fails if generated artwork, motion data, playback configuration, or a
pinned container base changes without review.

## Public inputs

- `frontend/artwork/manifest.json` identifies every generated background,
  concept, interactive scene, motion layer, and retained source manifest by
  SHA-256.
- `frontend/artwork/audio/manifest.json` records the optional Future-table
  samples, source pages, lengths, SHA-256 identities, display names, cycle
  order, default selection, and loop boundaries without distributing MP3s.
- `manifests/container-bases.json` pins Node and Nginx bases by immutable
  registry digest.
- `manifests/scene-assets-release.json` pins the deterministic public artwork
  archive.
- `scripts/verify-build-inputs.sh` compares the manifests with the runtime
  constants and accepts either all eight verified audio files or none.

`scripts/build.sh` runs these checks automatically. The public profile builds
and runs without optional third-party audio.

## Deterministic public artwork bundle

```sh
./scripts/package-scene-assets.sh
```

The command creates an archive under `.local/releases/` without overwriting an
existing file. It contains the project-generated artwork, manifests,
attribution, and license texts. Its SHA-256 must match
`manifests/scene-assets-release.json`.

## Restoring the exact local soundtrack

Download the eight samples yourself from the source pages in
`frontend/artwork/SOURCES.md` under their applicable Pixabay terms. Keep them
in an ignored directory using the exact manifest filenames, then run:

```sh
./scripts/import-audio.sh .local/audio-source
```

The importer validates the complete source set before copying anything. It
checks every byte length and SHA-256, installs the files into the ignored
`frontend/artwork/audio/` location, and reruns the full build-input verifier.
Set `SAG_AUDIO_SOURCE_DIR=.local/audio-source` to let `scripts/build.sh` restore
them automatically after a fresh checkout.

## Scope

These checks guarantee exact public artwork and, when locally installed, exact
audio inputs. Docker image manifests can still differ across CPU architectures
or builder versions because platform metadata and base manifests can differ.
Functional parity is verified separately by the test and smoke-test scripts.

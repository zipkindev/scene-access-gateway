# Deployment modes

For a complete installation, use
[Scene Access Platform](https://github.com/zipkindev/scene-access-platform).
It pins compatible Gateway and Wolf commits and wraps the combined Compose
lifecycle. The modes below describe how the Gateway component is delivered.

## Portable Compose

Build with `scripts/build.sh`, review `.env`, and start with `scripts/up.sh`.
The base deployment binds its two development listeners to loopback only.

## Identity stack

Add `compose.authentik.yaml` after generating protected local secrets and
reviewing the settings in `docs/configuration/README.md`.

## Optional offline GeoIP

Add `compose.geoip.yaml` after installing current GeoLite2 City and ASN MMDB
files in the protected directory configured by `SAG_GEOIP_DIR`. The backend
performs local lookups only. Review [security monitoring](../security-monitoring.md)
before exposing a TLS gateway publicly.

## Registry or air-gapped host

Images use `${SAG_IMAGE_NAMESPACE}/{frontend,backend}:${SAG_IMAGE_TAG}`. A
registry can push and pull those names normally. For an air-gapped host, use
`scripts/export-images.sh` and `scripts/load-images.sh`, verify the printed
SHA-256 out of band, and launch the same Compose definitions.

## TrueNAS

Use the public example under `deploy/truenas/` to create an ignored local
Compose override. Real hostnames, addresses, TLS paths, authentication files,
storage mappings, and network policy remain local. A guarded TrueNAS cutover
remains separate from source synchronization.

No deployment mode changes source-control ownership: images remain portable,
while secrets, hostnames, certificates, storage, and network policy are mounted
or supplied by the target environment.

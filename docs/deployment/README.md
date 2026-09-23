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

Add `compose.maxmind.yaml` to permit database downloads, then connect the
account from Scene Management. Credentials and validated GeoLite2 City and ASN
files remain in the protected state volume; lookups stay local. Use
`compose.geoip.yaml` instead when deployment policy requires read-only,
host-managed MMDB files in `SAG_GEOIP_DIR`. Review
[security monitoring](../security-monitoring.md) before exposing a TLS gateway
publicly.

## Optional Telegram alerts

Add `compose.telegram.yaml` after reviewing outbound network policy. It adds
only the egress-capable network; bot verification, chat discovery, destination
selection, test delivery, and alert policy are completed in Scene Management.
See [security monitoring](../security-monitoring.md#telegram-critical-alerts).

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

## Hardened rollout order

For an internet-facing update, retain the WAF in observation mode, back up the
portal data volume, retain the previous frontend/backend image IDs under
rollback tags, validate the merged Compose model, and build the exact source
commit. Start the replacement with Compose and require healthy containers
before testing the public portal, a versioned asset, Scene Management, a
controlled probe, management-path denial, structured-log redaction, and any
configured Telegram test delivery. Roll back both images and restore the data
volume only if the application changed persistent data incompatibly.

TLS termination must preserve the portable one-day HSTS starter policy and,
after a successful short-duration trial, may lengthen it. It must preserve the
portable configuration's normalized logs, trusted-client-IP replacement,
probe denials, connection/body timeouts, rate limits, compression, and public
management-path denial. Do not copy hostnames, certificates, WAF credentials,
or other deployment state into an image.

No deployment mode changes source-control ownership: images remain portable,
while secrets, hostnames, certificates, storage, and network policy are mounted
or supplied by the target environment.

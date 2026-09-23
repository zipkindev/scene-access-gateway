# Deployment

The deployment contract is standard Docker Compose. The base stack remains
host-neutral; TrueNAS-specific paths, VLAN identities, and guarded
release procedures belong in `truenas/` overrides.

Supported delivery patterns are:

- local development;
- ordinary Docker Compose with locally built images;
- registry-backed Compose;
- air-gapped image export/load;
- guarded TrueNAS deployment.

The reusable optional WAF component is in [`waf/`](waf/README.md). It packages
Nginx, ModSecurity, and OWASP CRS in one edge image and documents the hardened
WAF-to-origin Compose boundary without embedding target hostnames, certificate
paths, addresses, or storage locations.

Use [Scene Access Platform](https://github.com/zipkindev/scene-access-platform)
for the tested Gateway + Wolf composition. See the full
[deployment guide](../docs/deployment/README.md) for image naming, offline
transfer, identity, GeoIP, and configuration boundaries.

Tracked files define reusable examples only. Real addresses, storage paths,
certificates, credentials, and network policy remain in ignored local files or
the target platform's secret/configuration system.

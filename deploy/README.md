# Deployment

The target deployment contract is standard Docker Compose. The base stack will
remain host-neutral; TrueNAS-specific paths, VLAN identities, and guarded
release procedures belong in `truenas/` overrides.

Planned deployment modes:

- local development;
- ordinary Docker Compose with locally built images;
- registry-backed Compose;
- air-gapped image export/load;
- guarded TrueNAS deployment.


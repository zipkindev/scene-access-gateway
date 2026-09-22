# Backend

This directory contains the Node.js portal service: QR/session handling,
scene and destination APIs, persistence, mail delivery, and narrowly scoped
Authentik API operations.

`src/` is the canonical build input. The private historical extraction is kept
outside the public repository; public parity gates are documented under
`docs/migration/`. Runtime artwork is copied from `frontend/artwork` by the
Docker build; the ignored host-side copy needed by unit tests is prepared by
`scripts/prepare-workspace-assets.sh`.

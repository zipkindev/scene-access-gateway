# Production-parity record

Scene Access Gateway was extracted from a mature deployed portal rather than
designed as a greenfield replacement. The private extraction baseline remains
available to the maintainer for recovery and comparison, but its environment
topology and immutable container snapshot are intentionally not published.

## Public source boundary

This repository contains the canonical application source, project-generated
artwork, safe defaults, portable container definitions, and public tests. It
excludes:

- historical production proxy and application snapshots;
- real hostnames, addresses, routes, TLS paths, and network policy;
- credentials, keys, certificates, database exports, and live portal state;
- raw third-party audio and commercial game data;
- caches, logs, installed dependencies, and container exports.

The pre-public repository state is preserved as a protected local Git bundle,
not as a branch or tag on the public remote.

## Parity gates

Before replacing a production deployment, verify:

- source, unit, and clean-container tests;
- portal, editor, scene, QR, destination, and Authentik behavior;
- proxy routes, denial behavior, security headers, and TLS handling using the
  protected local deployment overlay;
- mobile gestures, embedded controls, and accepted wide-screen behavior;
- artwork, optional local audio, and active-scene fidelity;
- persistent-state migration, backup, rollback, and active-session handling;
- a clean-checkout Compose build independent of the original workspace.

Publishing source and deploying it are separate operations. GitHub updates do
not authorize or trigger a production cutover.

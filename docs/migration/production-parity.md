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

## Release-78 synchronization

The portable source is synchronized with the reusable behavior of the
verified release-78 application manifest. This includes persistent Arcade
leaderboards, resumable and ranked game behavior, terminal challenge polling,
scene-specific browser titles, and the main-side contracts required by the
separate Wolf extension.

Production topology and local content were not copied. Exact Wolf controller
and uWolf runtime changes live in the GPL extension repository; commercial
datasets and raw third-party audio remain ignored local inputs. See the
[synchronization procedure](../maintenance/release-synchronization.md).

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

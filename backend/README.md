# Backend

This directory contains the Node.js portal service: QR/session handling,
scene and destination APIs, persistent Arcade leaderboards, browser-title and
game-continuity contracts, mail delivery, and narrowly scoped Authentik API
operations.

`src/` is the canonical build input. The private historical extraction is kept
outside the public repository; public parity gates are documented under
`docs/migration/`. Runtime artwork is copied from `frontend/artwork` by the
Docker build; the ignored host-side copy needed by unit tests is prepared by
`scripts/prepare-workspace-assets.sh`.

## Main boundaries

| Area | Responsibility |
| --- | --- |
| `server.js` | HTTP listeners, route assembly, health checks, and startup validation |
| `management.js` and `scene-admin*` | Authenticated Scene Management APIs and UI |
| `scene-*` modules | Scene validation, framing, assets, motion, destinations, and games |
| `security-events.js` and `login-telemetry.js` | Bounded, ordered security records and privacy-preserving identity fingerprints |
| `waf-collector.js` and `waf-ingestor.js` | Sanitized ModSecurity findings with explicit audit-status provenance; only WAF interruptions are final-status verified |
| `source-intelligence*.js` | Cached passive evidence orchestration and the isolated, token-authenticated egress worker |
| `application-contracts.js` | Fail-closed validation for routes, identity/QR behavior, proxy rules, browser sources, WAF exceptions, and acceptance journeys |

The authenticated security globe uses only bundled, attributed map geometry
and NASA Blue/Black Marble derivatives from `src/assets/map`; no map tiles or
visitor addresses are sent to a third-party browser service.
| `allowlist.js`, `assertion.js`, and registration modules | Destination authorization and short-lived access handoff |
| `store.js` | Durable portal state with strict startup and migration behavior |

The backend is exposed only to the private Compose network. Nginx is the
public entrypoint, and production authentication for Scene Management belongs
at that boundary.

Public requests require the configured host and an allowed HTTP method. Both
HTTP listeners bound header/body lifetime, keepalive reuse, and requests per
socket, and return a generic response through a top-level failure boundary.
Browser responses include CSP, MIME-sniffing protection, a restrictive
Permissions Policy, and same-origin opener/resource policies.

Portal-state reads no longer acquire a write lock or rewrite the complete JSON
state file. Expired transient records are purged at most once per minute.
Production security-event appends use a bounded, ordered asynchronous writer;
subscribers such as Telegram are notified only after the event is durably
appended, and graceful shutdown drains the writer before exit.

TorrentHarbor management authorization uses the direct TCP peer address on the
private backend network. Do not publish that backend port or substitute a
client-controlled forwarding header for this boundary.

The tracked deployment inventory is `deploy/applications.json`. Adding an app
requires a complete contract rather than a proxy-only change. Wildcard browser
origins and WAF paths are rejected; any WAF exclusion needs exact rule IDs,
path, methods, rationale, and review date. Apps using QR or Authentik relay
must keep those journeys in their verification set.

## Validate

From the Gateway repository root, run `./scripts/test.sh`. From the Platform
workspace, run `./scripts/test.sh` to add extension and combined-stack checks.

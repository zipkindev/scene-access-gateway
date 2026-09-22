# Architecture

Scene Access Gateway is designed as a small container set with explicit trust
boundaries:

1. The frontend/gateway is the only public HTTP entrypoint.
2. The backend is reachable only on the private Compose network.
3. Authentik remains the identity authority; the backend receives only the
   narrowly scoped credentials required for approved operations.
4. PostgreSQL and Authentik worker services are private infrastructure.
5. Scene state and secrets are mounted at runtime and are not image content.
6. Optional game integrations attach through a versioned extension contract.

The portable source retains the deployed application's behavior while keeping
production topology and optional GPL game code outside the core image. The
main repository is independently buildable; cross-repository CI also verifies
the read-only Wolf extension overlay against it.

## Why the boundaries exist

| Component | Purpose | Trust boundary |
| --- | --- | --- |
| Nginx gateway | Terminates the public HTTP path, overwrites forwarding headers, serves no secrets, and relays only reviewed routes | The only component intended to receive internet traffic |
| Portal backend | Owns short-lived challenges, rate limits, email confirmation, sessions, assertions, and scene behavior | Private Compose network; never publish its port directly |
| Scene Management | Authors scenes, reviews access requests, manages destinations, and reads the security ledger | Separate authenticated listener; not a public administration route |
| Authentik | Canonical identity, group membership, login policy, and identity audit events | Management API and credentials stay private and narrowly scoped |
| SMTP | Delivers one-time confirmation and registration links | Receives only the intended address and expiring link |
| Security ledger | Correlates application outcomes with source IP and optional offline GeoIP/ASN context | Protected state volume with bounded retention; never web-accessible directly |
| Destination proxy | Converts a valid portal session into a short-lived signed identity assertion before relaying | Upstream services remain private and receive only approved traffic |
| Optional extensions | Adds independently licensed experiences through a versioned read-only mount | Cannot make the public core depend on proprietary datasets |

## Three related audit streams

The system intentionally does not pretend that one log can see everything:

1. The TLS gateway observes connections, status codes, and requests rejected
   before application routing.
2. The portal security ledger understands QR, email, access-request, session,
   relay, and scene-management outcomes.
3. Authentik records identity, failed-login, invitation, group, and
   administrative events.

Correlating these streams provides better evidence than copying raw request
bodies into an application database. See [security monitoring](../security-monitoring.md)
for retention, trusted-client-IP, GeoIP, and alerting guidance.

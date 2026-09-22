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

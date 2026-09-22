# Security policy

Do not open a public issue containing credentials, tokens, certificates,
private keys, live URLs with one-time values, database exports, or user data.

The public gateway is the only intended internet-facing component. Backend,
editor, Authentik management, PostgreSQL, and persistent storage must remain
behind reviewed network and authentication boundaries.

Security-sensitive deployment changes require route, denial, secret-mount,
rollback, and recovery validation before production use.

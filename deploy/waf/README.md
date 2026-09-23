# OWASP CRS WAF deployment component

This directory contains the reusable, host-neutral part of the production WAF
layer. It builds one edge image containing Nginx, the ModSecurity 3 engine, and
OWASP Core Rule Set 4.29.0. These are complementary layers, not separate WAF
implementations: Nginx handles TLS and proxying, ModSecurity evaluates HTTP
transactions, and CRS supplies the rules evaluated by ModSecurity.

`compose.example.yaml` documents the hardened network-namespace pattern used
by supervised production deployments. The WAF owns the public TLS listener and
forwards to a loopback-only origin Nginx listener. The origin continues to own
application routing, authentication boundaries, security headers, and private
management routes. The two Nginx processes share networking but have separate
containers, filesystems, configurations, health checks, and certificate reload
lifecycles. The example includes separate PID-namespace certificate reloaders
for the WAF and origin; each can signal only the Nginx process it supervises.

The example intentionally requires deployment values for the public hostname
allowlist, health hostname, TLS mount, audit directory, origin image, and origin
configuration. Keep those values in ignored deployment state. Do not commit
certificates, internal addresses, storage paths, or real hostnames.

## Request path

1. The WAF terminates public TLS and drops any hostname outside the explicit
   allowlist without contacting the origin.
2. ModSecurity and CRS inspect the request and, where applicable, the response.
3. The WAF replaces caller-supplied forwarding identity and adds a request ID.
4. Accepted traffic crosses only loopback to the hardened origin Nginx.
5. The origin applies application-specific routes and proxies to the backend or
   an approved private destination.

The checked-in policy starts in `DetectionOnly`, with blocking paranoia level
1, detection paranoia level 2, and inbound/outbound anomaly thresholds 5/4.
Observation mode records rule matches but does not block on CRS anomaly scores.
Unknown-host rejection and the origin isolation boundary are enforced by Nginx
regardless of the ModSecurity mode.

Audit parts are restricted to `AHZ`: metadata, audit trailer, and terminating
boundary. Request headers, cookies, authorization values, bodies, response
bodies, and uploaded files are intentionally excluded. Protect and rotate the
audit directory as security data.

## Validation and promotion

Validate the example with non-secret placeholders:

```sh
./scripts/check-waf.sh
```

Build the image with:

```sh
docker build --pull=false \
  -t "${SAG_IMAGE_NAMESPACE:-scene-access-gateway}/waf:${SAG_IMAGE_TAG:-dev}" \
  deploy/waf
```

Before enabling enforcement, observe representative portal, QR, editor, asset,
WebSocket, upload, and private-service traffic. Review matched rule IDs and
false positives, add the narrowest justified exclusions, then enable
high-confidence denials incrementally. WAF audit records are not automatically
Telegram alerts; a separate sanitized audit-to-alert adapter is required.

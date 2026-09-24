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
It also includes a networkless `waf-telemetry` sidecar. The sidecar uses the
existing Gateway backend image, reads raw ModSecurity audits read-only, and
writes only normalized findings to a separate protected directory. It has no
Docker socket, application data, Telegram credentials, or network.

The example intentionally requires deployment values for the public hostname
allowlist, health hostname, TLS mount, audit and normalized telemetry
directories, origin image, telemetry-capable backend image, and origin
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

The checked-in policy defaults `SAG_WAF_MODE` to `DetectionOnly`, with blocking
paranoia level 1, detection paranoia level 2, and inbound/outbound anomaly
thresholds 5/4.
Observation mode records rule matches but does not block on CRS anomaly scores.
Unknown-host rejection and the origin isolation boundary are enforced by Nginx
regardless of the ModSecurity mode.

Audit parts are restricted to `AHZ`: metadata, audit trailer, and terminating
boundary. Request headers, cookies, authorization values, bodies, response
bodies, and uploaded files are intentionally excluded. Protect and rotate the
audit directory as security data.

## Scene Management telemetry

Mount the normalized telemetry directory read-only into the portal backend and
set `WAF_EVENT_INPUT_PATH` to its `events.jsonl` file. A target-specific
Compose overlay normally adds the equivalent of:

```yaml
services:
  backend:
    environment:
      WAF_EVENT_INPUT_PATH: /run/waf-telemetry/events.jsonl
    volumes:
      - ${SAG_WAF_TELEMETRY_DIR}:/run/waf-telemetry:ro
```

The backend validates and re-signs normalized findings into its bounded
security ledger. Scene Management shows the target, sanitized path, CRS rule
IDs, anomaly score, and audit-reported status class. A ModSecurity audit
`response.http_code` is not assumed to be the final client response: it is
labeled `WAF audit HTTP` and remains unverified until correlated with the edge
access record. A true ModSecurity interruption is a verified edge outcome. The
WAF mode is display-only: enforcement changes remain reviewed deployment
operations rather than browser-controlled mutations.

Telegram groups findings by source fingerprint, target, and attack category.
The first qualifying incident alerts immediately; duplicates accumulate and
produce a configurable persistence reminder. Rate-limited requests continue
to count. If the hourly ceiling is reached, the ledger remains complete and a
later summary reports suppressed notifications.

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
high-confidence denials incrementally. The tracked telemetry sidecar is the
sanitized audit-to-alert adapter; raw audits never enter Telegram.

Every application inherits the WAF policy through `../applications.json`.
An exception must name exact CRS rule IDs, an exact path, bounded methods, a
rationale, and a review date; wildcard bypasses fail validation. Exercise the
application's declared anonymous, authenticated, QR, Authentik, media, and
negative journeys before promoting an exclusion or enforcement change.

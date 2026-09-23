# TrueNAS deployment overlay

TrueNAS uses the portable images plus a protected local Compose override. This
public directory intentionally contains no real hostnames, internal addresses,
TLS material, authentication files, storage paths, or network policy.

Copy `compose.override.example.yaml` to an ignored location such as
`.local/deploy/truenas/compose.override.yaml`. Store the reviewed Nginx
configuration beside it and set the required paths and values in `.env`.

Validate the merged model without deploying it:

```sh
docker compose \
  -f compose.yaml \
  -f .local/deploy/truenas/compose.override.yaml \
  config --quiet
```

The example demonstrates the boundary; it is not a ready-to-deploy production
configuration. A real cutover must separately define reviewed published ports,
networks, volumes, health checks, certificate paths, backups, rollback, and
active-session gates.

The protected Nginx configuration replaces the portable configuration, so it
must also preserve the security-observability controls described in
[`docs/security-monitoring.md`](../../docs/security-monitoring.md): JSON access
records with both edge and upstream `X-Request-ID` values, restricted log
retention, a per-source request zone, a concurrent-connection zone, explicit
429 handling, normalized routes without tokens or queries, public management
route denial, probe denials, compression, body/time limits, and route-specific
method restrictions. Confirm the TLS edge overwrites client-IP headers before
using an address as a rate-limit or incident-response key. Remove client-sent
management trust headers and route trusted management calls over the private
backend network.

Keep new WAF rules in observation mode through the validation matrix, then
enable high-confidence denials incrementally. Preserve the portable one-day
HSTS starter policy at the TLS edge; do not lengthen it or add
`includeSubDomains` or `preload` until every covered hostname and
certificate-renewal path has been reviewed.

The reusable WAF image, Nginx templates, and shared-network-namespace Compose
pattern are tracked in [`deploy/waf/`](../waf/README.md). In that pattern the
WAF owns the published TLS listener and forwards only to a loopback listener in
the separate hardened origin Nginx container. TrueNAS overrides must supply the
hostname allowlist, one allowed health-check host, TLS mount, protected audit
directory, origin configuration, published port, and certificate-reloader
settings. Keep those target values ignored. Do not expose the loopback origin
listener or make the backend directly reachable.

The baseline WAF policy is OWASP CRS 4.29.0 on ModSecurity 3.0.16 in
`DetectionOnly`. Audit parts `AHZ` exclude request headers, cookies,
authorization values, request/response bodies, and uploads. WAF audit records
remain separate from the application's Telegram pipeline until a reviewed,
sanitized adapter is added.

Telegram alerting is optional. When enabled, merge `compose.telegram.yaml`
after reviewing the target's outbound network policy. The overlay attaches the
backend to an egress-capable network; bot verification, chat discovery, test
delivery, and policy are completed in Scene Management. The bot token is
write-only and is never returned by the administration API.

UI-managed MaxMind downloads are optional. Merge `compose.maxmind.yaml` or
provide equivalent restricted HTTPS egress, then enter the account ID and
license key in Scene Management. Credentials and databases remain in the
protected persistent state volume. Deployments using read-only host MMDB files
should keep `compose.geoip.yaml` instead; that mode disables UI credential
changes.

Normal Git pulls and rebases leave `.local/` untouched, so core application
updates can be tested with the same private deployment overlay without merging
environment values into public source.

## Deployment gate

There is intentionally no generic “deploy to TrueNAS” script. Before a real
cutover, review the exact target, image tags or digests, mounts, networks,
backups, rollback procedure, health checks, and active-session handling. A
local build, smoke test, Git push, or successful CI run does not authorize the
deployment; explicit approval is required for the reviewed procedure.

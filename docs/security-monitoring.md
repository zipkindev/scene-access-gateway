# Security monitoring

Scene Access Gateway records application-level security events in a protected,
rotating JSON Lines ledger under the portal data volume. The authenticated
Scene Management interface shows a 24-hour summary and the latest 100 events.

This complements, rather than replaces, the reverse-proxy access log,
Authentik events, firewall telemetry, a WAF, or an intrusion-prevention tool.
Application code can explain whether a QR challenge or access workflow
succeeded; the edge proxy is better positioned to observe connections that
never reach an application route.

## Recorded events

- portal visits that create a QR challenge;
- valid-format QR login page opens;
- rejected and accepted login/email-delivery outcomes;
- successful email confirmation and portal-session creation;
- submitted, duplicate, blocked, invalid, and rate-limited access requests;
- unknown routes and unexpected methods;
- SQL-injection, command-injection, path-traversal, and common scanner
  **probe indicators**; and
- access-request decisions made through Scene Management.

A probe indicator is evidence that a request matched a defensive rule. It is
not evidence that an exploit succeeded. The portal does not use SQL for its
own state, and detection never executes or stores a submitted payload.

Each event contains the time, event category, result, normalized route,
response status where known, source IP, a keyed user-agent fingerprint, and
optional local geolocation. Email addresses and usernames are keyed hashes.
QR tokens, cookies, passwords, access tokens, request bodies, query strings,
and full user-agent strings are never written to the security ledger.

## Client IP trust boundary

The backend accepts `X-Portal-Source-IP` only because it is private on the
Compose network and the public Nginx gateway overwrites that header. Never
publish the backend port directly.

If another reverse proxy terminates public TLS, configure that proxy to
replace client-IP headers and configure Nginx to trust only the exact proxy
address or CIDR. Do not trust arbitrary internet-supplied `X-Forwarded-For`.
For Nginx this normally uses `set_real_ip_from`, `real_ip_header`, and
`real_ip_recursive`; the trusted CIDR is deployment-specific and therefore is
not embedded in the public image.

After deployment, test this boundary from outside the network and confirm the
dashboard reports the external test address rather than the proxy's private
address. A forged client-IP header sent directly by the test client must not
replace it.

## Offline GeoIP enrichment

GeoIP is disabled unless local MaxMind DB files are mounted. No visitor IP is
sent to an external lookup service. Obtain and maintain licensed GeoLite2 City
and ASN databases, then place them in the protected directory configured by
`SAG_GEOIP_DIR`:

```text
.local/geoip/GeoLite2-City.mmdb
.local/geoip/GeoLite2-ASN.mmdb
```

Launch the optional overlay:

```sh
docker compose -f compose.yaml -f compose.geoip.yaml up -d --build
```

GeoLite data must be kept current under MaxMind's license. Geolocation is
approximate. Country, region, city, ASN, and accuracy radius are investigation
hints—not proof of a person's identity or physical address.

## Retention and privacy

`SAG_SECURITY_EVENT_RETENTION_DAYS` defaults to 30 and accepts 1–365 days.
`SAG_SECURITY_EVENT_MAX_BYTES` defaults to 64 MiB. Old daily files are pruned
before the active file reaches that ceiling, and per-minute admission limits
prevent a request flood from turning the ledger itself into a disk-exhaustion
attack. The dashboard reports suppressed events and a storage-limit warning.
Security logs contain IP addresses, which may be personal data. Choose a
retention period appropriate for the deployment's jurisdiction and privacy
policy, restrict backup access, and do not publish screenshots containing real
events.

The per-installation integrity key and event files are mode `0600`. Keep the
data volume and backups inaccessible from the public gateway. Integrity
metadata helps detect modified records but is not a substitute for forwarding
logs to a separate, restricted log system.

## Telegram critical alerts

Scene Management includes a Telegram subsection under Security Monitoring.
Administrators can enable delivery, select the minimum severity and event
categories, set an aggregation threshold and window, configure per-source
cooldowns and a global hourly ceiling, choose UTC quiet hours with an optional
critical override, select a redaction level, and send a labeled test alert.

The event ledger remains authoritative. A notification is queued only after
its security event has been durably appended. Delivery uses a bounded persisted
queue, short HTTPS timeouts, bounded retries, cooldowns, and rate limits. A
Telegram outage cannot block the portal, QR flow, Scene Management, or event
recording. Delivery state—never the stored bot token—is visible in the UI. Add
`compose.telegram.yaml` to attach the backend to the optional egress network.
Production should restrict outbound traffic to Telegram's HTTPS API using the
deployment environment's reviewed network controls.

Scene Management accepts a token through a write-only password field over the
protected administration listener. The backend verifies it with Telegram
before storing it as a mode-`0600` file in the persistent data volume. It does
not return the token in API responses. Chat discovery uses Telegram updates so
an administrator does not need to find or copy a numeric chat ID manually.

Messages contain the time, category, severity, occurrence count, outcome, and
either a masked source with approximate local GeoIP/ASN context or country-only
context. They exclude request bodies, full query strings, email addresses,
usernames, cookies, challenge/session tokens, credentials, and full source IPs.

To obtain the required values:

1. Create a bot through Telegram's verified `@BotFather` account.
2. In Scene Management, paste the token and select **Verify and save bot**.
3. Open the verified bot link. For a private chat, press **Start** and send a
   message. For a group or channel, add the bot with only the permissions it
   needs and post a message.
4. Select **Discover chats**, choose the intended destination, and connect it.
5. Send a labeled test alert. Enable delivery only after the expected
   destination receives it.

Treat a leaked bot token as compromised: revoke it through BotFather, verify
the replacement in Scene Management, reconnect the destination, and send
another labeled test. Never paste a real token into an issue, commit, log, or
support message.

## Authentik and edge monitoring

Authentik already records login, failed-login, suspicious-request, invitation,
and administrative events. Configure Authentik notification rules for
high-value identity events and forward all container events to the selected
log platform when centralized retention is needed.

For an internet-facing deployment, also collect the TLS proxy's structured
access/error logs and consider a reviewed WAF or CrowdSec-style remediation
layer. Introduce automatic blocking only after observing false positives;
dashboard classifications in this project are intentionally non-blocking.

## Initial public-exposure checklist

1. Confirm only the intended TLS gateway is reachable from the internet.
2. Confirm backend, editor, Authentik management, metrics, databases, and
   container-management ports are not public.
3. Verify the trusted proxy/client-IP boundary with an external test.
4. Configure Authentik failed-login and suspicious-request notifications.
5. Set log retention, backup access, disk alerts, and system clock sync.
6. Run a controlled invalid-route, invalid-login, and test probe request and
   confirm they appear in Scene Management without sensitive payloads.
7. Record the recovery and incident-response procedure before enabling
   automatic bans.

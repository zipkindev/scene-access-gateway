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
optional local geolocation. Each proxied request receives an unspoofable UUID
that is returned as `X-Request-ID`, stored with its application events, and
included in the frontend's structured access record. Email addresses and
usernames are keyed hashes.
QR tokens, cookies, passwords, access tokens, request bodies, query strings,
and full user-agent strings are never written to the security ledger.

The frontend writes JSON access records to standard output. These contain a
normalized route without the query string, full user agent, source address,
response status, timing, Nginx edge request ID, and backend request ID. Login,
verification, and challenge tokens are replaced with `:token`. Treat these
records as protected security data anyway: source addresses and user agents
may still be personal or identifying. Apply bounded retention and restricted
access in the container logging driver or central log platform.

## Alert investigation

Use the ledger as the alert index and the frontend access log as request
evidence. Preserve both before restarting or recreating containers because the
ledger is persistent but the container log may not be.

1. Record the alert window in UTC, category, source address, normalized path,
   response status, and request ID from Scene Management.
2. Search the frontend JSON access log for the same `backend_request_id`. This
   returns the normalized `route`, edge status, timing, and user agent.
3. Group surrounding records by `remote_addr`, user agent, method, target, and
   status. Compare their times with Authentik, TLS-edge, firewall, and upstream
   application logs.
4. Look for evidence of effect: successful authentication, a new session,
   changed state, unexpected upstream traffic, a 2xx/3xx response from a
   sensitive route, or follow-on requests that require authorization. A probe
   signature by itself is not evidence of successful exploitation.
5. Preserve a redacted incident record containing counts and hashes; retain the
   raw evidence only in the restricted log system.

For a Compose deployment, capture the raw frontend log without Compose's line
prefix and protect the resulting file immediately:

```sh
umask 077
frontend_container=$(docker compose ps -q frontend)
docker logs --since 24h "$frontend_container" > frontend-access.jsonl 2> frontend-error.log
```

Search by the UUID shown in Scene Management:

```sh
jq --arg id 'REQUEST-UUID' 'select(.backend_request_id == $id)' frontend-access.jsonl
```

Older events created before request correlation was added have no request ID.
For those, correlate on UTC time, source address, method, normalized `uri`, and
status, allowing for a small clock difference. Never send the captured files
off-host unless an approved incident-response process requires it.

## Client IP trust boundary

The backend accepts `X-Portal-Source-IP` only because it is private on the
Compose network and the public Nginx gateway overwrites that header. Never
publish the backend port directly.

The public listener removes `X-Management-Source-IP` and denies
`/internal/torrentharbor-management/`. A trusted management caller must use the
private backend network; the backend compares its direct TCP peer address with
`MANAGEMENT_SOURCE_IP`. Forwarded source headers are never sufficient for
management authorization.

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

No visitor IP is sent to an external lookup service. Scene Management can use a
MaxMind account ID and license key to download GeoLite2 City and ASN databases
into the protected persistent state volume. Add the outbound download overlay
when starting the stack:

```sh
docker compose -f compose.yaml -f compose.maxmind.yaml up -d --build
```

Open **Security monitoring → IP geolocation · MaxMind GeoLite2**, enter the
account ID and license key, then select **Connect and download**. Both databases
must download and validate before credentials are saved. The account ID is
masked afterward and the license key is never returned to the browser. Use
**Update databases** for future releases. **Remove saved account** deletes the
credentials while leaving the last validated databases active.

The older host-managed workflow remains available for deployments that require
read-only database mounts. Place licensed files in `SAG_GEOIP_DIR`:

```text
.local/geoip/GeoLite2-City.mmdb
.local/geoip/GeoLite2-ASN.mmdb
```

For repeatable updates, create a free MaxMind account and license key, then
store the account ID and key in the ignored files
`.local/secrets/maxmind-account-id` and
`.local/secrets/maxmind-license-key`. Restrict both files to the deployment
owner and run:

```sh
./scripts/update-geoip.sh
```

The updater reads credentials from files so it does not place them in command
arguments or tracked configuration. Alternate protected paths can be selected
with `SAG_MAXMIND_ACCOUNT_ID_FILE` and `SAG_MAXMIND_LICENSE_KEY_FILE`.

Launch the mount overlay instead of UI-managed setup:

```sh
docker compose -f compose.yaml -f compose.geoip.yaml up -d --build
```

GeoLite data must be kept current under MaxMind's license. Geolocation is
approximate. Country, region, city, ASN, and accuracy radius are investigation
hints—not proof of a person's identity or physical address.

When `compose.geoip.yaml` supplies mounted database paths, Scene Management
reports mounted-file mode and disables credential changes. The UI-managed and
mounted-file modes are intentionally mutually exclusive.

Scene Management displays that approximate location beside each public source
IP. Events written before the databases were mounted are enriched at read time,
without rewriting the integrity-protected ledger. Private and loopback sources
are identified by scope and are never sent to a lookup service.

## Event filters

The controls directly above the event list can be combined:

- select one or more severity tokens;
- add one or more event types or Telegram-compatible alert categories;
- add countries discovered in the current 24-hour summary;
- enter an exact IPv4/IPv6 address or a CIDR range; and
- click an IP address or country in an event to add it immediately.

Selecting several values of the same kind matches any of those values. Filters
of different kinds are combined, so `Warning` plus `Lithuania` plus
`45.118.10.0/24` requires all three conditions. Click any active filter chip to
remove it, or use **Clear filters** to reset the event list. Filtering happens
on the authenticated backend; the browser receives at most 250 matching
events. The event-type and alert-type menus are faceted: they hide values that
cannot match the other active filters and omit values already selected.

Authenticated configuration changes are labeled as **Administrator activity**
from **Scene Management**, with a readable action such as a MaxMind database
update or Telegram policy change. They are not displayed as unknown network
sources.

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

Keep new WAF policies in observation mode through representative portal, QR,
login, editor, asset, and private-service flows. Compare observations with the
portable Nginx denials, then enable only high-confidence rules in small groups.
The application and portable edge continue validating requests even after WAF
enforcement is enabled.

The portable public listener applies a deliberately conservative per-source
ceiling of 10 requests per second with a burst of 40 and 20 concurrent
connections. A production TLS proxy that replaces the portable Nginx
configuration must define equivalent limits itself. Baseline legitimate
traffic before lowering these values. Rate-limited edge requests return 429
and appear in the access log but do not reach the application ledger.

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
8. Confirm raw queries and QR/login/challenge tokens do not appear in frontend
   logs, and confirm a forged management-source header receives 404.
9. Verify TLS headers, starting HSTS with a short lifetime before considering
   `includeSubDomains` or preload.

# Telegram security alerting release 80

## Objective

Add optional, policy-driven Telegram notification for meaningful application
security events while preserving the release-79 ledger as the authoritative
record and keeping credentials outside source, images, APIs, logs, and browser
storage.

## Implementation

- Scene Management contains the complete alert policy under Security
  Monitoring: enablement, severity, categories, aggregation, cooldown, hourly
  ceiling, UTC quiet hours, critical override, redaction, status, and test.
- `TelegramAlerts` persists a strict policy, bounded redacted queue, and
  sanitized delivery status in the protected portal data volume.
- Security events enqueue only after their integrity-protected ledger append.
- Delivery is asynchronous, uses short HTTPS timeouts and bounded retries, and
  never participates in the request or ledger success path.
- Bot token and chat ID are read only from `TELEGRAM_BOT_TOKEN_PATH` and
  `TELEGRAM_CHAT_ID_PATH`. Scene Management exposes only configured/active
  state.
- `compose.telegram.yaml` provides optional secret mounts and egress attachment;
  the base Compose stack remains internal-only.

## Acceptance gates

- invalid policies and unauthorized or CSRF-invalid writes are rejected;
- secrets do not appear in APIs, UI content, state files, Git, or image layers;
- matching, aggregation, redaction, cooldown, global ceiling, quiet-hours
  policy, and labeled test behavior pass automated tests;
- delivery failure leaves the security ledger and portal path healthy and
  retains at most 100 redacted pending messages;
- restart safely reloads persisted policy, queue, and sanitized status;
- the integration remains inactive when either secret is absent;
- Gateway tests, Platform integration tests, Compose validation, image builds,
  and a disposable runtime smoke test pass before deployment;
- production cutover uses an exact reviewed image, protected backup/readback,
  portal-only recreation, verification, and scoped release-79 rollback.

## Deployment boundary

Code deployment may occur with the integration unconfigured and inactive.
Installing real credentials and enabling external delivery requires the owner
to provide the bot token and numeric chat ID through protected local files and
approve the target-specific secret mounts and outbound network scope. A real
Telegram test is sent only after those values are installed.

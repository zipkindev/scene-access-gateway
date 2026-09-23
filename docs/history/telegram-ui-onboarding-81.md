# Telegram UI onboarding release 81

## Objective

Make Telegram integration a complete Scene Management workflow while keeping
the bot token write-only, server-side, and outside public images and Git.

## Operator flow

1. Paste the BotFather token into the password field and verify the bot.
2. Open the verified bot, press Start, and send it a message.
3. Discover chats, select the intended destination, and connect it.
4. Send a labeled test alert, configure policy, and enable delivery.
5. Replace or disconnect the bot from the same panel when required.

The numeric chat ID is discovered through Telegram updates; a manual numeric
field remains available for channel and advanced deployments.

## Security properties

- Bot tokens are accepted only through the authenticated, CSRF-protected
  administration API and are never returned by any API response.
- Telegram verifies the token before it is stored.
- UI-managed token and chat files use mode `0600` in the protected persistent
  data volume. Existing externally mounted credential paths remain supported
  for headless deployments.
- Replacing a token disables delivery, clears the previous destination, and
  clears queued messages so they cannot be redirected accidentally.
- Disconnecting removes UI-managed credentials and disables delivery.
- `compose.telegram.yaml` supplies outbound network attachment only; it no
  longer requires host-side secret-file variables.

## Validation

Automated tests cover token verification, write-only API state, file modes,
chat discovery, destination verification, test delivery, disconnect behavior,
CSRF-protected setup routes, and the existing aggregation, redaction, retry,
cooldown, quiet-hour, and rate-limit behavior.

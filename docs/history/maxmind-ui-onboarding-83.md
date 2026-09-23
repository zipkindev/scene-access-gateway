# MaxMind UI onboarding release 83

## Objective

Let an operator activate local geographic security context entirely from Scene
Management without copying credentials into public configuration or rebuilding
an image.

## Delivered behavior

- Security Monitoring accepts a MaxMind account ID and license key through
  write-only fields.
- City and ASN archives download over authenticated HTTPS, enforce bounded
  sizes, extract only the expected MMDB filenames, and validate both databases
  before credentials are saved.
- Credentials and databases use mode `0600` inside protected persistent state.
- The browser receives only a masked account suffix, database load state, and
  update times; it never receives the license key.
- Successful downloads reload both database readers immediately, including for
  historical event enrichment.
- Operators can update databases or remove saved credentials while retaining
  the last validated local databases.
- `compose.maxmind.yaml` supplies optional outbound connectivity. Existing
  read-only mounts through `compose.geoip.yaml` remain supported and disable UI
  credential mutation.

## Validation

Tests cover credential validation and rejection, bounded archive extraction,
atomic protected persistence, write-only API state, database reload, update,
disconnect behavior, UI contracts, and both Compose modes.

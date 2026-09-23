# Security event filtering release 82

## Objective

Make a growing security ledger practical to investigate without exporting its
visitor data from Scene Management.

## Delivered behavior

- Public source addresses show locally resolved country, region, city, accuracy
  radius, ASN, and organization when the corresponding MMDB files are mounted.
- Historical events missing location fields are enriched during reads without
  modifying their integrity-protected records.
- Severity tokens toggle on and off. Event type, Telegram-compatible alert
  category, and detected-country selectors add removable filter chips.
- Event IP addresses and countries are themselves filter actions.
- Exact IPv4/IPv6 and CIDR source filters are supported.
- Multiple values within one dimension use OR semantics; different dimensions
  use AND semantics.
- Filtering is validated and executed by the authenticated backend, with a
  maximum of 250 returned events.

## Privacy boundary

No network geolocation API was introduced. Databases remain ignored,
host-managed inputs mounted read-only through `compose.geoip.yaml`. Location is
approximate investigative context, not evidence of a person or street address.

## Validation

Tests cover combined filter semantics, exact address and CIDR matching, dynamic
historical enrichment, malformed query rejection, UI controls, and the
existing security and Telegram behavior.

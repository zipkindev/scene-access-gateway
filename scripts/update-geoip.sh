#!/bin/sh
set -eu

repository_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
geoip_directory=${SAG_GEOIP_DIR:-$repository_root/.local/geoip}
account_file=${SAG_MAXMIND_ACCOUNT_ID_FILE:-$repository_root/.local/secrets/maxmind-account-id}
license_file=${SAG_MAXMIND_LICENSE_KEY_FILE:-$repository_root/.local/secrets/maxmind-license-key}

for command_name in curl tar install mktemp; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "missing required command: $command_name" >&2
    exit 1
  }
done

test -f "$account_file" || { echo "missing MaxMind account ID file: $account_file" >&2; exit 1; }
test -f "$license_file" || { echo "missing MaxMind license-key file: $license_file" >&2; exit 1; }

account_id=$(tr -d '\r\n' < "$account_file")
license_key=$(tr -d '\r\n' < "$license_file")
case "$account_id" in *[!0-9]*|'') echo "invalid MaxMind account ID" >&2; exit 1 ;; esac
case "$license_key" in *[!A-Za-z0-9_]*|'') echo "invalid MaxMind license key" >&2; exit 1 ;; esac

umask 077
temporary_directory=$(mktemp -d "${TMPDIR:-/tmp}/scene-geoip.XXXXXX")
trap 'rm -rf "$temporary_directory"' EXIT HUP INT TERM
netrc_file=$temporary_directory/netrc
printf 'machine download.maxmind.com login %s password %s\n' "$account_id" "$license_key" > "$netrc_file"

mkdir -p "$geoip_directory"
for edition in City ASN; do
  archive=$temporary_directory/GeoLite2-$edition.tar.gz
  extracted=$temporary_directory/GeoLite2-$edition.mmdb
  curl --fail --silent --show-error --location --netrc-file "$netrc_file" \
    "https://download.maxmind.com/geoip/databases/GeoLite2-$edition/download?suffix=tar.gz" \
    --output "$archive"
  tar --extract --gzip --file "$archive" --wildcards --strip-components=1 \
    --directory "$temporary_directory" "*/GeoLite2-$edition.mmdb"
  test -s "$extracted" || { echo "downloaded GeoLite2-$edition database is empty" >&2; exit 1; }
  install -m 0644 "$extracted" "$geoip_directory/GeoLite2-$edition.mmdb.new"
  mv "$geoip_directory/GeoLite2-$edition.mmdb.new" "$geoip_directory/GeoLite2-$edition.mmdb"
done

echo "updated local GeoLite2 City and ASN databases in $geoip_directory"

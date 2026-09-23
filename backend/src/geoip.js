'use strict';

const fs = require('node:fs');
const net = require('node:net');
const maxmind = require('maxmind');

function privateAddress(ip) {
  ip = String(ip).toLowerCase();
  if (ip === 'unknown' || ip === '127.0.0.1' || ip === '::1') return true;
  if (ip.startsWith('10.') || ip.startsWith('192.168.') || ip.startsWith('169.254.')) return true;
  const match = /^172\.(\d{1,3})\./.exec(ip);
  if (match && Number(match[1]) >= 16 && Number(match[1]) <= 31) return true;
  return ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80:');
}

class GeoIpLookup {
  constructor(cityPath = process.env.GEOIP_CITY_DB_PATH, asnPath = process.env.GEOIP_ASN_DB_PATH) {
    this.cityPath = cityPath || null;
    this.asnPath = asnPath || null;
    this.city = this._open(this.cityPath);
    this.asn = this._open(this.asnPath);
  }

  _open(file) {
    if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) return null;
    return new maxmind.Reader(fs.readFileSync(file));
  }

  reload() {
    this.city = this._open(this.cityPath);
    this.asn = this._open(this.asnPath);
    return this.status();
  }

  status() {
    const detail = (file, reader) => ({ configured: Boolean(file), loaded: Boolean(reader),
      updatedAt: reader ? fs.statSync(file).mtime.toISOString() : null });
    return { mode: 'local-mmdb', city: detail(this.cityPath, this.city), asn: detail(this.asnPath, this.asn) };
  }

  lookup(ip) {
    if (!net.isIP(ip)) return { scope: 'unknown' };
    if (privateAddress(ip)) return { scope: 'private' };
    const city = this.city?.get(ip) || {};
    const asn = this.asn?.get(ip) || {};
    const country = city.country?.iso_code || city.registered_country?.iso_code || null;
    const subdivisions = Array.isArray(city.subdivisions) ? city.subdivisions : [];
    return {
      scope: 'public', country,
      region: subdivisions[0]?.iso_code || null,
      city: city.city?.names?.en || null,
      accuracyRadiusKm: Number.isFinite(city.location?.accuracy_radius) ? city.location.accuracy_radius : null,
      asn: Number.isInteger(asn.autonomous_system_number) ? asn.autonomous_system_number : null,
      organization: typeof asn.autonomous_system_organization === 'string'
        ? asn.autonomous_system_organization.slice(0, 160) : null,
    };
  }
}

module.exports = { GeoIpLookup, privateAddress };

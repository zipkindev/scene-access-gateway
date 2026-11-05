"use strict";
const net = require('node:net');
const dns = require('node:dns').promises;

function normalizeIp(value) {
  const ip = String(value || '');
  return ip.startsWith('::ffff:') && net.isIP(ip.slice(7)) === 4 ? ip.slice(7) : ip;
}

// Forwarded identity is accepted only from explicitly enrolled proxy peers.
// The proxy must overwrite this header and independently restrict the route.
function createManagementSource(source, proxies = '', proxyHosts = '', lookup = dns.lookup) {
  const allowedSource = normalizeIp(source);
  const trusted = proxies ? proxies.split(',').map(normalizeIp) : [];
  const hosts = proxyHosts ? proxyHosts.split(',') : [];
  if (hosts.some(host => !/^[a-zA-Z0-9][a-zA-Z0-9-]{0,62}$/.test(host))) {
    throw new Error('Invalid management proxy service configuration');
  }
  if (!net.isIP(allowedSource) || trusted.some(ip => !net.isIP(ip))) {
    throw new Error('Invalid management source configuration');
  }
  return async (request) => {
    const peer = normalizeIp(request.socket?.remoteAddress);
    if (peer === allowedSource) return true;
    const header = request.headers['x-management-source-ip'];
    const copies = (request.rawHeaders || []).filter((value, index) => index % 2 === 0
      && value.toLowerCase() === 'x-management-source-ip').length;
    if (copies !== 1 || typeof header !== 'string' || header !== allowedSource) return false;
    if (trusted.includes(peer)) return true;
    // Resolve only operator-enrolled private Compose service names. Dynamic
    // container addresses may change during native application recreation.
    try {
      const addresses = await Promise.all(hosts.map(host => lookup(host, { all: true })));
      return addresses.flat().some(entry => normalizeIp(entry.address) === peer);
    } catch (_) { return false; }
  };
}
module.exports = { createManagementSource };

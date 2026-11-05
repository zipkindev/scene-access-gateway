"use strict";
const net = require('node:net');

function normalizeIp(value) {
  const ip = String(value || '');
  return ip.startsWith('::ffff:') && net.isIP(ip.slice(7)) === 4 ? ip.slice(7) : ip;
}

// Forwarded identity is accepted only from explicitly enrolled proxy peers.
// The proxy must overwrite this header and independently restrict the route.
function createManagementSource(source, proxies = '') {
  const allowedSource = normalizeIp(source);
  const trusted = proxies ? proxies.split(',').map(normalizeIp) : [];
  if (!net.isIP(allowedSource) || trusted.some(ip => !net.isIP(ip))) {
    throw new Error('Invalid management source configuration');
  }
  return (request) => {
    const peer = normalizeIp(request.socket?.remoteAddress);
    if (peer === allowedSource) return true;
    if (!trusted.includes(peer)) return false;
    const header = request.headers['x-management-source-ip'];
    const copies = (request.rawHeaders || []).filter((value, index) => index % 2 === 0
      && value.toLowerCase() === 'x-management-source-ip').length;
    return copies === 1 && typeof header === 'string' && header === allowedSource;
  };
}
module.exports = { createManagementSource };

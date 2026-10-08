'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { activeRecon, collectPassiveNetwork, isPublicIp } = require('./source-intelligence');

const PORT = 8090;
const ACTIVE_ENABLED = process.env.SOURCE_INTELLIGENCE_ACTIVE_ENABLED === 'true';
const PROTECTED_DESTINATION_IP = isPublicIp(process.env.PROTECTED_DESTINATION_IP || '')
  ? process.env.PROTECTED_DESTINATION_IP : null;
const TOKEN_PATH = process.env.SOURCE_INTELLIGENCE_WORKER_TOKEN_PATH || '';
const TOKEN = fs.readFileSync(TOKEN_PATH, 'utf8').trim();
if (!/^[A-Za-z0-9+/=]{40,80}$/.test(TOKEN)) throw new Error('Invalid source-intelligence worker token');
let running = false;

function send(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(body);
}

function readTarget(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    let bytes = 0;
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > 1024) return reject(new Error('invalid'));
      body += chunk;
    });
    request.on('end', () => {
      try {
        const value = JSON.parse(body);
        if (Object.keys(value).join(',') !== 'ip' || !isPublicIp(value.ip)) throw new Error('invalid');
        resolve(value.ip);
      } catch (_) { reject(new Error('invalid')); }
    });
    request.on('error', reject);
  });
}

http.createServer(async (request, response) => {
  if (request.url === '/healthz' && request.method === 'GET') return send(response, 200, { status: 'ok' });
  if (!['/passive', '/active'].includes(request.url) || request.method !== 'POST') return send(response, 404, { error: 'not found' });
  const supplied = Buffer.from(String(request.headers['x-source-intelligence-token'] || ''));
  const expected = Buffer.from(TOKEN);
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return send(response, 404, { error: 'not found' });
  if (running) return send(response, 409, { error: 'busy' });
  running = true;
  try {
    const ip = await readTarget(request);
    if (ip === PROTECTED_DESTINATION_IP || (request.url === '/active' && !ACTIVE_ENABLED)) {
      return send(response, 403, { error: 'request rejected' });
    }
    return send(response, 200, request.url === '/passive' ? await collectPassiveNetwork(ip) : { ports: await activeRecon(ip) });
  } catch (_) { return send(response, 400, { error: 'request rejected' }); }
  finally { running = false; }
}).listen(PORT, '0.0.0.0', () => console.log(JSON.stringify({ event: 'source_intelligence_worker_ready', port: PORT })));

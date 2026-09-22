'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');

function encode(value) { return Buffer.from(JSON.stringify(value)).toString('base64url'); }

class AssertionIssuer {
  constructor(options = {}) {
    this.issuer = options.issuer || process.env.PORTAL_ASSERTION_ISSUER || '';
    this.audience = options.audience || process.env.PORTAL_ASSERTION_AUDIENCE || 'torrentharbor';
    this.keyId = options.keyId || process.env.PORTAL_ASSERTION_KEY_ID || '';
    const keyPath = options.keyPath || process.env.PORTAL_ASSERTION_KEY_PATH || '';
    this.privateKey = options.privateKey || (keyPath ? crypto.createPrivateKey(fs.readFileSync(keyPath)) : null);
    if (!this.issuer || !this.keyId || !this.privateKey || this.privateKey.asymmetricKeyType !== 'ed25519') throw new Error('Assertion issuer is not configured');
  }

  issue(session, now = Math.floor(Date.now() / 1000)) {
    const sessionExpiry = Math.floor(Date.parse(session.expiresAt) / 1000);
    if (!Number.isSafeInteger(sessionExpiry) || sessionExpiry <= now) throw new Error('Portal session expired');
    const identity = session.identity || {};
    if (!session.id || !identity.subject || !identity.username || !identity.email) throw new Error('Portal session identity missing');
    const header = { alg: 'EdDSA', kid: this.keyId, typ: 'JWT' };
    const payload = {
      iss: this.issuer, aud: this.audience, sub: identity.subject,
      preferred_username: identity.username, email: identity.email,
      email_verified: true, portal_sid: session.id,
      jti: crypto.randomBytes(32).toString('base64url'),
      iat: now, nbf: now - 5, exp: Math.min(now + 60, sessionExpiry),
      session_exp: sessionExpiry,
    };
    const signingInput = `${encode(header)}.${encode(payload)}`;
    const signature = crypto.sign(null, Buffer.from(signingInput), this.privateKey).toString('base64url');
    return `${signingInput}.${signature}`;
  }
}

module.exports = { AssertionIssuer };

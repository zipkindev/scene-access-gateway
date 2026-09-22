'use strict';

const crypto = require('node:crypto');

const DESTINATIONS = new Set(['torrentharbor', 'firewall']);
const OUTCOMES = new Set([
  'invalid_challenge_token', 'invalid_identifier', 'rate_limited',
  'challenge_unavailable', 'challenge_not_pending',
  'destination_unavailable', 'lookup_failed', 'not_eligible',
  'internal_error', 'message_create_failed', 'smtp_failed', 'smtp_rejected', 'smtp_accepted',
]);
const SMTP_CODES = new Set(['EAUTH', 'EDNS', 'ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'ETLS']);
const FAILURE_WINDOW_MS = 10 * 60 * 1000;
let smtpFailures = [];
let lastAlertAt = 0;

function smtpErrorClass(error) {
  return SMTP_CODES.has(error?.code) ? error.code : 'OTHER';
}

function logLoginOutcome(requestId, destination, outcome, smtpError = null, write = console.log) {
  if (!/^[0-9a-f-]{36}$/.test(requestId) || !OUTCOMES.has(outcome)) throw new Error('Invalid login telemetry');
  const record = {
    event: 'qr_login_email',
    request_id: requestId,
    destination: DESTINATIONS.has(destination) ? destination : 'unknown',
    outcome,
  };
  if (outcome === 'smtp_failed') record.smtp_error = smtpErrorClass({ code: smtpError });
  write(JSON.stringify(record));
  if (outcome === 'smtp_accepted') { smtpFailures = []; lastAlertAt = 0; }
  if (outcome === 'smtp_failed' || outcome === 'smtp_rejected') {
    const now = Date.now();
    smtpFailures = smtpFailures.filter((at) => at > now - FAILURE_WINDOW_MS);
    smtpFailures.push(now);
    if (smtpFailures.length >= 3 && now - lastAlertAt >= FAILURE_WINDOW_MS) {
      lastAlertAt = now;
      write(JSON.stringify({ event: 'qr_login_email_alert', destination: record.destination,
        reason: 'repeated_smtp_failure', failures: smtpFailures.length, window_minutes: 10 }));
    }
  }
}

function newLoginRequestId() { return crypto.randomUUID(); }

module.exports = { logLoginOutcome, newLoginRequestId, smtpErrorClass };

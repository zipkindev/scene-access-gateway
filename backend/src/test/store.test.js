'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { PortalStore, tokenHash } = require('../store');

test('dual identity survives approval and session revocation', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'access-portal-store-'));
  try {
    const store = new PortalStore(directory);
    const challenge = store.createChallenge(tokenHash('browser'), Date.now() + 60_000);
    assert.ok(store.getChallenge(challenge, tokenHash('browser')));
    assert.equal(store.getChallenge(challenge, tokenHash('other')), null);
    const identity = { subject: '42', username: 'person', email: 'person@example.com' };
    const message = store.createMessage(challenge, identity, Date.now() + 60_000);
    assert.deepEqual(store.consumeMessage(message).identity, identity);
    assert.equal(store.consumeMessage(message), null);
    const token = store.approveAndCreateSession(challenge, Date.now() + 60_000);
    assert.deepEqual(store.session(token).identity, identity);
    assert.equal(store.revokeSession(token), true);
    assert.equal(store.session(token), null);
  } finally {
    fs.rmSync(directory, { recursive: true });
  }
});

test('read-only lookups do not rewrite state and cleanup is throttled', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'access-portal-read-only-'));
  try {
    const store = new PortalStore(directory);
    const challenge = store.createChallenge(tokenHash('browser'), Date.now() + 60_000);
    const file = path.join(directory, 'state.json');
    const before = fs.statSync(file).mtimeNs;
    assert.ok(store.getChallenge(challenge));
    assert.equal(store.listRequests().pendingCount, 0);
    assert.equal(fs.statSync(file).mtimeNs, before);
    assert.notEqual(store.purge(), false);
    const afterPurge = fs.statSync(file).mtimeNs;
    assert.equal(store.purge(), false);
    assert.equal(fs.statSync(file).mtimeNs, afterPurge);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('firewall approval cannot authorize TorrentHarbor and expires independently', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'access-portal-destinations-'));
  try {
    const store = new PortalStore(directory);
    const identity = { subject: '42', username: 'person', email: 'person@example.com' };
    const browserHash = tokenHash('browser');
    const firewall = store.createChallenge(browserHash, Date.now() + 60_000, 'firewall');
    const torrentharbor = store.createChallenge(browserHash, Date.now() + 60_000);
    assert.notEqual(firewall, torrentharbor);
    assert.equal(store.getChallenge(firewall).destinationId, 'firewall');
    store.consumeMessage(store.createMessage(firewall, identity, Date.now() + 60_000));
    const grant = store.approveAndCreateSession(firewall, Date.now() + 60_000);
    assert.equal(store.session(grant, 'torrentharbor'), null);
    assert.equal(store.session(grant, 'firewall').identity.subject, '42');
    assert.equal(store.getChallenge(torrentharbor).status, 'pending');
    assert.equal(store.validSession(grant), false);
    assert.equal(store.revokeSession(grant), true);
    assert.equal(store.session(grant, 'firewall'), null);
  } finally {
    fs.rmSync(directory, { recursive: true });
  }
});

test('firewall handoff is single-use, host-scoped session material', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'access-portal-handoff-'));
  try {
    const store = new PortalStore(directory);
    const identity = { subject: '42', username: 'person', email: 'person@example.com' };
    const challenge = store.createChallenge(tokenHash('browser'), Date.now() + 60_000, 'firewall');
    store.consumeMessage(store.createMessage(challenge, identity, Date.now() + 60_000));
    const handoff = store.approveAndCreateHandoff(challenge, Date.now() + 60_000);
    assert.equal(store.getChallenge(challenge).status, 'consumed');
    assert.throws(() => store.approveAndCreateHandoff(challenge, Date.now() + 60_000));
    const restarted = new PortalStore(directory);
    const session = restarted.consumeHandoff(handoff, Date.now() + 60_000);
    assert.equal(restarted.consumeHandoff(handoff, Date.now() + 60_000), null);
    assert.equal(restarted.session(session, 'torrentharbor'), null);
    assert.equal(restarted.session(session, 'firewall').identity.subject, '42');
    const expiredChallenge = restarted.createChallenge(tokenHash('browser'), Date.now() + 60_000, 'firewall');
    restarted.consumeMessage(restarted.createMessage(expiredChallenge, identity, Date.now() + 60_000));
    const expired = restarted.approveAndCreateHandoff(expiredChallenge, Date.now() - 1);
    assert.equal(restarted.consumeHandoff(expired, Date.now() + 60_000), null);
  } finally { fs.rmSync(directory, { recursive: true }); }
});

function temporaryStore(callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'access-portal-ledger-'));
  try { return callback(new PortalStore(directory), directory); }
  finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

test('legacy IDs migrate atomically and remain stable across restart', () => temporaryStore((store, directory) => {
  const file = path.join(directory, 'state.json');
  const state = JSON.parse(fs.readFileSync(file));
  state.requests = [
    { email: ' Person@Example.com ', requestedAt: '2026-09-19T00:00:00.000Z', sourceIp: '192.0.2.1', status: 'pending' },
    { email: 'other@example.com', requestedAt: '2026-09-19T00:00:01.000Z', sourceIp: '192.0.2.2', status: 'pending' },
  ];
  delete state.blockedEmails; delete state.decisionAudit;
  fs.writeFileSync(file, JSON.stringify(state));
  const migrated = new PortalStore(directory);
  const first = migrated.listRequests();
  assert.equal(first.pendingCount, 2);
  assert.deepEqual(first.requests.map((entry) => entry.email), ['person@example.com', 'other@example.com']);
  assert.ok(first.requests.every((entry) => /^[A-Za-z0-9_-]{22}$/.test(entry.id) && !('sourceIp' in entry)));
  assert.notEqual(first.requests[0].id, first.requests[1].id);
  assert.deepEqual(new PortalStore(directory).listRequests().requests, first.requests);
  const persisted = JSON.parse(fs.readFileSync(file));
  assert.equal(persisted.requests[0].sourceIp, '192.0.2.1');
  assert.equal(persisted.requests[0].decidedAt, null);
  assert.deepEqual(persisted.decisionAudit, []);
}));

test('ambiguous and malformed legacy state refuses startup without rewriting', () => temporaryStore((store, directory) => {
  const file = path.join(directory, 'state.json');
  const state = JSON.parse(fs.readFileSync(file));
  state.requests = [
    { email: 'same@example.com', requestedAt: '2026-09-19T00:00:00.000Z', status: 'pending' },
    { email: ' SAME@example.com ', requestedAt: '2026-09-19T00:00:01.000Z', status: 'pending' },
  ];
  const original = JSON.stringify(state);
  fs.writeFileSync(file, original);
  assert.throws(() => new PortalStore(directory), /Ambiguous/);
  assert.equal(fs.readFileSync(file, 'utf8'), original);
  state.requests[1].email = 'other@example.com';
  state.requests[1].requestedAt = 'not-a-time';
  fs.writeFileSync(file, JSON.stringify(state));
  assert.throws(() => new PortalStore(directory), /Invalid request ledger/);
}));

test('normalization, durable block and unblock never revive historical requests', () => temporaryStore((store, directory) => {
  const first = store.createRequest(' PERSON@Example.com ', '192.0.2.4');
  assert.equal(first.email, 'person@example.com');
  assert.equal(store.createRequest('person@example.com', '192.0.2.5'), null);
  assert.equal(store.decideRequest(first.id, 'block', 'torrentharbor-decision:1').status, 'blocked');
  assert.equal(store.createRequest('person@example.com', '192.0.2.5'), null);
  assert.equal(new PortalStore(directory).listRequests('blocked').requests.length, 1);
  store.purge(Date.now() + 365 * 86400_000);
  assert.equal(store.listRequests('blocked').requests.length, 1);
  assert.equal(store.decideRequest(first.id, 'unblock', 'torrentharbor-decision:2').status, 'unblocked');
  assert.equal(store.listRequests('blocked').requests.length, 0);
  assert.equal(store.listRequests().pendingCount, 0);
  const second = store.createRequest('person@example.com', '192.0.2.6');
  assert.ok(second && second.id !== first.id);
  assert.equal(store.listRequests().pendingCount, 1);
}));

test('requests and group decisions stay within their destination', () => temporaryStore((store, directory) => {
  const harbor = store.createRequest('same@example.com', '192.0.2.1');
  const firewall = store.createRequest('same@example.com', '192.0.2.1', 'firewall');
  assert.ok(harbor && firewall && harbor.id !== firewall.id);
  assert.equal(store.listRequests().pendingCount, 1);
  assert.equal(store.listRequests('pending', 100, null, 'firewall').pendingCount, 1);
  assert.throws(() => store.decideRequest(firewall.id, 'approve', 'torrentharbor-user:1'), /Unknown/);
  store.decideRequest(harbor.id, 'block', 'torrentharbor-decision:1');
  assert.equal(store.listRequests().pendingCount, 0);
  assert.equal(new PortalStore(directory).listRequests('pending', 100, null, 'firewall').pendingCount, 1);
  assert.equal(store.createRequest('same@example.com', '192.0.2.1', 'firewall'), null);
}));

test('editor decisions keep firewall and TorrentHarbor blocklists separate', () => temporaryStore((store, directory) => {
  const firewall = store.createRequest('shared@example.com', '192.0.2.1', 'firewall');
  const harbor = store.createRequest('shared@example.com', '192.0.2.1');
  assert.equal(store.adminRequest(firewall.id, 'firewall', 'block').status, 'blocked');
  assert.equal(store.createRequest('shared@example.com', '192.0.2.2', 'firewall'), null);
  assert.equal(store.listRequests('pending', 100, null, 'torrentharbor').pendingCount, 1);
  assert.equal(store.adminRequest(firewall.id, 'firewall', 'unblock').status, 'unblocked');
  assert.equal(store.adminRequest(harbor.id, 'torrentharbor', 'dismiss').status, 'dismissed');
  assert.equal(new PortalStore(directory).listRequests('dismissed').requests.length, 1);
  assert.ok(store.createRequest('shared@example.com', '192.0.2.3', 'firewall'));
  assert.throws(() => store.adminRequest(harbor.id, 'firewall', 'block'), /Unknown/);
}));

test('keyset pagination validates cursor and counts the full pending set', () => temporaryStore((store) => {
  for (let index = 0; index < 103; index += 1) store.createRequest(`person${index}@example.com`, '192.0.2.1');
  const first = store.listRequests('pending', 100);
  assert.equal(first.requests.length, 100);
  assert.equal(first.pendingCount, 103);
  assert.match(first.nextCursor, /^[A-Za-z0-9_-]+$/);
  const second = store.listRequests('pending', 100, first.nextCursor);
  assert.equal(second.requests.length, 3);
  assert.equal(second.nextCursor, null);
  assert.equal(new Set([...first.requests, ...second.requests].map((entry) => entry.id)).size, 103);
  assert.throws(() => store.listRequests('pending', 101), /Invalid/);
  assert.throws(() => store.listRequests('pending', 1, 'bad'), /Invalid/);
  assert.throws(() => store.listRequests('blocked', 1, first.nextCursor), /Invalid/);
}));

test('decisions are atomic, replay safely, conflict on changed reference, and audit excludes PII', () => temporaryStore((store, directory) => {
  const first = store.createRequest('one@example.com', '192.0.2.1');
  assert.deepEqual(store.decideRequest(first.id, 'approve', 'torrentharbor-user:42'), {
    ...first, status: 'approved', decision: 'approved', decisionRef: 'torrentharbor-user:42',
  });
  assert.equal(store.decideRequest(first.id, 'approve', 'torrentharbor-user:42').status, 'approved');
  assert.throws(() => store.decideRequest(first.id, 'approve', 'torrentharbor-user:43'), /conflict/);
  assert.throws(() => store.decideRequest(first.id, 'block', 'torrentharbor-decision:4'), /conflict/);
  assert.throws(() => store.decideRequest('A'.repeat(22), 'approve', 'torrentharbor-user:44'), /Unknown/);
  assert.throws(() => store.decideRequest(first.id, 'approve', 'bad ref'), /Invalid/);
  const state = JSON.parse(fs.readFileSync(path.join(directory, 'state.json')));
  assert.equal(state.decisionAudit.length, 1);
  assert.deepEqual(Object.keys(state.decisionAudit[0]).sort(), ['action', 'actor', 'at', 'decisionRef', 'requestId']);
  assert.ok(!JSON.stringify(state.decisionAudit).includes('example.com'));
  assert.ok(!JSON.stringify(state.decisionAudit).includes('192.0.2.1'));
}));

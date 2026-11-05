"use strict";
const assert = require('node:assert/strict');
const test = require('node:test');
const { createManagementSource } = require('../management-source');
const source = '192.0.2.10', proxy = '192.0.2.20';
function request(peer, value, rawHeaders) {
  return { socket: { remoteAddress: peer }, headers: { 'x-management-source-ip': value },
    rawHeaders: rawHeaders || (value === undefined ? [] : ['X-Management-Source-IP', value]) };
}
test('direct mode accepts only the enrolled TCP source and ignores spoofed headers', () => {
  const allowed = createManagementSource(source);
  assert.equal(allowed(request(source)), true);
  assert.equal(allowed(request('::ffff:' + source)), true);
  for (const peer of [proxy, '192.0.2.30', undefined]) assert.equal(allowed(request(peer, source)), false);
});
test('proxy mode requires both the enrolled TCP proxy and exact original source', () => {
  const allowed = createManagementSource(source, proxy + ',2001:db8::20');
  assert.equal(allowed(request(proxy, source)), true);
  assert.equal(allowed(request('::ffff:' + proxy, source)), true);
  assert.equal(allowed(request('2001:db8::20', source)), true);
  assert.equal(allowed(request('192.0.2.30', source)), false);
  for (const value of [undefined, '', '192.0.2.30', source + ', ' + source, [source], ' ' + source]) {
    assert.equal(allowed(request(proxy, value)), false);
  }
  assert.equal(allowed(request(proxy, source, ['X-Management-Source-IP', source, 'x-management-source-ip', source])), false);
});
test('invalid source or proxy configuration fails closed', () => {
  for (const [source, proxies] of [['invalid', ''], ['192.0.2.10', '*'], ['192.0.2.10', '192.0.2.0/24'], ['192.0.2.10', '192.0.2.20,']]) {
    assert.throws(() => createManagementSource(source, proxies), /Invalid management source/);
  }
});

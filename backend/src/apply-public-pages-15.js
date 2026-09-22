'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');

const file = '/app/server.js';
let source = fs.readFileSync(file, 'utf8');
if (crypto.createHash('sha256').update(source).digest('hex') !==
    '4338ebf3cf52a18cb8662ec461e0d3884fc751913da5a49ccba592c65332c4ee') {
  throw new Error('Portal server source does not match the reviewed public-login release');
}

function replaceOnce(before, after) {
  const first = source.indexOf(before);
  if (first < 0 || source.indexOf(before, first + 1) >= 0) throw new Error('Expected unique server source not found');
  source = source.slice(0, first) + after + source.slice(first + before.length);
}

replaceOnce("const { loginPage, requestPage, submittedPage, confirmedPage } = require('./public-auth-pages');",
  "const { loginPage, requestPage, submittedPage, confirmedPage, notFoundPage, methodPage } = require('./public-auth-pages');");
replaceOnce("return send(res, 405, { Allow: 'GET, HEAD' }, 'Method not allowed');",
  "return send(res, 405, { Allow: 'GET, HEAD', 'Content-Type': 'text/html; charset=utf-8' }, methodPage());");
replaceOnce("return send(res, 404, { 'Content-Type': 'text/plain' }, 'Not found');",
  "return send(res, 404, { 'Content-Type': 'text/html; charset=utf-8' }, notFoundPage());");

fs.writeFileSync(file, source);

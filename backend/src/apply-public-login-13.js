'use strict';

// The shared source tree contains artwork work that is not yet in the live
// portal. Apply this release to the exact running server image only.
const crypto = require('node:crypto');
const fs = require('node:fs');

const file = '/app/server.js';
let source = fs.readFileSync(file, 'utf8');
const expected = 'ebaa418a91a4f686d13c7c0e949966e8d46ba3e86ac792cdabb8fd7df31e5285';
if (crypto.createHash('sha256').update(source).digest('hex') !== expected) {
  throw new Error('Portal server source does not match the reviewed live image');
}

function replaceOnce(before, after) {
  const first = source.indexOf(before);
  if (first < 0 || source.indexOf(before, first + 1) >= 0) throw new Error('Expected unique server source not found');
  source = source.slice(0, first) + after + source.slice(first + before.length);
}

replaceOnce("const { createSceneAdmin } = require('./scene-admin');",
  "const { createSceneAdmin } = require('./scene-admin');\nconst { loginPage, requestPage, submittedPage, confirmedPage } = require('./public-auth-pages');");
replaceOnce(`function neutral(res, status = 200) { send(res, status, { 'Content-Type': 'text/html; charset=utf-8' }, '<!doctype html><meta charset="utf-8"><title>Access</title><p>Check your email to continue if access is available.</p>'); }`,
  `function neutral(res, status = 200) { send(res, status, { 'Content-Type': 'text/html; charset=utf-8' }, submittedPage()); }`);
replaceOnce('function page(html) { return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Access</title>${html}`; }\n', '');
replaceOnce('page(`<form method="post" action="/login/${token}"><label>Username or email <input name="identifier" maxlength="254" autocomplete="username" required></label><button>Continue</button></form><p><a href="/request-access">Request access</a></p>`)', 'loginPage(token)');
replaceOnce("page('<p>Access confirmed. Return to the original device.</p>')", 'confirmedPage()');
replaceOnce("page('<form method=\"post\" action=\"/request-access\"><label>Email <input type=\"email\" name=\"email\" maxlength=\"254\" autocomplete=\"email\" required></label><button>Request access</button></form>')", 'requestPage()');

fs.writeFileSync(file, source);

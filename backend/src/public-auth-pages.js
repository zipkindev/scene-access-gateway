'use strict';

const style = `<style>
:root{color-scheme:dark;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
*{box-sizing:border-box}
body{min-height:100svh;margin:0;display:grid;place-items:center;padding:24px;color:#f8f9ff;background:radial-gradient(circle at 18% 12%,#4932a3 0,transparent 34%),radial-gradient(circle at 86% 88%,#075b85 0,transparent 32%),linear-gradient(145deg,#0a1027,#13163b 55%,#082337)}
.card{width:min(100%,430px);padding:clamp(28px,6vw,42px);border:1px solid rgba(204,216,255,.2);border-radius:24px;background:rgba(19,25,57,.82);box-shadow:0 30px 80px rgba(0,0,0,.34);backdrop-filter:blur(20px)}
.mark{width:50px;height:50px;display:grid;place-items:center;margin:0 auto 23px;border-radius:16px;background:linear-gradient(135deg,#ab70ff,#49baff);box-shadow:0 12px 28px rgba(91,96,255,.36);font-size:26px;font-weight:700;line-height:1}
.eyebrow{margin:0 0 9px;color:#8cebd4;font-size:.76rem;font-weight:750;letter-spacing:.16em;text-align:center;text-transform:uppercase}
h1{margin:0;color:#fff;font-size:clamp(1.7rem,6vw,2.15rem);line-height:1.16;letter-spacing:-.045em;text-align:center}
.intro{margin:13px 0 29px;color:#bcc9e6;font-size:.96rem;line-height:1.55;text-align:center}
label{display:block;margin:0 0 9px;color:#e6ebff;font-size:.9rem;font-weight:650}
input{display:block;width:100%;min-height:50px;padding:13px 15px;border:1px solid #52618c;border-radius:12px;outline:0;background:#101735;color:#fff;font:inherit;transition:border-color .18s,box-shadow .18s}
input::placeholder{color:#8998bd}input:focus{border-color:#79c8ff;box-shadow:0 0 0 4px rgba(76,182,255,.18)}
button{width:100%;min-height:51px;margin-top:18px;border:0;border-radius:12px;background:linear-gradient(110deg,#aa70ff,#748dff 50%,#36c5e8);box-shadow:0 12px 28px rgba(74,100,255,.32);color:#fff;font:700 1rem system-ui,-apple-system,"Segoe UI",sans-serif;cursor:pointer;transition:transform .18s,filter .18s}
button:hover{transform:translateY(-2px);filter:brightness(1.12)}button:focus-visible,a:focus-visible{outline:3px solid #87dcff;outline-offset:3px}
.foot{margin:24px 0 0;color:#bdcae9;font-size:.9rem;text-align:center}.foot a{color:#8cdbff;font-weight:650;text-decoration:none}.foot a:hover{text-decoration:underline}
.check{width:58px;height:58px;display:grid;place-items:center;margin:0 auto 23px;border:1px solid rgba(107,239,196,.5);border-radius:50%;background:rgba(58,189,152,.16);color:#7af2c5;font-size:29px;line-height:1}
@media(prefers-reduced-motion:reduce){button,input{transition:none}}
</style>`;

function page(content) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Access portal</title>${style}</head><body><main class="card">${content}</main></body></html>`;
}

function loginPage(token) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('Invalid challenge token');
  return page(`<div class="mark" aria-hidden="true">Z</div><p class="eyebrow">Private access</p><h1>Welcome back</h1><p class="intro">Enter your username or email to continue.</p><form method="post" action="/login/${token}"><label for="identifier">Username or email</label><input id="identifier" name="identifier" maxlength="254" autocomplete="username" placeholder="you@example.com" required autofocus><button type="submit">Continue</button></form><p class="foot">New here? <a href="/request-access?challenge=${token}">Request access</a></p>`);
}

function requestPage(challengeToken = null) {
  if (challengeToken !== null && !/^[A-Za-z0-9_-]{43}$/.test(challengeToken)) throw new Error('Invalid challenge token');
  const context = challengeToken ? `<input type="hidden" name="challenge" value="${challengeToken}">` : '';
  return page(`<div class="mark" aria-hidden="true">Z</div><p class="eyebrow">Join the portal</p><h1>Request access</h1><p class="intro">Leave your email and we’ll review your request.</p><form method="post" action="/request-access">${context}<label for="email">Email address</label><input id="email" type="email" name="email" maxlength="254" autocomplete="email" placeholder="you@example.com" required autofocus><button type="submit">Send request</button></form>`);
}

function submittedPage() {
  return page('<div class="check" aria-hidden="true">✓</div><p class="eyebrow">Next step</p><h1>Check your email</h1><p class="intro">If access is available, we’ll send a link to continue. You can close this page and return to your original device.</p>');
}

function confirmedPage() {
  return page('<div class="check" aria-hidden="true">✓</div><p class="eyebrow">All set</p><h1>Access confirmed</h1><p class="intro">Return to your original device to continue.</p>');
}

function notFoundPage() {
  return page('<div class="mark" aria-hidden="true">Z</div><p class="eyebrow">Access portal</p><h1>Page not found</h1><p class="intro">This link may have changed or expired.</p><p class="foot"><a href="/">Return to the portal</a></p>');
}

function methodPage() {
  return page('<div class="mark" aria-hidden="true">Z</div><p class="eyebrow">Access portal</p><h1>Action unavailable</h1><p class="intro">This action can’t be completed from this page.</p><p class="foot"><a href="/">Return to the portal</a></p>');
}

module.exports = { loginPage, requestPage, submittedPage, confirmedPage, notFoundPage, methodPage };

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const IDENTIFIER = /^[a-z][a-z0-9-]{1,47}$/;
const ENVIRONMENT = /^[A-Z][A-Z0-9_]{2,63}$/;
const RESERVED_ROUTES = new Set(['/api/', '/assets/', '/challenge/', '/healthz/', '/internal/', '/login/', '/logout/']);
const REQUIRED = new Set(['negative-sensitive-path', 'security-headers']);
const ALLOWED_DIRECTIVES = new Set(['connect-src', 'font-src', 'frame-src', 'img-src', 'media-src', 'script-src', 'style-src']);

function assert(condition, message) {
  if (!condition) throw new Error(`Invalid application contract: ${message}`);
}

function environment(value, label) {
  assert(typeof value === 'string' && ENVIRONMENT.test(value), `${label} must name an environment variable`);
}

function validateApplicationContracts(value) {
  assert(value && !Array.isArray(value) && value.schemaVersion === 1 && Array.isArray(value.applications), 'unsupported schema');
  assert(value.applications.length > 0 && value.applications.length <= 32, 'application count is out of bounds');
  const ids = new Set();
  const routes = new Set();
  for (const application of value.applications) {
    assert(application && !Array.isArray(application) && IDENTIFIER.test(application.id || ''), 'invalid application id');
    assert(!ids.has(application.id), `duplicate application id ${application.id}`);
    ids.add(application.id);
    assert(['path', 'host'].includes(application.public?.mode), `${application.id} has an invalid public mode`);
    environment(application.public.originEnvironment, `${application.id} public origin`);
    if (application.public.mode === 'path') {
      const route = application.public.route;
      assert(typeof route === 'string' && /^\/[a-z0-9/-]*$/.test(route) && route.endsWith('/'), `${application.id} has an invalid route`);
      assert(!RESERVED_ROUTES.has(route) && !routes.has(route), `${application.id} has a reserved or duplicate route`);
      routes.add(route);
    } else assert(application.public.route === undefined, `${application.id} host-mode application cannot declare a path route`);

    assert(['local-service', 'tls-origin'].includes(application.upstream?.kind), `${application.id} has an invalid upstream kind`);
    if (application.upstream.kind === 'local-service') {
      assert(/^[a-z][a-z0-9-]{1,63}$/.test(application.upstream.service || ''), `${application.id} has an invalid service`);
    } else {
      environment(application.upstream.addressEnvironment, `${application.id} upstream address`);
      environment(application.upstream.tlsNameEnvironment, `${application.id} upstream TLS name`);
      if (application.upstream.urlEnvironment !== undefined) environment(application.upstream.urlEnvironment, `${application.id} upstream URL`);
    }

    const access = application.access;
    assert(access && ['boolean'].includes(typeof access.portalSession)
      && typeof access.authentikRelay === 'boolean' && typeof access.qrDestination === 'boolean', `${application.id} has an incomplete access contract`);
    if (access.portalSession) assert(/^app:[a-z][a-z0-9-]{1,47}$/.test(access.authentikGroup || ''), `${application.id} requires an Authentik group`);
    if (access.authentikRelay) assert(typeof access.assertionAudience === 'string' && IDENTIFIER.test(access.assertionAudience), `${application.id} requires an assertion audience`);

    assert(application.proxy && typeof application.proxy.preservePrefix === 'boolean'
      && ['same-origin', 'rewrite-to-upstream'].includes(application.proxy.originPolicy)
      && ['public-host', 'trusted-internal-host', 'tls-name'].includes(application.proxy.hostPolicy), `${application.id} has an incomplete proxy contract`);
    const sources = application.browserPolicy?.externalSources;
    assert(Array.isArray(sources), `${application.id} browser policy is missing`);
    for (const source of sources) {
      assert(ALLOWED_DIRECTIVES.has(source.directive), `${application.id} has an invalid browser-policy directive`);
      assert(/^https:\/\/[a-z0-9.-]+(?::\d+)?$/.test(source.origin || '') && !source.origin.includes('*'), `${application.id} has an invalid external origin`);
      assert(typeof source.reason === 'string' && source.reason.trim().length >= 12 && source.reason.length <= 160, `${application.id} external origin needs a bounded rationale`);
    }

    assert(application.waf?.policy === 'inherit' && Array.isArray(application.waf.exclusions), `${application.id} must inherit the WAF policy`);
    for (const exclusion of application.waf.exclusions) {
      assert(Array.isArray(exclusion.ruleIds) && exclusion.ruleIds.length > 0
        && exclusion.ruleIds.every((id) => /^\d{1,10}$/.test(String(id))), `${application.id} WAF exclusion needs exact rule IDs`);
      assert(/^\/[a-zA-Z0-9_./:{}-]+$/.test(exclusion.path || '') && !exclusion.path.includes('*'), `${application.id} WAF exclusion needs an exact path`);
      assert(Array.isArray(exclusion.methods) && exclusion.methods.length > 0
        && exclusion.methods.every((method) => ['GET', 'HEAD', 'POST'].includes(method)), `${application.id} WAF exclusion needs bounded methods`);
      assert(typeof exclusion.reason === 'string' && exclusion.reason.trim().length >= 20, `${application.id} WAF exclusion needs a rationale`);
      assert(/^\d{4}-\d{2}-\d{2}$/.test(exclusion.reviewBy || ''), `${application.id} WAF exclusion needs a review date`);
    }

    assert(Array.isArray(application.verification), `${application.id} verification journeys are missing`);
    const journeys = new Set(application.verification);
    for (const required of REQUIRED) assert(journeys.has(required), `${application.id} is missing ${required} verification`);
    if (access.portalSession) assert(journeys.has('anonymous-redirect'), `${application.id} is missing anonymous access verification`);
    if (access.qrDestination) assert(journeys.has('qr-click-receipt'), `${application.id} is missing QR perception verification`);
    if (access.authentikRelay) assert(journeys.has('authentik-relay'), `${application.id} is missing Authentik relay verification`);
  }
  return value;
}

function loadApplicationContracts(file = path.join(__dirname, '..', '..', 'deploy', 'applications.json')) {
  return validateApplicationContracts(JSON.parse(fs.readFileSync(file, 'utf8')));
}

module.exports = { loadApplicationContracts, validateApplicationContracts };

'use strict';

const net = require('node:net');

const RULES = Object.freeze({
  '200003': { category: 'protocol_anomaly', severity: 'warning', summary: 'Multipart request body failed strict validation' },
  '911100': { category: 'unexpected_http_method', severity: 'warning', summary: 'HTTP method is not allowed by policy' },
  '920100': { category: 'protocol_anomaly', severity: 'warning', summary: 'Invalid HTTP request line' },
  '913100': { category: 'known_scanner', severity: 'warning', summary: 'Known security scanner signature detected' },
  '920280': { category: 'protocol_anomaly', severity: 'warning', summary: 'Request missing required Host header' },
  '920320': { category: 'protocol_anomaly', severity: 'info', summary: 'Request missing User-Agent header' },
  '920340': { category: 'protocol_anomaly', severity: 'warning', summary: 'Request body has no Content-Type header' },
  '920350': { category: 'protocol_anomaly', severity: 'warning', summary: 'Numeric IP used as the HTTP Host header' },
  '920420': { category: 'protocol_anomaly', severity: 'warning', summary: 'Request Content-Type is not allowed by policy' },
  '920440': { category: 'protocol_anomaly', severity: 'warning', summary: 'URL file extension restricted by policy' },
  '920451': { category: 'protocol_anomaly', severity: 'critical', summary: 'HTTP header restricted by policy' },
  '920500': { category: 'backup_file_probe', severity: 'warning', summary: 'Backup or working file requested' },
  '930130': { category: 'sensitive_file_enumeration', severity: 'critical', summary: 'Restricted or sensitive file requested' },
  '930140': { category: 'backup_file_probe', severity: 'warning', summary: 'Backup or working file requested' },
  '932240': { category: 'command_injection_probe', severity: 'critical', summary: 'Unix command-injection evasion pattern detected' },
  '933160': { category: 'command_injection_probe', severity: 'critical', summary: 'High-risk PHP function-call injection pattern detected' },
  '933210': { category: 'command_injection_probe', severity: 'critical', summary: 'PHP variable-function injection pattern detected' },
  '934100': { category: 'command_injection_probe', severity: 'critical', summary: 'Node.js injection pattern detected' },
  '934130': { category: 'command_injection_probe', severity: 'critical', summary: 'JavaScript prototype-pollution pattern detected' },
  '941340': { category: 'cross_site_scripting_probe', severity: 'critical', summary: 'Cross-site scripting pattern detected by IE filter signatures' },
  '941390': { category: 'cross_site_scripting_probe', severity: 'critical', summary: 'Suspicious JavaScript method pattern detected' },
  '942120': { category: 'sql_injection_probe', severity: 'critical', summary: 'SQL operator injection pattern detected' },
  '942200': { category: 'sql_injection_probe', severity: 'critical', summary: 'MySQL comment or space-obfuscated injection pattern detected' },
  '942300': { category: 'sql_injection_probe', severity: 'critical', summary: 'MySQL comment, condition, or character-function injection pattern detected' },
  '942340': { category: 'sql_injection_probe', severity: 'critical', summary: 'SQL authentication-bypass pattern detected' },
  '942370': { category: 'sql_injection_probe', severity: 'critical', summary: 'Classic SQL injection probing pattern detected' },
  '942430': { category: 'sql_injection_probe', severity: 'critical', summary: 'Excessive restricted SQL characters detected' },
  '942550': { category: 'sql_injection_probe', severity: 'critical', summary: 'JSON-based SQL injection pattern detected' },
  '950100': { category: 'application_error_exposure', severity: 'warning', summary: 'Application returned a 500-level response' },
});

const CATEGORY_PRIORITY = [
  'command_injection_probe', 'sql_injection_probe', 'cross_site_scripting_probe', 'path_traversal_probe',
  'sensitive_file_enumeration', 'backup_file_probe', 'known_scanner',
  'framework_admin_probe', 'service_enumeration', 'application_error_exposure',
  'unexpected_http_method', 'protocol_anomaly', 'automated_scanner_probe',
];
const SEVERITY_RANK = { info: 0, warning: 1, critical: 2 };
const PRESENTATION_RULESET = '2026-09-26.2';
const SERVICE_ENUMERATION = [
  { pattern: /^\/(?:Remote(?:\/|$)|RDWeb(?:\/|$))/i,
    summary: 'Microsoft Remote Desktop Web service enumeration' },
  { pattern: /^\/(?:sslvpnLogin\.html|api\/sonicos\/(?:auth|tfa)|sonicui\/\d+\/sslvpn-portal(?:\/|$)|auth1?\.html)$/i,
    summary: 'SonicWall SSL-VPN service enumeration' },
  { pattern: /^\/(?:ecp\/Current\/exporttool\/microsoft\.exchange\.ediscovery\.exporttool\.application|owa\/auth\/(?:logon|errorFE)\.aspx)$/i,
    summary: 'Microsoft Exchange/OWA service enumeration' },
  { pattern: /^\/(?:dana-na\/(?:nc\/nc_gina_ver\.txt|auth\/url_default\/welcome\.cgi)|dana-cached\/hc\/HostCheckerInstaller\.osx)$/i,
    summary: 'Ivanti/Pulse Secure VPN service enumeration' },
  { pattern: /^\/wsman\/?$/i, summary: 'Windows remote-management service enumeration' },
  { pattern: /^\/(?:global-protect\/prelogin\.esp|myvpn|vpntunnel|remote\/login|sslvpnclient|svpn\/index\.cgi|dispatch\.asp|auth_portal\/Default\/logo\.gif|\+CSCOU\+\/csco_logo\.gif|fonts\/ftnt-icons\.woff)\/?$/i,
    summary: 'VPN gateway service enumeration' },
  { pattern: /^\/version\/?$/i, summary: 'Service version endpoint enumeration' },
];
const PATH_FINDINGS = [
  { category: 'sensitive_file_enumeration', severity: 'critical',
    pattern: /(?:^|\/)(?:\.env(?:[._~-][^/]*)?|\.git(?:-askpass\.sh|-credentials|-secret|\/|$)|aws_credentials\.ini|credentials\.ini|database\.sql|mysql\.sql|terraform\.tfstate(?:\.backup)?|s3\.key|private\.key|server\.key|settings\.ini|wp_mail_smtp\.ini|wp-config\.php|mailcow\.conf|pip\.conf|php-fpm\.conf|sphinx\.conf|lighttpd\.conf|tomcat-users\.xml|appsettings(?:\.Production)?\.json|application\.(?:properties|ya?ml)|\.pypirc)(?:\/|$)/i,
    summary: 'Credential, configuration, or data file enumeration' },
  { category: 'backup_file_probe', severity: 'warning',
    pattern: /(?:^|\/)(?:backup\.sql|www\.bak|info\.php\.bak|[^/]{1,180}(?:\.bak|\.backup|\.old|\.orig|\.save|\.swp|~))(?:\/|$)/i,
    summary: 'Backup or working file enumeration' },
  { category: 'framework_admin_probe', severity: 'warning',
    pattern: /(?:^|\/)(?:wp-admin|wp-login\.php|phpmyadmin|server-status|actuator|vendor\/phpunit|_profiler|telescope|swagger|v[23]\/api-docs|api-docs|openapi\.(?:json|ya?ml)|ReportServer|developmentserver\/metadatauploader)(?:\/|$)/i,
    summary: 'Framework or administrative endpoint enumeration' },
];

function ruleId(message) {
  return String(message?.details?.ruleId || '');
}

function ruleSeverity(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (['0', '1', '2', 'emergency', 'alert', 'critical'].includes(normalized)) return 'critical';
  if (['3', '4', 'error', 'warning', 'warn'].includes(normalized)) return 'warning';
  if (['5', '6', '7', 'notice', 'info', 'informational', 'debug'].includes(normalized)) return 'info';
  return null;
}

function messageCategory(message) {
  const details = message?.details || {};
  const rule = ruleId(message);
  const known = RULES[rule];
  if (known) return known.category;
  const tags = Array.isArray(details.tags) ? details.tags.map((value) => String(value).toLowerCase()) : [];
  const text = String(message?.message || '').toLowerCase();
  if (tags.some((tag) => tag.includes('attack-sqli'))) return 'sql_injection_probe';
  if (tags.some((tag) => tag.includes('attack-rce') || tag.includes('attack-command'))) return 'command_injection_probe';
  if (tags.some((tag) => tag.includes('attack-lfi') || tag.includes('attack-rfi'))) return 'path_traversal_probe';
  if (rule.startsWith('920') || text.includes('header') || text.includes('protocol')) return 'protocol_anomaly';
  if (text.includes('restricted file access')) return 'sensitive_file_enumeration';
  if (text.includes('backup or working file')) return 'backup_file_probe';
  if (text.includes('security scanner')) return 'known_scanner';
  return 'automated_scanner_probe';
}

function findingCategory(messages) {
  const categories = new Set(messages.map(messageCategory));
  return CATEGORY_PRIORITY.find((candidate) => categories.has(candidate)) || 'automated_scanner_probe';
}

function findingSeverity(messages, category = findingCategory(messages)) {
  const values = messages.map((message) => ruleSeverity(message?.details?.severity)
    || RULES[ruleId(message)]?.severity).filter(Boolean);
  if (values.length) return values.reduce((highest, value) => SEVERITY_RANK[value] > SEVERITY_RANK[highest] ? value : highest, 'info');
  return ['command_injection_probe', 'sql_injection_probe', 'path_traversal_probe',
    'sensitive_file_enumeration'].includes(category) ? 'critical'
    : category === 'automated_scanner_probe' || category === 'backup_file_probe'
      || category === 'known_scanner' || category === 'framework_admin_probe' ? 'warning' : 'info';
}

function ruleSummary(ruleIds) {
  const summaries = [...new Set((Array.isArray(ruleIds) ? ruleIds : [])
    .map((id) => RULES[String(id)]?.summary).filter(Boolean))];
  return summaries.slice(0, 3).join('; ') || null;
}

function defaultHostRejection(target, ruleIds) {
  const ids = Array.isArray(ruleIds) ? ruleIds.map(String) : [];
  return net.isIP(String(target || '')) !== 0 && ids.includes('920350');
}

function serviceEnumeration(pathname, target, ruleIds) {
  if (!defaultHostRejection(target, ruleIds)) return null;
  return SERVICE_ENUMERATION.find((item) => item.pattern.test(String(pathname || '')))?.summary || null;
}

function pathFinding(pathname) {
  return PATH_FINDINGS.find((item) => item.pattern.test(String(pathname || ''))) || null;
}

function presentWafEvent(event) {
  if (event?.type !== 'waf_finding' || event.integrityValid === false) return event;
  event.classificationVersion = PRESENTATION_RULESET;
  const ids = Array.isArray(event.edge?.ruleIds) ? event.edge.ruleIds.map(String) : [];
  if (!ids.length) return event;
  const known = ids.map((id) => RULES[id]).filter(Boolean);
  const allProtocol = ids.every((id) => id.startsWith('920'));
  if (allProtocol) event.category = 'protocol_anomaly';
  if (known.length === ids.length) {
    const knownCategories = new Set(known.map((value) => value.category));
    event.category = CATEGORY_PRIORITY.find((candidate) => knownCategories.has(candidate)) || event.category;
    event.severity = known.reduce((highest, value) => SEVERITY_RANK[value.severity] > SEVERITY_RANK[highest]
      ? value.severity : highest, 'info');
  }
  const summary = ruleSummary(ids);
  if (summary) event.edge.ruleSummary = summary;
  const pathMatch = pathFinding(event.http?.path);
  if (pathMatch) {
    event.category = pathMatch.category;
    event.severity = pathMatch.severity;
    event.edge.behaviorSummary = pathMatch.summary;
  }
  const behavior = serviceEnumeration(event.http?.path, event.edge?.target, ids);
  if (behavior) {
    event.category = 'service_enumeration';
    event.severity = 'warning';
    event.edge.behaviorSummary = behavior;
  }
  if (defaultHostRejection(event.edge?.target, ids) && event.http?.statusSource !== 'edge_access') {
    if (event.http && event.http.statusSource === 'modsecurity_audit'
      && Number.isInteger(event.http.status)) event.http.auditStatus = event.http.status;
    if (event.http) {
      event.http.status = 444;
      event.http.statusSource = 'edge_policy';
    }
    event.edge.disposition = 'edge_rejected';
    event.edge.statusVerified = true;
    event.edge.originReached = false;
    event.edge.correlationStatus = 'verified';
    event.outcome = 'edge_rejected';
  } else if (event.edge?.statusVerified !== true) {
    event.edge.disposition = 'outcome_unknown';
    event.edge.originReached = null;
    event.edge.correlationStatus = 'unavailable';
    event.outcome = 'outcome_unknown';
  } else if (event.edge?.disposition === 'waf_blocked') {
    event.edge.originReached = false;
    event.edge.correlationStatus = 'verified';
  } else if (event.edge?.statusVerified === true) {
    event.edge.correlationStatus = 'verified';
  }
  return event;
}

function applyWafOutcome(event, correction) {
  if (event?.type !== 'waf_finding' || correction?.type !== 'waf_outcome'
    || !event.edge?.transactionId
    || event.edge.transactionId !== correction.edge?.transactionId
    || correction.integrityValid !== true || correction.edge?.statusVerified !== true) return event;
  const auditStatus = Number.isInteger(event.http?.auditStatus) ? event.http.auditStatus
    : event.http?.statusSource === 'modsecurity_audit' && Number.isInteger(event.http.status)
      ? event.http.status : null;
  event.http = { ...event.http, status: correction.http?.status ?? event.http?.status ?? null,
    statusSource: 'edge_access', auditStatus,
    upstreamStatus: correction.http?.upstreamStatus ?? null };
  event.edge = { ...event.edge, disposition: correction.edge.disposition,
    statusVerified: true, originReached: correction.edge.originReached, correlationStatus: 'verified' };
  event.outcome = correction.edge.disposition;
  event.requestId = correction.requestId || event.requestId;
  return event;
}

module.exports = { CATEGORY_PRIORITY, PRESENTATION_RULESET, RULES, findingCategory, findingSeverity, messageCategory,
  applyWafOutcome, defaultHostRejection, pathFinding, presentWafEvent,
  ruleSeverity, ruleSummary, serviceEnumeration };

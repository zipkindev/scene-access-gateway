'use strict';

const RULES = Object.freeze({
  '913100': { category: 'known_scanner', severity: 'warning', summary: 'Known security scanner signature detected' },
  '920350': { category: 'protocol_anomaly', severity: 'warning', summary: 'Numeric IP used as the HTTP Host header' },
  '920451': { category: 'protocol_anomaly', severity: 'critical', summary: 'HTTP header restricted by policy' },
  '920500': { category: 'backup_file_probe', severity: 'warning', summary: 'Backup or working file requested' },
  '930130': { category: 'sensitive_file_enumeration', severity: 'critical', summary: 'Restricted or sensitive file requested' },
  '930140': { category: 'backup_file_probe', severity: 'warning', summary: 'Backup or working file requested' },
});

const CATEGORY_PRIORITY = [
  'command_injection_probe', 'sql_injection_probe', 'path_traversal_probe',
  'sensitive_file_enumeration', 'backup_file_probe', 'known_scanner',
  'framework_admin_probe', 'protocol_anomaly', 'automated_scanner_probe',
];
const SEVERITY_RANK = { info: 0, warning: 1, critical: 2 };

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

function presentWafEvent(event) {
  if (event?.type !== 'waf_finding' || event.integrityValid === false) return event;
  const ids = Array.isArray(event.edge?.ruleIds) ? event.edge.ruleIds.map(String) : [];
  if (!ids.length) return event;
  const known = ids.map((id) => RULES[id]).filter(Boolean);
  const allProtocol = ids.every((id) => id.startsWith('920'));
  if (allProtocol) event.category = 'protocol_anomaly';
  if (known.length === ids.length) {
    event.severity = known.reduce((highest, value) => SEVERITY_RANK[value.severity] > SEVERITY_RANK[highest]
      ? value.severity : highest, 'info');
  }
  const summary = ruleSummary(ids);
  if (summary) event.edge.ruleSummary = summary;
  return event;
}

module.exports = { CATEGORY_PRIORITY, RULES, findingCategory, findingSeverity, messageCategory,
  presentWafEvent, ruleSeverity, ruleSummary };

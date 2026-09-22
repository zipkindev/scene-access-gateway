'use strict';

const fs = require('node:fs');
const nodemailer = require('nodemailer');

const SMTP_CONFIG_PATH = process.env.SMTP_CONFIG_PATH || '/run/secrets/proton-smtp.env';

function loadSmtpConfig(configPath = SMTP_CONFIG_PATH) {
  const values = Object.create(null);
  for (const rawLine of fs.readFileSync(configPath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) throw new Error('Invalid SMTP secret-file format');
    values[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }

  for (const key of ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USERNAME', 'SMTP_PASSWORD', 'SMTP_FROM']) {
    if (!values[key]) throw new Error(`Missing ${key} in SMTP secret file`);
  }

  const port = Number.parseInt(values.SMTP_PORT, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid SMTP_PORT');
  return { host: values.SMTP_HOST, port, username: values.SMTP_USERNAME, password: values.SMTP_PASSWORD, from: values.SMTP_FROM };
}

function createMailer(config = loadSmtpConfig()) {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: false,
    requireTLS: true,
    auth: { user: config.username, pass: config.password },
    tls: { minVersion: 'TLSv1.2', servername: config.host },
  });
}

module.exports = { createMailer, loadSmtpConfig };

#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { loadApplicationContracts } = require('../backend/src/application-contracts');

const file = path.join(__dirname, '..', 'deploy', 'applications.json');
const contracts = loadApplicationContracts(file);
process.stdout.write(`application contracts valid: ${contracts.applications.length}\n`);

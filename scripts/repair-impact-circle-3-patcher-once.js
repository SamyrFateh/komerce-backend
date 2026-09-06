#!/usr/bin/env node
'use strict';

const fs = require('fs');
const file = 'scripts/impact-circle-3-fix-once.js';
let source = fs.readFileSync(file, 'utf8');
const bad = "updatedEl.textContent = updatedDate ? `Enregistrée le ${updatedDate}.` : '';";
const good = "updatedEl.textContent = updatedDate ? 'Enregistrée le ' + updatedDate + '.' : '';";
if (!source.includes(bad)) throw new Error('Expected nested-template patcher fragment not found');
source = source.replace(bad, good);
fs.writeFileSync(file, source);
console.log('Repaired nested template literal in temporary patcher.');

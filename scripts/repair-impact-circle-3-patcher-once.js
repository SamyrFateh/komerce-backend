#!/usr/bin/env node
'use strict';

const fs = require('fs');
const file = 'scripts/impact-circle-3-fix-once.js';
let source = fs.readFileSync(file, 'utf8');

const badTemplate = "updatedEl.textContent = updatedDate ? `Enregistrée le ${updatedDate}.` : '';";
const goodTemplate = "updatedEl.textContent = updatedDate ? 'Enregistrée le ' + updatedDate + '.' : '';";
if (source.includes(badTemplate)) source = source.replace(badTemplate, goodTemplate);

const testStart = source.indexOf("const testSource = `");
const testEnd = source.indexOf("fs.writeFileSync(testPath, testSource);", testStart);
if (testStart < 0 || testEnd < 0) throw new Error('Generated test source block not found');
const prefix = source.slice(0, testStart);
let testBlock = source.slice(testStart, testEnd);
const suffix = source.slice(testEnd);
// The test source itself is a template literal, so double quotes need no escaping.
// Normalize accidental backslashes before them only inside this generated-test block.
testBlock = testBlock.replace(/\\+"/g, '"');
source = prefix + testBlock + suffix;

fs.writeFileSync(file, source);
console.log('Repaired temporary patcher syntax and generated-test quoting.');

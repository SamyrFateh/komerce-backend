#!/usr/bin/env node
'use strict';

const fs = require('fs');
const file = 'scripts/impact-circle-3-fix-once.js';
let source = fs.readFileSync(file, 'utf8');

const badBrace = "  const brace = source.indexOf('{', start);";
const goodBrace = "  const signatureEnd = source.indexOf(') {', start);\n  const brace = signatureEnd >= 0 ? source.indexOf('{', signatureEnd) : source.indexOf('{', start);";
if (!source.includes(badBrace)) throw new Error('Expected replaceFunction brace locator not found');
source = source.replace(badBrace, goodBrace);

const badTemplate = "updatedEl.textContent = updatedDate ? `Enregistrée le ${updatedDate}.` : '';";
const goodTemplate = "updatedEl.textContent = updatedDate ? 'Enregistrée le ' + updatedDate + '.' : '';";
if (source.includes(badTemplate)) source = source.replace(badTemplate, goodTemplate);

const multilineName = `      <span class="k-kmc-sec-value" id="k-kmc-auth-name">
        <span id="k-kmc-auth-given"></span> <span id="k-kmc-auth-family"></span>
      </span>`;
const compactName = `      <span class="k-kmc-sec-value" id="k-kmc-auth-name"><span id="k-kmc-auth-given"></span> <span id="k-kmc-auth-family"></span></span>`;
if (!source.includes(multilineName)) throw new Error('Expected authorized-name markup not found');
source = source.replace(multilineName, compactName);

const testStart = source.indexOf("const testSource = `");
const testEnd = source.indexOf("fs.writeFileSync(testPath, testSource);", testStart);
if (testStart < 0 || testEnd < 0) throw new Error('Generated test source block not found');
const prefix = source.slice(0, testStart);
let testBlock = source.slice(testStart, testEnd);
const suffix = source.slice(testEnd);
testBlock = testBlock.replace(/\\+"/g, '"');
source = prefix + testBlock + suffix;

fs.writeFileSync(file, source);
console.log('Repaired temporary patcher signatures, exact text contract, syntax, and generated-test quoting.');

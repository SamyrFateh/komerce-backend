'use strict';

const fs = require('fs');
const file = 'scripts/gen-gate-findings.js';
let src = fs.readFileSync(file, 'utf8');

const oldVerdict = `    const warn = /(⚠|\\bWARN(?:ING)?\\b|avertissement)/i.test(message);\n    const fail = /(❌|✖|\\bERROR\\b|\\bFAIL(?:ED)?\\b|violation|interdit|conflict|duplicate)/i.test(message);\n    findings.push({ gate, scope: 'boutique', verdict: fail ? 'fail' : warn ? 'warn' : exitCode ? 'fail' : 'warn', type: 'TEXT-GATE-DIAGNOSTIC', feature: null, file: file || currentFile, message });`;

const newVerdict = `    const warn = /(⚠|\\bWARN(?:ING)?\\b|avertissement)/i.test(message);\n    const failSignal = /(❌|✖|\\bERROR\\b|\\bFAIL(?:ED)?\\b|violation|interdit|conflict|duplicate)/i.test(message);\n    // Un gate qui termine avec exit 0 a validé sa baseline : les diagnostics\n    // de dette visible restent des WARN, jamais des FAIL projetés.\n    // Un exit non nul conserve en revanche les signaux d'échec explicites.\n    const verdict = exitCode === 0 ? 'warn' : failSignal ? 'fail' : warn ? 'warn' : 'fail';\n    findings.push({ gate, scope: 'boutique', verdict, type: 'TEXT-GATE-DIAGNOSTIC', feature: null, file: file || currentFile, message });`;

if (src.includes(oldVerdict)) src = src.replace(oldVerdict, newVerdict);

const oldSelfCheck = `  const owners = buildCanonicalFileIndex(root, local).get('public/boutique/js/x.js');\n  if (!owners || [...owners].join(',') !== 'orders') throw new Error('P3b local ownership precedence self-check failed');`;

const newSelfCheck = `  const owners = buildCanonicalFileIndex(root, local).get('public/boutique/js/x.js');\n  if (!owners || [...owners].join(',') !== 'orders') throw new Error('P3b local ownership precedence self-check failed');\n  const okDebt = parseTextFindings('check:test', 'public/boutique/css/a.css — 2 violations baseline', 0);\n  if (okDebt.length !== 1 || okDebt[0].verdict !== 'warn') throw new Error('P3b successful gate diagnostic must project as warn');\n  const failedDebt = parseTextFindings('check:test', 'public/boutique/css/a.css — 1 violation hors baseline', 1);\n  if (failedDebt.length !== 1 || failedDebt[0].verdict !== 'fail') throw new Error('P3b failing gate diagnostic must project as fail');`;

if (src.includes(oldSelfCheck)) src = src.replace(oldSelfCheck, newSelfCheck);

fs.writeFileSync(file, src, 'utf8');
console.log('fixed scripts/gen-gate-findings.js');

'use strict';
const fs = require('fs');
const g = JSON.parse(fs.readFileSync('docs/BUSINESS_FEATURE_GRAPH.json', 'utf8'));
const debt = Array.isArray(g.drifts && g.drifts.debt) ? g.drifts.debt : [];
const counts = {};
for (const d of debt) {
  const key = d.type || d.category || d.warningType || 'UNKNOWN';
  counts[key] = (counts[key] || 0) + 1;
}
console.log('DRIFT_DEBT_COUNTS', JSON.stringify(counts));
for (const d of debt) console.log('DRIFT_DEBT_ITEM', JSON.stringify(d));
const signals = Array.isArray(g.drifts && g.drifts.signals) ? g.drifts.signals : [];
const signalCounts = {};
for (const d of signals) {
  const key = d.type || d.category || d.warningType || 'UNKNOWN';
  signalCounts[key] = (signalCounts[key] || 0) + 1;
}
console.log('DRIFT_SIGNAL_COUNTS', JSON.stringify(signalCounts));

'use strict';
const fs = require('fs');
const p = 'scripts/gen-security-360.js';
let src = fs.readFileSync(p, 'utf8');

function replaceText(from, to, label) {
  if (!src.includes(from)) throw new Error(`${label}: source pattern not found`);
  src = src.replace(from, to);
}

function replaceBetween(start, end, replacement, label) {
  const a = src.indexOf(start);
  if (a < 0) throw new Error(`${label}: start marker not found`);
  const b = src.indexOf(end, a);
  if (b < 0) throw new Error(`${label}: end marker not found`);
  src = src.slice(0, a) + replacement + src.slice(b);
}

if (!src.includes("require('./security-360-dispositions')")) {
  replaceText(
    "const BASELINE = path.join(__dirname, '.security-360-baseline.json');\n",
    "const BASELINE = path.join(__dirname, '.security-360-baseline.json');\nconst { DISPOSITIONS, getDisposition, validateDispositions } = require('./security-360-dispositions');\n",
    'disposition import'
  );
}

const classifyReplacement = [
  "  const isAdminPath = /^\\/api\\/admin(\\/|$)/.test(p);",
  "  const isPublicOk = PUBLIC_OK.some(re => re.test(p));",
  "  const disposition = getDisposition(method + ' ' + p);",
  "  if (!best) {",
  "    if (disposition) return { method, path: p, level: 'PUBLIC', severity: 'ok', roles: [], authn: null, disposition };",
  "    return { method, path: p, level: 'UNKNOWN', severity: 'audit', roles: [], authn: null, disposition: null };",
  "  }",
  "  let level = 'PROTECTED', severity = 'ok', appliedDisposition = null;",
  "  if (isAdminPath && !best.admin) { level = 'ADMIN_NO_GUARD'; severity = 'high'; }",
  "  else if (!best.authn && disposition) { level = 'PUBLIC'; severity = 'ok'; appliedDisposition = disposition; }",
  "  else if (!best.authn && !isPublicOk) { level = 'UNPROTECTED'; severity = 'medium'; }",
  "  else if (!best.authn && isPublicOk) { level = 'PUBLIC'; severity = 'ok'; }",
  "  return { method, path: p, level, severity, roles: best.roles, authn: best.authn, disposition: appliedDisposition };",
  "}",
  "",
].join('\n');
replaceBetween(
  "  const isAdminPath = /^\\/api\\/admin(\\/|$)/.test(p);",
  "\nconst routes = runtimeInventory()",
  classifyReplacement,
  'classify block'
);

const reportReplacement = [
  "const dispositionErrors = validateDispositions();",
  "if (dispositionErrors.length) {",
  "  console.error('✖ Security 360 : registre de dispositions invalide');",
  "  dispositionErrors.forEach(e => console.error('   - ' + e));",
  "  process.exit(1);",
  "}",
  "",
  "const routes = runtimeInventory().map(r => classify(r.method, r.path));",
  "routes.sort((a, b) => (a.path + a.method).localeCompare(b.path + b.method));",
  "const key = r => `${r.method} ${r.path}`;",
  "const runtimeKeys = new Set(routes.map(key));",
  "const missingDispositionRoutes = Object.keys(DISPOSITIONS).filter(k => !runtimeKeys.has(k));",
  "const appliedDispositionKeys = new Set(routes.filter(r => r.disposition).map(key));",
  "const staleDispositions = Object.keys(DISPOSITIONS).filter(k => runtimeKeys.has(k) && !appliedDispositionKeys.has(k));",
  "if (missingDispositionRoutes.length || staleDispositions.length) {",
  "  console.error('✖ Security 360 : dispositions périmées ou sans route runtime');",
  "  missingDispositionRoutes.forEach(k => console.error('   - route absente : ' + k));",
  "  staleDispositions.forEach(k => console.error('   - disposition devenue inutile : ' + k));",
  "  process.exit(1);",
  "}",
  "const flagged = routes.filter(r => r.severity !== 'ok');",
  "const disposed = routes.filter(r => r.disposition);",
  "const summary = {",
  "  total: routes.length,",
  "  protected: routes.filter(r => r.level === 'PROTECTED').length,",
  "  public: routes.filter(r => r.level === 'PUBLIC').length,",
  "  unprotected: routes.filter(r => r.level === 'UNPROTECTED').length,",
  "  admin_no_guard: routes.filter(r => r.level === 'ADMIN_NO_GUARD').length,",
  "  unknown: routes.filter(r => r.level === 'UNKNOWN').length,",
  "};",
  "const report = {",
  "  generatedAt: new Date().toISOString(),",
  "  source: 'hybrid: runtime inventory + static guard analysis + exact route dispositions',",
  "  summary,",
  "  flagged: flagged.map(r => ({ key: key(r), level: r.level, severity: r.severity, roles: r.roles })),",
  "  dispositions: disposed.map(r => ({ key: key(r), kind: r.disposition.kind, evidence: r.disposition.evidence, rationale: r.disposition.rationale })),",
  "};",
  "const projection = {",
  "  source: report.source,",
  "  summary: report.summary,",
  "  flagged: report.flagged,",
  "  dispositions: report.dispositions,",
  "  routes: routes.map(r => ({ key: key(r), level: r.level, roles: r.roles })),",
  "};",
  "",
].join('\n');
replaceBetween(
  "const routes = runtimeInventory()",
  "function renderMarkdown(generatedAt)",
  reportReplacement,
  'report block'
);

replaceBetween(
  "function comparableProjection(doc) {",
  "const current = flagged.map(key).sort();",
  [
    "function comparableProjection(doc) {",
    "  if (!doc) return null;",
    "  return { source: doc.source, summary: doc.summary, flagged: doc.flagged, dispositions: doc.dispositions, routes: doc.routes };",
    "}",
    "",
  ].join('\n'),
  'comparable projection'
);

replaceText(
  "  const known = new Set(base.flagged || []); const novel = current.filter(k => !known.has(k));\n  if (novel.length) {",
  [
    "  const known = new Set(base.flagged || []); const novel = current.filter(k => !known.has(k));",
    "  const resolvedButStillBaselined = [...known].filter(k => !current.includes(k));",
    "  if (resolvedButStillBaselined.length) {",
    "    console.error(`\\x1b[31m\\x1b[1m✖ ${resolvedButStillBaselined.length} signal(aux) résolu(s) encore présent(s) dans la baseline :\\x1b[0m`);",
    "    resolvedButStillBaselined.forEach(k => console.error('   ↓ ' + k));",
    "    console.error('   Lance npm run security:360:save pour rembourser la baseline.');",
    "    process.exit(1);",
    "  }",
    "  if (novel.length) {",
  ].join('\n'),
  'baseline exactness'
);

fs.writeFileSync(p, src);

'use strict';
const fs = require('fs');
const p = 'scripts/gen-security-360.js';
let src = fs.readFileSync(p, 'utf8');

function replaceOnce(from, to, label) {
  if (!src.includes(from)) throw new Error(`${label}: source pattern not found`);
  src = src.replace(from, to);
}

if (!src.includes("require('./security-360-dispositions')")) {
  replaceOnce(
    "const BASELINE = path.join(__dirname, '.security-360-baseline.json');\n",
    "const BASELINE = path.join(__dirname, '.security-360-baseline.json');\nconst { DISPOSITIONS, getDisposition, validateDispositions } = require('./security-360-dispositions');\n",
    'disposition import'
  );
}

replaceOnce(
`  const isAdminPath = /^\\/api\\/admin(\\/|$)/.test(p);\n  const isPublicOk = PUBLIC_OK.some(re => re.test(p));\n  if (!best) return { method, path: p, level: 'UNKNOWN', severity: 'audit', roles: [], authn: null };\n  let level = 'PROTECTED', severity = 'ok';\n  if (isAdminPath && !best.admin) { level = 'ADMIN_NO_GUARD'; severity = 'high'; }\n  else if (!best.authn && !isPublicOk) { level = 'UNPROTECTED'; severity = 'medium'; }\n  else if (!best.authn && isPublicOk) { level = 'PUBLIC'; severity = 'ok'; }\n  return { method, path: p, level, severity, roles: best.roles, authn: best.authn };\n`,
`  const isAdminPath = /^\\/api\\/admin(\\/|$)/.test(p);\n  const isPublicOk = PUBLIC_OK.some(re => re.test(p));\n  const disposition = getDisposition(\`${'${method} ${p}'}\`);\n  if (!best) {\n    if (disposition) {\n      return { method, path: p, level: disposition.kind, severity: 'ok', roles: [], authn: null, disposition };\n    }\n    return { method, path: p, level: 'UNKNOWN', severity: 'audit', roles: [], authn: null, disposition: null };\n  }\n  let level = 'PROTECTED', severity = 'ok', appliedDisposition = null;\n  if (isAdminPath && !best.admin) { level = 'ADMIN_NO_GUARD'; severity = 'high'; }\n  else if (!best.authn && disposition) { level = disposition.kind; severity = 'ok'; appliedDisposition = disposition; }\n  else if (!best.authn && !isPublicOk) { level = 'UNPROTECTED'; severity = 'medium'; }\n  else if (!best.authn && isPublicOk) { level = 'PUBLIC'; severity = 'ok'; }\n  return { method, path: p, level, severity, roles: best.roles, authn: best.authn, disposition: appliedDisposition };\n`,
  'classify disposition'
);

replaceOnce(
`const routes = runtimeInventory().map(r => classify(r.method, r.path));\nroutes.sort((a, b) => (a.path + a.method).localeCompare(b.path + b.method));\nconst key = r => \`${'${r.method} ${r.path}'}\`;\nconst flagged = routes.filter(r => r.severity !== 'ok');\nconst summary = {\n  total: routes.length,\n  protected: routes.filter(r => r.level === 'PROTECTED').length,\n  public: routes.filter(r => r.level === 'PUBLIC').length,\n  unprotected: routes.filter(r => r.level === 'UNPROTECTED').length,\n  admin_no_guard: routes.filter(r => r.level === 'ADMIN_NO_GUARD').length,\n  unknown: routes.filter(r => r.level === 'UNKNOWN').length,\n};\nconst report = { generatedAt: new Date().toISOString(), source: 'hybrid: runtime inventory + static guard analysis', summary,\n  flagged: flagged.map(r => ({ key: key(r), level: r.level, severity: r.severity, roles: r.roles })) };\nconst projection = {\n  source: report.source,\n  summary: report.summary,\n  flagged: report.flagged,\n  routes: routes.map(r => ({ key: key(r), level: r.level, roles: r.roles })),\n};\n`,
`const dispositionErrors = validateDispositions();\nif (dispositionErrors.length) {\n  console.error('✖ Security 360 : registre de dispositions invalide');\n  dispositionErrors.forEach(e => console.error('   - ' + e));\n  process.exit(1);\n}\n\nconst routes = runtimeInventory().map(r => classify(r.method, r.path));\nroutes.sort((a, b) => (a.path + a.method).localeCompare(b.path + b.method));\nconst key = r => \`${'${r.method} ${r.path}'}\`;\nconst runtimeKeys = new Set(routes.map(key));\nconst missingDispositionRoutes = Object.keys(DISPOSITIONS).filter(k => !runtimeKeys.has(k));\nconst appliedDispositionKeys = new Set(routes.filter(r => r.disposition).map(key));\nconst staleDispositions = Object.keys(DISPOSITIONS).filter(k => runtimeKeys.has(k) && !appliedDispositionKeys.has(k));\nif (missingDispositionRoutes.length || staleDispositions.length) {\n  console.error('✖ Security 360 : dispositions périmées ou sans route runtime');\n  missingDispositionRoutes.forEach(k => console.error('   - route absente : ' + k));\n  staleDispositions.forEach(k => console.error('   - disposition devenue inutile (route désormais protégée/autrement classée) : ' + k));\n  process.exit(1);\n}\n\nconst flagged = routes.filter(r => r.severity !== 'ok');\nconst disposed = routes.filter(r => r.disposition);\nconst summary = {\n  total: routes.length,\n  protected: routes.filter(r => r.level === 'PROTECTED').length,\n  public: routes.filter(r => r.level === 'PUBLIC').length,\n  disposed: disposed.length,\n  unprotected: routes.filter(r => r.level === 'UNPROTECTED').length,\n  admin_no_guard: routes.filter(r => r.level === 'ADMIN_NO_GUARD').length,\n  unknown: routes.filter(r => r.level === 'UNKNOWN').length,\n};\nconst report = {\n  generatedAt: new Date().toISOString(),\n  source: 'hybrid: runtime inventory + static guard analysis + exact route dispositions',\n  summary,\n  flagged: flagged.map(r => ({ key: key(r), level: r.level, severity: r.severity, roles: r.roles })),\n  dispositions: disposed.map(r => ({ key: key(r), kind: r.disposition.kind, evidence: r.disposition.evidence, rationale: r.disposition.rationale })),\n};\nconst projection = {\n  source: report.source,\n  summary: report.summary,\n  flagged: report.flagged,\n  dispositions: report.dispositions,\n  routes: routes.map(r => ({ key: key(r), level: r.level, roles: r.roles })),\n};\n`,
  'report disposition'
);

replaceOnce(
`function renderMarkdown(generatedAt) {\n  return ['# Security 360 — couverture des gardes (hybride runtime + statique)', '',\n    \`> ${'${generatedAt}'} — ${'${summary.total}'} endpoints\`, '',\n    '| Niveau | Compte |', '|---|---|',\n    \`| 🟢 PROTECTED | ${'${summary.protected}'} |\`, \`| ⚪ PUBLIC (légitime) | ${'${summary.public}'} |\`,\n    \`| 🟠 UNPROTECTED | ${'${summary.unprotected}'} |\`, \`| 🔴 ADMIN_NO_GUARD | ${'${summary.admin_no_guard}'} |\`,\n    \`| ❔ UNKNOWN (statique n'a pas atteint — à auditer) | ${'${summary.unknown}'} |\`, '',\n    '## Flaggés', '', ...(flagged.length ? flagged.map(r => \`- ${'${r.severity === \'high\' ? \'🔴\' : r.severity === \'audit\' ? \'❔\' : \'🟠\'}'} \\`${'${key(r)}'}\\` — ${'${r.level}'}${'${r.roles.length ? \' (rôles: \' + r.roles.join(\',\') + \')\' : \'\'}'}\`) : ['_Aucun._'])].join('\\n');\n}\n`,
`function renderMarkdown(generatedAt) {\n  const dispositionLines = disposed.length\n    ? disposed.map(r => \`- ✅ \\`${'${key(r)}'}\\` — **${'${r.disposition.kind}'}** — ${'${r.disposition.rationale}'} _[preuve: ${'${r.disposition.evidence}'}]_\`)\n    : ['_Aucune._'];\n  return ['# Security 360 — couverture des gardes (hybride runtime + statique)', '',\n    \`> ${'${generatedAt}'} — ${'${summary.total}'} endpoints\`, '',\n    '| Niveau | Compte |', '|---|---|',\n    \`| 🟢 PROTECTED | ${'${summary.protected}'} |\`, \`| ⚪ PUBLIC legacy (légitime) | ${'${summary.public}'} |\`,\n    \`| ✅ DISPOSITION EXPLICITE | ${'${summary.disposed}'} |\`,\n    \`| 🟠 UNPROTECTED (dette réelle) | ${'${summary.unprotected}'} |\`, \`| 🔴 ADMIN_NO_GUARD | ${'${summary.admin_no_guard}'} |\`,\n    \`| ❔ UNKNOWN (à auditer) | ${'${summary.unknown}'} |\`, '',\n    '## Dette de sécurité non résolue', '', ...(flagged.length ? flagged.map(r => \`- ${'${r.severity === \'high\' ? \'🔴\' : r.severity === \'audit\' ? \'❔\' : \'🟠\'}'} \\`${'${key(r)}'}\\` — ${'${r.level}'}${'${r.roles.length ? \' (rôles: \' + r.roles.join(\',\') + \')\' : \'\'}'}\`) : ['_Aucune._']), '',\n    '## Dispositions explicites (non-dette)', '', ...dispositionLines].join('\\n');\n}\n`,
  'markdown disposition'
);

replaceOnce(
`function comparableProjection(doc) {\n  if (!doc) return null;\n  return { source: doc.source, summary: doc.summary, flagged: doc.flagged, routes: doc.routes };\n}\n`,
`function comparableProjection(doc) {\n  if (!doc) return null;\n  return { source: doc.source, summary: doc.summary, flagged: doc.flagged, dispositions: doc.dispositions, routes: doc.routes };\n}\n`,
  'projection disposition'
);

replaceOnce(
`  const known = new Set(base.flagged || []); const novel = current.filter(k => !known.has(k));\n  if (novel.length) {\n`,
`  const known = new Set(base.flagged || []); const novel = current.filter(k => !known.has(k));\n  const resolvedButStillBaselined = [...known].filter(k => !current.includes(k));\n  if (resolvedButStillBaselined.length) {\n    console.error(\`\\x1b[31m\\x1b[1m✖ ${'${resolvedButStillBaselined.length}'} signal(aux) résolu(s) encore présent(s) dans la baseline :\\x1b[0m\`);\n    resolvedButStillBaselined.forEach(k => console.error('   ↓ ' + k));\n    console.error('   Lance npm run security:360:save pour rembourser la baseline.');\n    process.exit(1);\n  }\n  if (novel.length) {\n`,
  'baseline exactness'
);

replaceOnce(
`  console.log(\`\\x1b[32m✔ Security 360 : projection fraîche, aucune nouvelle anomalie (${'${current.length}'} connus).\\x1b[0m\`);\n`,
`  console.log(\`\\x1b[32m✔ Security 360 : projection fraîche, ${'${disposed.length}'} disposition(s) explicite(s), ${'${current.length}'} dette(s) non résolue(s).\\x1b[0m\`);\n`,
  'check success message'
);

replaceOnce(
`  console.log(\`\\x1b[32m\\x1b[1m✔ Baseline security-360 figée\\x1b[0m (🔴 ${'${summary.admin_no_guard}'} · 🟠 ${'${summary.unprotected}'} · ❔ ${'${summary.unknown}'}).\`);\n`,
`  console.log(\`\\x1b[32m\\x1b[1m✔ Baseline security-360 figée\\x1b[0m (${ '${disposed.length}' } dispositions · 🔴 ${'${summary.admin_no_guard}'} · 🟠 ${'${summary.unprotected}'} · ❔ ${'${summary.unknown}'}).\`);\n`,
  'save success message'
);

replaceOnce(
`console.log(\`Security 360 · ${'${summary.total}'} routes · 🟢 ${'${summary.protected}'} · ⚪ ${'${summary.public}'} · 🟠 ${'${summary.unprotected}'} · 🔴 ${'${summary.admin_no_guard}'} · ❔ ${'${summary.unknown}'}\`);\n`,
`console.log(\`Security 360 · ${'${summary.total}'} routes · 🟢 ${'${summary.protected}'} · ⚪ ${'${summary.public}'} · ✅ dispositions ${'${summary.disposed}'} · 🟠 ${'${summary.unprotected}'} · 🔴 ${'${summary.admin_no_guard}'} · ❔ ${'${summary.unknown}'}\`);\n`,
  'gen success message'
);

fs.writeFileSync(p, src);

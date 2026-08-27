from pathlib import Path
import sys

root = Path(sys.argv[1] if len(sys.argv) > 1 else '.')
p = root / 'scripts/gen-security-360.js'
src = p.read_text()

# WebAuthn login is the authentication ceremony itself. Keep the allow-list
# deliberately narrow: registration, step-up and credential management remain
# guarded and must never inherit this public classification.
public_anchor = "  /^\\/api\\/auth\\/(login|register|refresh|forgot|reset|verify|logout|me)/,\n"
public_line = public_anchor + "  /^\\/api\\/auth\\/passkey\\/login\\/(options|verify)$/,\n"
if "passkey\\/login\\/(options|verify)" not in src:
    if public_anchor not in src:
        raise SystemExit('PUBLIC_OK auth anchor not found')
    src = src.replace(public_anchor, public_line, 1)

anchor = "function mergeInto(t, a) { t.authn = t.authn || a.authn; t.admin = t.admin || a.admin; a.roles.forEach(r => t.roles.add(r)); }\n"
helpers = r'''

function cloneGuards(source) {
  return {
    authn: Boolean(source && source.authn),
    roles: new Set(source && source.roles ? source.roles : []),
    admin: Boolean(source && source.admin),
  };
}

function mergeAliasRefs(target, source, aliases) {
  for (const name of Object.keys(aliases)) {
    if (new RegExp('\\b' + name + '\\b').test(source)) mergeInto(target, aliases[name]);
  }
}

function parseGuardAliases(src) {
  const aliases = {};
  for (const m of src.matchAll(/(?:const|let)\s+(\w+)\s*=\s*\[([\s\S]*?)\]\s*;/g)) {
    const parsed = tokens(m[2]);
    if (parsed.authn || parsed.admin || parsed.roles.size) aliases[m[1]] = parsed;
  }
  for (const m of src.matchAll(/(?:const|let)\s+(\w+)\s*=\s*(requireRole\(\s*\[[\s\S]*?\]\s*\))\s*;/g)) {
    aliases[m[1]] = tokens(m[2]);
  }
  return aliases;
}

function findMatchingParen(src, openIndex) {
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let i = openIndex; i < src.length; i += 1) {
    const ch = src[i];
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function collectRouterGuardUses(src, vEsc, aliases) {
  const uses = [];
  const re = new RegExp('\\b' + vEsc + '\\.use\\s*\\(', 'g');
  let match;
  while ((match = re.exec(src))) {
    const openIndex = src.indexOf('(', match.index);
    const closeIndex = findMatchingParen(src, openIndex);
    if (closeIndex < 0) break;
    const body = src.slice(openIndex + 1, closeIndex);
    const scoped = body.match(/^\s*(['"`])([^'"`]+)\1\s*,/);
    const scope = scoped ? norm(scoped[2]) : null;
    const chain = scoped ? body.slice(scoped[0].length) : body;
    const guard = tokens(chain);
    mergeAliasRefs(guard, chain, aliases);
    if (guard.authn || guard.admin || guard.roles.size) uses.push({ index: match.index, scope, guard });
    re.lastIndex = closeIndex + 1;
  }
  return uses;
}

function applyRouterUses(inherited, uses, routePath, sourceIndex) {
  const out = cloneGuards(inherited);
  const route = norm(routePath);
  for (const use of uses) {
    if (use.index >= sourceIndex) continue;
    if (use.scope && route !== use.scope && !route.startsWith(use.scope + '/')) continue;
    mergeInto(out, use.guard);
  }
  return out;
}
'''
if helpers.strip() not in src:
    if anchor not in src:
        raise SystemExit('mergeInto anchor not found')
    src = src.replace(anchor, anchor + helpers, 1)

start = src.index('  const alias = {};', src.index('function staticGuards'))
end = src.index('  // Le groupe de gardes', start)
replacement = "  const alias = parseGuardAliases(src);\n  const routerGuardUses = collectRouterGuardUses(src, vEsc, alias);\n  const inheritedBase = cloneGuards(inherited);\n  const guardsAt = (routePath, sourceIndex) => applyRouterUses(inheritedBase, routerGuardUses, routePath, sourceIndex);\n\n"
src = src[:start] + replacement + src[end:]

old_t = "    const t = { authn: fileBase.authn, roles: new Set(fileBase.roles), admin: fileBase.admin };"
if src.count(old_t) != 2:
    raise SystemExit(f'expected 2 fileBase route initializers, got {src.count(old_t)}')
src = src.replace(old_t, "    const t = guardsAt(m[2], m.index);")

old_handler = "(async\\\\s*\\\\(|\\\\(\\\\s*req|function\\\\s*\\\\()"
new_handler = "(async\\\\s*\\\\(\\\\s*[_A-Za-z$][\\\\w$]*|\\\\(\\\\s*[_A-Za-z$][\\\\w$]*|function\\\\s*\\\\()"
if old_handler not in src:
    raise SystemExit('inline handler pattern anchor not found')
src = src.replace(old_handler, new_handler, 1)

old_recursion = "      staticGuards(sf, norm(prefix + '/' + sub), seen, acc, fileBase, varName);"
new_recursion = "      staticGuards(sf, norm(prefix + '/' + sub), seen, acc, guardsAt(sub || '/', m.index + 1), varName);"
if old_recursion not in src:
    raise SystemExit('subrouter recursion anchor not found')
src = src.replace(old_recursion, new_recursion, 1)

tail_start = src.index('const report = { generatedAt:')
tail = r'''const report = { generatedAt: new Date().toISOString(), source: 'hybrid: runtime inventory + static guard analysis', summary,
  flagged: flagged.map(r => ({ key: key(r), level: r.level, severity: r.severity, roles: r.roles })) };
const projection = {
  source: report.source,
  summary: report.summary,
  flagged: report.flagged,
  routes: routes.map(r => ({ key: key(r), level: r.level, roles: r.roles })),
};

function renderMarkdown(generatedAt) {
  return ['# Security 360 — couverture des gardes (hybride runtime + statique)', '',
    `> ${generatedAt} — ${summary.total} endpoints`, '',
    '| Niveau | Compte |', '|---|---|',
    `| 🟢 PROTECTED | ${summary.protected} |`, `| ⚪ PUBLIC (légitime) | ${summary.public} |`,
    `| 🟠 UNPROTECTED | ${summary.unprotected} |`, `| 🔴 ADMIN_NO_GUARD | ${summary.admin_no_guard} |`,
    `| ❔ UNKNOWN (statique n'a pas atteint — à auditer) | ${summary.unknown} |`, '',
    '## Flaggés', '', ...(flagged.length ? flagged.map(r => `- ${r.severity === 'high' ? '🔴' : r.severity === 'audit' ? '❔' : '🟠'} \`${key(r)}\` — ${r.level}${r.roles.length ? ' (rôles: ' + r.roles.join(',') + ')' : ''}`) : ['_Aucun._'])].join('\n');
}

function comparableProjection(doc) {
  if (!doc) return null;
  return { source: doc.source, summary: doc.summary, flagged: doc.flagged, routes: doc.routes };
}

const current = flagged.map(key).sort();
if (MODE === 'check') {
  let base = { flagged: [] }; try { base = JSON.parse(fs.readFileSync(BASELINE, 'utf8')); } catch (_) {}
  const known = new Set(base.flagged || []); const novel = current.filter(k => !known.has(k));
  if (novel.length) {
    console.error(`\x1b[31m\x1b[1m✖ ${novel.length} nouvelle(s) anomalie(s) sécu :\x1b[0m`);
    novel.forEach(k => { const r = flagged.find(f => key(f) === k); console.error(`   ↑ ${r.severity === 'high' ? '🔴' : r.severity === 'audit' ? '❔' : '🟠'} ${k} — ${r.level}`); });
    console.error('   (ajoute une garde, ou si légitime : npm run security:360:save)');
    process.exit(1);
  }
  let committedJson = null;
  try { committedJson = JSON.parse(fs.readFileSync(path.join(DOCS, 'SECURITY_360.json'), 'utf8')); } catch (_) {}
  if (!committedJson || JSON.stringify(comparableProjection(committedJson)) !== JSON.stringify(projection)) {
    console.error('\x1b[31m\x1b[1m✖ SECURITY_360.json est périmé.\x1b[0m');
    console.error('   Lance npm run security:360 puis commite docs/SECURITY_360.{json,md}.');
    process.exit(1);
  }
  let committedMd = null;
  try { committedMd = fs.readFileSync(path.join(DOCS, 'SECURITY_360.md'), 'utf8'); } catch (_) {}
  const expectedMd = renderMarkdown(committedJson.generatedAt) + '\n';
  if (committedMd !== expectedMd) {
    console.error('\x1b[31m\x1b[1m✖ SECURITY_360.md est périmé ou désynchronisé du JSON.\x1b[0m');
    console.error('   Lance npm run security:360 puis commite docs/SECURITY_360.{json,md}.');
    process.exit(1);
  }
  console.log(`\x1b[32m✔ Security 360 : projection fraîche, aucune nouvelle anomalie (${current.length} connus).\x1b[0m`);
  process.exit(0);
}

if (!fs.existsSync(DOCS)) fs.mkdirSync(DOCS, { recursive: true });
fs.writeFileSync(path.join(DOCS, 'SECURITY_360.json'), JSON.stringify({ generatedAt: report.generatedAt, ...projection }, null, 2) + '\n');
fs.writeFileSync(path.join(DOCS, 'SECURITY_360.md'), renderMarkdown(report.generatedAt) + '\n');

if (MODE === 'save') {
  fs.writeFileSync(BASELINE, JSON.stringify({ flagged: current }, null, 2) + '\n');
  console.log(`\x1b[32m\x1b[1m✔ Baseline security-360 figée\x1b[0m (🔴 ${summary.admin_no_guard} · 🟠 ${summary.unprotected} · ❔ ${summary.unknown}).`);
  process.exit(0);
}
console.log(`Security 360 · ${summary.total} routes · 🟢 ${summary.protected} · ⚪ ${summary.public} · 🟠 ${summary.unprotected} · 🔴 ${summary.admin_no_guard} · ❔ ${summary.unknown}`);
process.exit(0);
'''
src = src[:tail_start] + tail
p.write_text(src)

w = root / '.github/workflows/pr-enforcement.yml'
wf = w.read_text()
anchor2 = "      - name: Contract consumer check\n        if: needs.changes.outputs.backend == 'true'\n        run: node scripts/contract-check.js\n"
security_step = anchor2 + "      - name: Security 360 freshness and ratchet\n        if: needs.changes.outputs.backend == 'true'\n        run: npm run security:360:check\n"
if 'Security 360 freshness and ratchet' not in wf:
    if anchor2 not in wf:
        raise SystemExit('PR enforcement contract step anchor not found')
    wf = wf.replace(anchor2, security_step, 1)
w.write_text(wf)

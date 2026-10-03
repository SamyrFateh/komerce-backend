/**
 * @komerce-arch
 * @role          security-guard-token-analysis
 * @domain        infrastructure
 * @layer         tooling
 * @criticality   high
 * @inputs        source text of an Express route chain or route file
 * @outputs       guard facts per chain: authn, admin, roles, legacy market-scope guards
 * @depends       none
 * @used-by       scripts/gen-security-360.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      docs/SECURITY_360.md (jamais de faux négatif silencieux)
 * @impact-areas  governance, security
 * @version       2026-10-v1
 */
'use strict';

/**
 * Extraction pure de l'analyse statique de `gen-security-360.js` (qui s'exécute
 * dès qu'on le `require`, donc ne se teste pas). Ajout unique : les gardes
 * « scope marché » du middleware `require-market-scope`, pour que l'inventaire
 * de la PR D (un seul moteur d'autorisation) dérive de l'analyseur existant
 * plutôt que d'un second analyseur.
 */

const LEGACY_SCOPE_GUARDS = Object.freeze([
  'attachAuthorizedMarkets',
  'attachAuthorizedMarketsForOperator',
  'requireMarketScope',
  'requireMarketScopeRole',
]);

const LEGACY_SCOPE_RE = new RegExp(`\\b(${LEGACY_SCOPE_GUARDS.join('|')})\\b`, 'g');

function emptyGuards() {
  return { authn: false, roles: new Set(), admin: false, marketGuards: new Set() };
}

function tokens(s) {
  const out = emptyGuards();
  if (/\b(authenticate|softAuthenticate|requireInternalKey|authenticateOrCreateGuest)\b/.test(s)) out.authn = true;
  if (/\b(requireAdmin|requireAdminOrFounder)\b/.test(s)) { out.admin = true; out.authn = true; out.roles.add('admin'); }
  for (const r of s.matchAll(/requireRole\(\s*\[([^\]]*)\]/g)) {
    out.authn = true;
    r[1].split(',').forEach(x => { const v = x.trim().replace(/['"`]/g, ''); if (v) out.roles.add(v); });
  }
  for (const m of s.matchAll(LEGACY_SCOPE_RE)) out.marketGuards.add(m[1]);
  return out;
}

function hasGuards(t) {
  return Boolean(t && (t.authn || t.admin || t.roles.size || (t.marketGuards && t.marketGuards.size)));
}

function mergeInto(t, a) {
  t.authn = t.authn || a.authn;
  t.admin = t.admin || a.admin;
  a.roles.forEach(r => t.roles.add(r));
  if (!t.marketGuards) t.marketGuards = new Set();
  (a.marketGuards || []).forEach(g => t.marketGuards.add(g));
}

function cloneGuards(source) {
  return {
    authn: Boolean(source && source.authn),
    roles: new Set(source && source.roles ? source.roles : []),
    admin: Boolean(source && source.admin),
    marketGuards: new Set(source && source.marketGuards ? source.marketGuards : []),
  };
}

/**
 * Fonctions déclarées dans le fichier dont le corps appelle une garde de scope
 * marché (ex. `requireWorkspaceMarketAccess`). Une route qui les place dans sa
 * chaîne est protégée par la garde sans que celle-ci y figure en toutes lettres.
 * Seules les déclarations `function nom(...) { ... }` fermées en colonne 0 sont
 * reconnues ; un fichier qui utiliserait un autre style reste visible grâce au
 * test « tout fichier qui importe le middleware porte au moins une garde ».
 */
function wrapperAliases(src) {
  const aliases = {};
  for (const m of String(src).matchAll(/(?:async\s+)?function\s+(\w+)\s*\([^)]*\)\s*\{[\s\S]*?\n\}/g)) {
    const found = tokens(m[0]);
    if (!found.marketGuards.size) continue;
    aliases[m[1]] = { ...emptyGuards(), marketGuards: found.marketGuards };
  }
  return aliases;
}

module.exports = {
  LEGACY_SCOPE_GUARDS,
  cloneGuards,
  emptyGuards,
  hasGuards,
  mergeInto,
  tokens,
  wrapperAliases,
};

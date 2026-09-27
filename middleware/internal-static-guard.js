/**
 * @komerce-arch
 * @role          internal-static-path-guard
 * @domain        platform-ops
 * @layer         middleware
 * @criticality   high
 * @inputs        req.path
 * @outputs       next_or_404
 * @depends       none
 * @used-by       server.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      public_static_serves_app_assets_only
 * @impact-areas  security, boutique, dashboard
 * @version       2026-09
 *
 * GAP-F2 (docs/gaps/GAP_BOUTIQUE_FRONTEND_CORRECTIONS.md) — express.static
 * servait tout public/ sans exclusion : documentation interne (docs/),
 * suites de test (tests/), tooling de build (scripts/, governance/,
 * coverage/, test-results/), dotfiles (.cache-buster-state.json,
 * .stylelintrc.json…) et package.json/package-lock.json étaient
 * accessibles en production, sous public/boutique/, public/dashboards/
 * et à la racine de public/. Confirmé en production le 2026-09-23
 * (HTTP 200 sur plusieurs de ces chemins) avant correctif.
 *
 * manifest.json (PWA) reste explicitement servi malgré l'extension .json.
 */
'use strict';

const INTERNAL_STATIC_EXTENSIONS = /\.(md|txt)$/i;
const INTERNAL_STATIC_DIR_SEGMENTS = new Set([
  'tests', 'docs', 'scripts', 'governance', 'coverage', 'test-results',
]);
const INTERNAL_STATIC_FILENAMES = new Set(['package.json', 'package-lock.json']);

function isInternalStaticPath(reqPath) {
  const segments = String(reqPath || '').split('/').filter(Boolean);
  const filename = segments[segments.length - 1] || '';
  if (filename === 'manifest.json') return false;
  if (segments.some(seg => seg.startsWith('.'))) return true;
  if (segments.some(seg => INTERNAL_STATIC_DIR_SEGMENTS.has(seg))) return true;
  if (INTERNAL_STATIC_FILENAMES.has(filename)) return true;
  if (INTERNAL_STATIC_EXTENSIONS.test(filename)) return true;
  if (/^audit-.*\.json$/i.test(filename)) return true;
  return false;
}

function internalStaticGuard(req, res, next) {
  if ((req.method === 'GET' || req.method === 'HEAD') && isInternalStaticPath(req.path)) {
    return res.status(404).end();
  }
  next();
}

module.exports = { isInternalStaticPath, internalStaticGuard };

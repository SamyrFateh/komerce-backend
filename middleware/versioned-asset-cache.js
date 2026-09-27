/**
 * @komerce-arch
 * @role          versioned-asset-cache-headers
 * @domain        platform-ops
 * @layer         middleware
 * @criticality   medium
 * @inputs        req.query.v, req.path
 * @outputs       Cache-Control headers on express.static responses
 * @depends       none
 * @used-by       server.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      versioned_assets_cache_immutable, html_never_cached_long
 * @impact-areas  boutique, dashboard, performance
 * @version       2026-09
 *
 * GAP-F4 (docs/gaps/GAP_BOUTIQUE_FRONTEND_CORRECTIONS.md) — express.static
 * servait CSS/JS avec max-age=0 (défaut), donc revalidé à chaque visite,
 * alors que ces fichiers sont déjà versionnés par ?v=N (cache-buster,
 * public/boutique/.cache-buster-state.json) : un nouveau contenu change
 * TOUJOURS son ?v=, donc un ?v= donné peut être mis en cache indéfiniment
 * sans jamais servir de contenu périmé.
 *
 * express.static#setHeaders ne reçoit pas la requête (donc pas
 * req.query.v) — markVersionedRequest() la lit avant et la transmet par
 * res.locals ; buildStaticCacheHeaders() décide de l'en-tête à poser.
 *
 * Trouvé en vérifiant en conditions réelles : /boutique.html et toute
 * route SPA équivalente ne passent JAMAIS par express.static (aucun
 * fichier de ce nom n'existe sur disque — cf. bootstrap/html-routes.js,
 * catch-all app.get('*') qui sert boutique/index.html via sendHtml()).
 * Ce module ne couvre donc que les fichiers réellement servis par
 * express.static ; le catch-all a sa propre garantie no-cache via
 * sendHtml(), déjà correcte par défaut.
 */
'use strict';

function markVersionedRequest(req, res, next) {
  res.locals.hasVersionParam = typeof req.query.v !== 'undefined';
  next();
}

function buildStaticCacheHeaders(res, filePath, hasVersionParam) {
  if (filePath.endsWith('.html')) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    return;
  }
  if (hasVersionParam) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  }
}

function staticSetHeaders(res, filePath) {
  buildStaticCacheHeaders(res, filePath, Boolean(res.locals && res.locals.hasVersionParam));
}

module.exports = { markVersionedRequest, buildStaticCacheHeaders, staticSetHeaders };

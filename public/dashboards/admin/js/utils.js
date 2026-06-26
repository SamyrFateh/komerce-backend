/**
 * @komerce-arch
 * @role          admin-xss-escape-helpers
 * @domain        admin-dashboard
 * @layer         ui-renderer
 * @criticality   medium
 * @inputs        raw_strings (user-facing or API-sourced)
 * @outputs       escaped_html via esc(), escAttr(), safeError()
 * @depends       none
 * @used-by       all views in dashboards/admin/js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      none
 * @impact-areas  admin-dashboard (XSS prevention — must be loaded before any view)
 * @version       2026-06
 */

'use strict';
/**
 * KOMERCE — Helpers admin moderne (FRESH-104)
 *
 * Centralise les helpers d'échappement HTML pour éliminer les XSS dans
 * les views admin. Avant FRESH-104, plusieurs sites passaient ${err.message}
 * directement dans innerHTML — XSS si l'API renvoyait un message non sanitizé
 * (ex : message Postgres contenant des données utilisateur).
 *
 * Doctrine : aucun ${...} non échappé dans un innerHTML d'une view admin.
 *
 * Chargement : ce script DOIT être inclus dans index.html AVANT toute view
 * (entre api-client.js et la première view, ligne ~21).
 *
 *   <script src="/dashboards/admin/js/utils.js"></script>
 *
 * Expose 3 fonctions globales (window) :
 *   esc(str)          — text-safe pour innerHTML
 *   escAttr(str)      — attribute-safe (entre guillemets doubles)
 *   safeError(err)    — shortcut error-state HTML safe
 */

(function (global) {
  'use strict';

  function esc(s) {
    if (s === null || s === undefined) return '';
    const d = document.createElement('div');
    d.textContent = String(s);
    return d.innerHTML;
  }

  function escAttr(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function safeError(err, opts) {
    opts = opts || {};
    const className = opts.className || 'error-state';
    const icon      = opts.icon      || '❌';
    const msg = (err && err.message)
      ? err.message
      : (typeof err === 'string' ? err : 'Erreur inconnue');
    return '<div class="' + escAttr(className) + '">' + icon + ' ' + esc(msg) + '</div>';
  }

  // Exposition globale — toutes les views peuvent appeler esc() directement
  global.esc       = esc;
  global.escAttr   = escAttr;
  global.safeError = safeError;

})(window);

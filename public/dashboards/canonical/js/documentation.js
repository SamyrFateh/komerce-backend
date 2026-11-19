/**
 * @komerce-arch
 * @role          canonical-admin-product-documentation-interactions
 * @domain        admin-dashboard
 * @layer         ui-presentation
 * @criticality   low
 * @inputs        documentation_search, role_filter, print_action
 * @outputs       navigation_and_search_projection
 * @depends       none
 * @db-write      none
 * @db-read       none
 * @used-by       /admin/documentation
 * @doctrine      documentation_read_only, role_filter_never_grants_authority
 * @impact-areas  admin-dashboard
 * @version       2026-11
 */
/* Guide produit — recherche client uniquement, aucune API métier ni donnée privée. */
(function (global) {
  'use strict';
  var doc = global.document;
  if (!doc) return;
  function boot() {
    var input = doc.getElementById('doc-search');
    var selector = doc.getElementById('doc-role');
    var chapters = Array.prototype.slice.call(doc.querySelectorAll('.doc-chapter'));
    var links = Array.prototype.slice.call(doc.querySelectorAll('.doc-side nav a'));
    var count = doc.getElementById('doc-count');
    var empty = doc.getElementById('doc-empty');
    var printer = doc.getElementById('doc-print');
    if (!input || !selector || !chapters.length || !count) return;
    function normalize(value) {
      return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    }
    function acceptsRole(section, role) {
      var roles = String(section.getAttribute('data-roles') || '').split(/\s+/);
      return role === 'all' || roles.indexOf('all') !== -1 || roles.indexOf(role) !== -1;
    }
    function apply() {
      var term = normalize(input.value);
      var role = selector.value;
      var visible = 0;
      chapters.forEach(function (section) {
        var matches = acceptsRole(section, role) && (!term || normalize(section.textContent).indexOf(term) !== -1);
        section.hidden = !matches;
        if (matches) visible++;
      });
      links.forEach(function (link) {
        var target = doc.getElementById(decodeURIComponent((link.hash || '').slice(1)));
        link.hidden = !target || target.hidden;
      });
      count.textContent = visible + ' chapitre' + (visible > 1 ? 's' : '') + ' affiché' + (visible > 1 ? 's' : '');
      empty.hidden = visible !== 0;
    }
    selector.addEventListener('change', apply);
    input.addEventListener('input', apply);
    input.addEventListener('keydown', function (event) { if (event.key === 'Escape') { input.value = ''; apply(); } });
    if (printer) printer.addEventListener('click', function () { global.print(); });
    links.forEach(function (link) {
      link.addEventListener('click', function () {
        links.forEach(function (other) { other.removeAttribute('aria-current'); });
        link.setAttribute('aria-current', 'location');
      });
    });
    if (global.location.hash) {
      var fragment = decodeURIComponent(global.location.hash.slice(1));
      var targeted = doc.getElementById(fragment);
      if (targeted && !acceptsRole(targeted, selector.value)) selector.value = 'all';
    }
    apply();
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot, { once:true });
  else boot();
})(typeof window !== 'undefined' ? window : globalThis);

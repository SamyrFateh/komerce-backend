/**
 * @komerce-arch
 * @role          canonical-admin-finish-polish
 * @domain        admin-dashboard
 * @layer         ui-navigation
 * @criticality   low
 * @inputs        canonical_shell_dom
 * @outputs       accessible_compact_navigation, visible_active_navigation
 * @depends       public/dashboards/canonical/js/navigation-policy-v4.js
 * @used-by       canonical admin runtime, standalone market canonical pages
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      presentation_only_finish_layer
 * @impact-areas  admin-dashboard, navigation
 * @version       2026-09-v1
 */
'use strict';

(function initCanonicalFinishPolish(global) {
  function prefersReducedMotion() {
    return Boolean(global.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
  }

  function scrollBehavior() {
    return prefersReducedMotion() ? 'auto' : 'smooth';
  }

  function addCompactNavigationHints(doc) {
    const primaryLinks = doc.querySelectorAll?.('.kmc-admin-primary-link') || [];
    primaryLinks.forEach(link => {
      const label = String(link.querySelector?.('.kmc-admin-primary-label')?.textContent || link.textContent || '').trim();
      if (label && !link.getAttribute?.('title')) link.setAttribute?.('title', label);
    });

    const settings = doc.querySelector?.('.kmc-admin-settings-link');
    const logout = doc.querySelector?.('.kmc-admin-logout');
    [[settings, 'Paramètres'], [logout, 'Déconnexion']].forEach(([node, fallback]) => {
      if (!node) return;
      const label = String(node.textContent || fallback).trim() || fallback;
      if (!node.getAttribute?.('title')) node.setAttribute?.('title', label);
      if (!node.getAttribute?.('aria-label')) node.setAttribute?.('aria-label', label);
    });
  }

  function revealActiveNavigation(doc) {
    const behavior = scrollBehavior();
    const activePrimary = doc.querySelector?.('.kmc-admin-primary-link.is-active');
    const activeTab = doc.querySelector?.('.kmc-admin-domain-tab.is-active');

    activePrimary?.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior });
    activeTab?.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior });
  }

  function synchronize(doc) {
    if (!doc) return;
    addCompactNavigationHints(doc);
    const schedule = global.requestAnimationFrame
      ? callback => global.requestAnimationFrame(callback)
      : callback => queueMicrotask(callback);
    schedule(() => revealActiveNavigation(doc));
  }

  function start() {
    const doc = global.document;
    if (!doc?.body) return;
    if (doc.body.dataset.canonicalFinishPolish === 'v1') return;
    doc.body.dataset.canonicalFinishPolish = 'v1';

    synchronize(doc);
    global.addEventListener?.('popstate', () => synchronize(doc));
    global.addEventListener?.('hashchange', () => synchronize(doc));

    if (typeof global.MutationObserver !== 'function') return;
    let scheduled = false;
    const observer = new global.MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(() => {
        scheduled = false;
        synchronize(doc);
      });
    });
    observer.observe(doc.body, { childList: true, subtree: false });
  }

  if (global.document?.readyState === 'loading') {
    global.document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})(typeof window !== 'undefined' ? window : globalThis);

/**
 * @komerce-arch
 * @role          canonical-admin-client-router-v4
 * @domain        admin-dashboard
 * @layer         ui-navigation
 * @criticality   high
 * @inputs        canonical_admin_runtime, authenticated_user, canonical_navigation_v4, internal_admin_links
 * @outputs       atomic_in_document_navigation, functional_local_tabs, history_navigation
 * @depends       public/dashboards/canonical/js/app.js, public/dashboards/canonical/js/navigation-policy-v4.js
 * @used-by       canonical admin runtime
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      single_shell_sidebar_n1_horizontal_n2_local_n3, intra_canonical_navigation_must_not_full_reload
 * @impact-areas  admin-dashboard, navigation
 * @version       2026-09-v4.1
 */
'use strict';

(function initCanonicalClientRouter(global, factory) {
  const api = factory(global);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (global) global.KomerceCanonicalClientRouter = api;
})(typeof window !== 'undefined' ? window : globalThis, function createCanonicalClientRouter(global) {
  let started = false;
  let navigating = false;
  let navigationSeq = 0;
  let committedUrl = null;

  const CONTEXTLESS_SURFACES = new Set([
    'catalog-workspace',
    'sourcing-workspace',
    'action-center',
    'settings',
  ]);

  const PRICING_ANCHORS = Object.freeze({
    'pricing-products': 'Décision produit',
    'pricing-costs': 'Atelier des coûts',
    'pricing-strategy': 'Stratégie & concurrence',
  });

  function currentUrl() {
    try { return new URL(global.location.href); } catch (_) { return null; }
  }

  function canonicalPath(pathname) {
    const path = String(pathname || '');
    if (path === '/admin' || path === '/admin/' || path === '/admin/pilotage') return true;
    if (['/admin/commerce', '/admin/orders', '/admin/clients', '/admin/operations', '/admin/finance', '/admin/action-center', '/admin/demo', '/admin/settings'].includes(path)) return true;
    if (/^\/admin\/orders\/[^/]+$/.test(path)) return true;
    if (/^\/admin\/clients\/[^/]+$/.test(path)) return true;
    if (/^\/admin\/products\/[^/]+$/.test(path)) return true;
    if (/^\/admin\/workspaces\/(operations|shipping-customs|catalog|accounting|sourcing|pricing)$/.test(path)) return true;
    if (['/admin-next/pilotage', '/admin-next/commerce', '/admin-next/orders', '/admin-next/clients', '/admin-next/operations', '/admin-next/finance', '/admin-next/action-center', '/admin-next/demo'].includes(path)) return true;
    if (/^\/admin-next\/workspaces\/(operations|shipping-customs|catalog|accounting|sourcing|pricing)$/.test(path)) return true;
    return false;
  }

  function sameDocumentScope(fromUrl, toUrl) {
    if (!fromUrl || !toUrl) return false;
    return fromUrl.origin === toUrl.origin && canonicalPath(toUrl.pathname);
  }

  function sameRoute(fromUrl, toUrl) {
    return Boolean(fromUrl && toUrl
      && fromUrl.pathname === toUrl.pathname
      && fromUrl.search === toUrl.search);
  }

  function modifiedClick(event) {
    return event.defaultPrevented
      || event.button !== 0
      || event.metaKey
      || event.ctrlKey
      || event.shiftKey
      || event.altKey;
  }

  function eligibleAnchor(anchor, event) {
    if (!anchor || modifiedClick(event)) return false;
    if (anchor.target && anchor.target !== '_self') return false;
    if (anchor.hasAttribute?.('download')) return false;
    const href = anchor.getAttribute?.('href');
    if (!href || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')) return false;
    return true;
  }

  function rootNode(doc) {
    return doc.getElementById?.('canonical-admin-root') || null;
  }

  function ensurePricingAnchor(doc, anchorId) {
    if (!PRICING_ANCHORS[anchorId]) return null;
    const existing = doc.getElementById?.(anchorId);
    if (existing) return existing;
    const titles = Array.from(doc.querySelectorAll?.('.kmc-section-title') || []);
    const title = titles.find(node => String(node.textContent || '').trim() === PRICING_ANCHORS[anchorId]);
    const section = title?.closest?.('.kmc-section') || null;
    if (section && !section.id) section.id = anchorId;
    return section;
  }

  function ensureAnchor(doc, anchorId) {
    if (!anchorId) return rootNode(doc);
    return doc.getElementById?.(anchorId) || ensurePricingAnchor(doc, anchorId);
  }

  function scrollLocalTarget(doc, targetUrl) {
    const anchorId = String(targetUrl.hash || '').replace(/^#/, '');
    if (!anchorId) {
      rootNode(doc)?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
      return true;
    }
    const target = ensureAnchor(doc, anchorId);
    if (!target) return false;
    target.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
    return true;
  }

  function updateTabState(doc, surface) {
    const nav = global.KomerceCanonicalNavigation;
    if (!nav) return;
    const domain = typeof nav.activePrimarySurface === 'function'
      ? nav.activePrimarySurface(surface)
      : null;
    const activeTab = typeof nav._activeLocalTab === 'function'
      ? nav._activeLocalTab(domain, surface)
      : null;
    (doc.querySelectorAll?.('.kmc-admin-domain-tab') || []).forEach(link => {
      const active = link.dataset?.tab === activeTab;
      link.classList?.toggle('is-active', active);
      if (active) link.setAttribute?.('aria-current', 'page');
      else link.removeAttribute?.('aria-current');
    });
  }

  function updatePrimaryState(doc, surface) {
    const nav = global.KomerceCanonicalNavigation;
    if (!nav || typeof nav.activePrimarySurface !== 'function') return;
    const activeDomain = nav.activePrimarySurface(surface);
    (doc.querySelectorAll?.('.kmc-admin-primary-link') || []).forEach(link => {
      const active = link.dataset?.dashboard === activeDomain;
      link.classList?.toggle('is-active', active);
      if (active) link.setAttribute?.('aria-current', 'page');
      else link.removeAttribute?.('aria-current');
    });
  }

  function localNavigation(targetUrl, options = {}) {
    const doc = global.document;
    const app = global.KomerceCanonicalAdmin;
    if (!doc || !app) return false;
    const surface = app.surfaceForPath(targetUrl.pathname);
    if (options.history !== 'none') global.history.pushState({}, '', targetUrl.href);
    committedUrl = new URL(targetUrl.href);
    updateTabState(doc, surface);
    updatePrimaryState(doc, surface);
    queueMicrotask(() => scrollLocalTarget(doc, targetUrl));
    return true;
  }

  function requiresAdminContext(surface) {
    return !CONTEXTLESS_SURFACES.has(surface);
  }

  async function contextForSurface(app, surface) {
    if (!requiresAdminContext(surface)) return null;
    if (global.KOMERCE_CANONICAL_ADMIN_CONTEXT) return global.KOMERCE_CANONICAL_ADMIN_CONTEXT;
    return app.requireAdminContext();
  }

  function authorized(nav, user, surface) {
    if (!nav || typeof nav.visibleNavigationFor !== 'function' || typeof nav.activePrimarySurface !== 'function') return true;
    const domains = nav.visibleNavigationFor(user, global.KOMERCE_CANONICAL_ADMIN_CONTEXT);
    const domainId = nav.activePrimarySurface(surface);
    const domain = domains.find(row => row.id === domainId);
    if (!domain) return false;
    if (typeof nav.activeSpaceFor !== 'function' || typeof nav.visibleSpacesFor !== 'function') return true;
    const spaceId = nav.activeSpaceFor(surface);
    if (!spaceId) return true;
    return nav.visibleSpacesFor(domain, user?.role).some(space => space.id === spaceId);
  }

  function createStage(doc, oldRoot) {
    const stage = doc.createElement(oldRoot?.tagName?.toLowerCase?.() || 'main');
    stage.id = 'canonical-admin-root';
    stage.className = oldRoot?.className || '';
    stage.setAttribute('aria-live', oldRoot?.getAttribute?.('aria-live') || 'polite');
    stage.dataset.clientRouteStage = '';
    return stage;
  }

  function remountChrome(doc, user, adminContext, surface, pathname) {
    const nav = global.KomerceCanonicalNavigation;
    if (!nav || typeof nav.mount !== 'function') return;

    doc.getElementById?.('canonical-admin-topbar')?.remove?.();
    doc.getElementById?.('canonical-admin-domain-tabs')?.remove?.();
    doc.getElementById?.('canonical-admin-navigation')?.remove?.();
    nav.mount({
      document: doc,
      user,
      adminContext,
      surface,
      pathname,
    });
    updatePrimaryState(doc, surface);
    updateTabState(doc, surface);
  }

  function commitStage(doc, oldRoot, stage, user, adminContext, surface, targetUrl) {
    if (surface !== 'catalog-workspace') doc.body?.classList?.remove('kmc-catalog-live-mode');
    stage.removeAttribute('data-client-route-stage');
    oldRoot.replaceWith(stage);
    global.KOMERCE_CANONICAL_ADMIN_CONTEXT = adminContext;
    remountChrome(doc, user, adminContext, surface, targetUrl.pathname);
    const anchorId = String(targetUrl.hash || '').replace(/^#/, '');
    if (anchorId) queueMicrotask(() => scrollLocalTarget(doc, targetUrl));
    else global.scrollTo?.({ top: 0, left: 0, behavior: 'auto' });
  }

  async function navigate(target, options = {}) {
    const doc = global.document;
    const app = global.KomerceCanonicalAdmin;
    const nav = global.KomerceCanonicalNavigation;
    if (!doc || !app || navigating) return false;

    const targetUrl = target instanceof URL ? target : new URL(String(target), global.location.href);
    const fromUrl = committedUrl || currentUrl();
    if (!sameDocumentScope(fromUrl, targetUrl)) return false;

    if (sameRoute(fromUrl, targetUrl)) {
      if (fromUrl.href === targetUrl.href && options.history !== 'none') return true;
      return localNavigation(targetUrl, options);
    }

    const user = global.KOMERCE_CANONICAL_AUTH_USER || global.KOMERCE_AUTH_USER || null;
    const surface = app.surfaceForPath(targetUrl.pathname);
    if (!authorized(nav, user, surface)) return false;

    const oldRoot = rootNode(doc);
    if (!oldRoot) return false;

    navigating = true;
    const seq = ++navigationSeq;
    const oldUrl = fromUrl ? new URL(fromUrl.href) : currentUrl();
    doc.body?.setAttribute?.('data-canonical-route-pending', 'true');

    try {
      const adminContext = await contextForSurface(app, surface);
      if (seq !== navigationSeq) return false;

      if (options.history !== 'none') global.history.pushState({}, '', targetUrl.href);
      else if (global.location.href !== targetUrl.href) global.history.replaceState({}, '', targetUrl.href);

      const stage = createStage(doc, oldRoot);
      await app.renderReady(stage, user, adminContext);
      if (seq !== navigationSeq) return false;

      commitStage(doc, oldRoot, stage, user, adminContext, surface, targetUrl);
      committedUrl = new URL(targetUrl.href);
      return true;
    } catch (error) {
      if (oldUrl) global.history.replaceState({}, '', oldUrl.href);
      console.error('[canonical-admin] client navigation failed', error);
      return false;
    } finally {
      navigating = false;
      doc.body?.removeAttribute?.('data-canonical-route-pending');
    }
  }

  function onClick(event) {
    const anchor = event.target?.closest?.('a[href]');
    if (!eligibleAnchor(anchor, event)) return;
    let targetUrl;
    try { targetUrl = new URL(anchor.href, global.location.href); } catch (_) { return; }
    const fromUrl = committedUrl || currentUrl();
    if (!sameDocumentScope(fromUrl, targetUrl)) return;
    event.preventDefault();
    navigate(targetUrl).catch(error => console.error('[canonical-admin] navigation click failed', error));
  }

  function onPopState() {
    const targetUrl = currentUrl();
    if (!targetUrl || !canonicalPath(targetUrl.pathname)) return;
    navigate(targetUrl, { history: 'none' }).catch(error => console.error('[canonical-admin] history navigation failed', error));
  }

  function start() {
    if (started || !global.document) return;
    started = true;
    committedUrl = currentUrl();
    global.document.addEventListener('click', onClick, true);
    global.addEventListener?.('popstate', onPopState);
  }

  if (global.document?.readyState === 'loading') {
    global.document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }

  return Object.freeze({
    start,
    navigate,
    canonicalPath,
    sameRoute,
    sameDocumentScope,
    ensureAnchor,
    _localNavigation: localNavigation,
  });
});

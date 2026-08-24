/**
 * @komerce-arch
 * @role          canonical-admin-entrypoint
 * @domain        admin-dashboard
 * @layer         ui-entrypoint
 * @criticality   medium
 * @inputs        user_session, server_resolved_admin_context, url_path, requested_market_view
 * @outputs       canonical_admin_boot_state, canonical_market_selection
 * @depends       canonical admin-context, pilotage, commerce, operations, demo-order-flow
 * @used-by       /admin-next, /admin-next/commerce, /admin-next/operations, /admin/pilotage-v2
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      canonical_admin_no_legacy_imports, server_market_scope_is_authority
 * @impact-areas  admin-dashboard, market-authorization
 * @version       2026-08
 */

'use strict';

(function (global) {
  'use strict';

  const ALLOWED_ROLES = new Set(['admin', 'finance', 'sourcing', 'hub', 'relais', 'support']);
  const SURFACES = Object.freeze({
    PILOTAGE: 'pilotage',
    COMMERCE: 'commerce',
    OPERATIONS: 'operations',
    DEMO: 'demo',
  });

  function loginUrl() {
    const next = global.location.pathname + global.location.search + global.location.hash;
    return '/login.html?next=' + encodeURIComponent(next);
  }

  async function requireSession() {
    const response = await global.fetch('/api/auth/me', {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      global.location.replace(loginUrl());
      throw new Error('unauthorized');
    }

    const user = await response.json();
    if (!ALLOWED_ROLES.has(user.role)) {
      global.location.replace('/');
      throw new Error('forbidden');
    }

    return user;
  }

  async function requireAdminContext() {
    const response = await global.fetch('/api/admin/dashboard/context', {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });

    if (response.status === 401) {
      global.location.replace(loginUrl());
      throw new Error('unauthorized');
    }
    if (!response.ok) {
      if (response.status === 403) global.location.replace('/');
      throw new Error(response.status === 403 ? 'forbidden' : 'admin_context_unavailable');
    }

    if (!global.KomerceAdminContext || typeof global.KomerceAdminContext.validateAdminContext !== 'function') {
      throw new Error('canonical_admin_context_contract_missing');
    }

    const rawContext = await response.json();
    return global.KomerceAdminContext.validateAdminContext(rawContext);
  }

  function surfaceForPath(pathname) {
    if (pathname === '/admin-next/demo') return SURFACES.DEMO;
    if (pathname === '/admin-next/commerce') return SURFACES.COMMERCE;
    if (pathname === '/admin-next/operations') return SURFACES.OPERATIONS;
    return SURFACES.PILOTAGE;
  }

  function marketDisplayName(code) {
    try {
      if (global.Intl && typeof global.Intl.DisplayNames === 'function') {
        const displayNames = new global.Intl.DisplayNames(['fr'], { type: 'region' });
        const name = displayNames.of(code);
        if (name && name !== code) return `${code} · ${name}`;
      }
    } catch (_) {
      // Le code ISO reste une représentation stable si Intl.DisplayNames est indisponible.
    }
    return code;
  }

  function marketChoices(adminContext) {
    const access = adminContext && adminContext.access;
    if (!access || !Array.isArray(access.allowedMarkets)) {
      throw new Error('canonical_market_selector_context_missing');
    }

    const choices = [];
    if (access.mode === 'global') {
      choices.push(Object.freeze({ value: '', marketCode: null, label: 'Global · Tous les marchés' }));
    }
    access.allowedMarkets.forEach(code => {
      choices.push(Object.freeze({ value: code, marketCode: code, label: marketDisplayName(code) }));
    });
    return Object.freeze(choices);
  }

  function initialRequestedMarket(adminContext, contextContract) {
    if (!contextContract || typeof contextContract.resolveMarketView !== 'function') {
      throw new Error('canonical_market_selector_contract_missing');
    }
    return contextContract.resolveMarketView(adminContext).marketCode;
  }

  function textNode(doc, tagName, className, value) {
    const node = doc.createElement(tagName);
    if (className) node.className = className;
    node.textContent = value;
    return node;
  }

  function scopeDescription(marketCode) {
    return marketCode === null
      ? 'Consolidé Komerce · tous les marchés actifs autorisés'
      : `Données chargées côté serveur pour ${marketDisplayName(marketCode)}`;
  }

  function mountMarketSelector(options) {
    const doc = options.document;
    const container = options.container;
    const adminContext = options.adminContext;
    const contextContract = options.contextContract;
    const onChange = options.onChange;

    if (!doc || typeof doc.createElement !== 'function') throw new Error('canonical_market_selector_document_missing');
    if (!container || typeof container.appendChild !== 'function') throw new Error('canonical_market_selector_container_missing');
    if (typeof onChange !== 'function') throw new Error('canonical_market_selector_onchange_missing');

    const initialMarket = initialRequestedMarket(adminContext, contextContract);
    const choices = marketChoices(adminContext);
    let selectedMarket = initialMarket;

    const bar = doc.createElement('section');
    bar.className = 'kmc-market-context';
    bar.setAttribute('aria-label', 'Périmètre de données');

    const copy = doc.createElement('div');
    copy.className = 'kmc-market-context-copy';
    copy.appendChild(textNode(doc, 'span', 'kmc-market-context-kicker', 'PÉRIMÈTRE'));
    copy.appendChild(textNode(doc, 'strong', 'kmc-market-context-title', options.title || 'Vue de pilotage'));
    const description = textNode(doc, 'span', 'kmc-market-context-description', scopeDescription(initialMarket));
    copy.appendChild(description);

    const field = doc.createElement('label');
    field.className = 'kmc-market-context-field';
    field.appendChild(textNode(doc, 'span', 'kmc-market-context-label', 'Marché'));

    const select = doc.createElement('select');
    select.className = 'kmc-market-context-select';
    select.setAttribute('aria-label', 'Sélectionner le périmètre marché');

    choices.forEach(choice => {
      const option = doc.createElement('option');
      option.value = choice.value;
      option.textContent = choice.label;
      select.appendChild(option);
    });
    select.value = initialMarket || '';

    select.addEventListener('change', async () => {
      const previousMarket = selectedMarket;
      let resolved;
      try {
        const requestedMarket = select.value || null;
        resolved = contextContract.resolveMarketView(adminContext, requestedMarket);
      } catch (error) {
        select.value = previousMarket || '';
        console.error('[canonical-admin] market selection rejected', error);
        return;
      }

      select.disabled = true;
      try {
        await onChange(resolved.marketCode);
        selectedMarket = resolved.marketCode;
        description.textContent = scopeDescription(selectedMarket);
      } catch (error) {
        select.value = previousMarket || '';
        console.error('[canonical-admin] market reload failed', error);
      } finally {
        select.disabled = false;
      }
    });

    field.appendChild(select);
    bar.appendChild(copy);
    bar.appendChild(field);
    container.appendChild(bar);

    return Object.freeze({
      element: bar,
      select,
      initialMarket,
      choices,
    });
  }

  function canonicalMount(moduleApi, errorCode, root, user, adminContext, requestedMarket) {
    if (!moduleApi) throw new Error(errorCode);
    return moduleApi.mount({
      root,
      user,
      adminContext,
      requestedMarket,
      contextContract: global.KomerceAdminContext,
      document: global.document,
      fetch: global.fetch.bind(global),
      renderer: global.KomerceDashboardRenderer,
      ui: global.KomerceCanonicalUI,
    });
  }

  function renderPilotage(root, user, adminContext, requestedMarket) {
    return canonicalMount(global.KomerceCanonicalPilotage, 'canonical_pilotage_module_missing', root, user, adminContext, requestedMarket);
  }

  function renderCommerce(root, user, adminContext, requestedMarket) {
    return canonicalMount(global.KomerceCanonicalCommerce, 'canonical_commerce_module_missing', root, user, adminContext, requestedMarket);
  }

  function renderOperations(root, user, adminContext, requestedMarket) {
    return canonicalMount(global.KomerceCanonicalOperations, 'canonical_operations_module_missing', root, user, adminContext, requestedMarket);
  }

  function renderMarketSurfaceShell(root, user, adminContext, options) {
    if (!root || typeof root.replaceChildren !== 'function' || typeof root.appendChild !== 'function') {
      throw new Error('canonical_admin_shell_root_missing');
    }
    if (!options || typeof options.render !== 'function' || !options.surface) {
      throw new Error('canonical_admin_shell_surface_missing');
    }

    root.className = 'kmc-admin-shell';
    root.replaceChildren();

    const surface = global.document.createElement('div');
    surface.setAttribute('data-canonical-surface', options.surface);

    const selector = mountMarketSelector({
      document: global.document,
      container: root,
      adminContext,
      contextContract: global.KomerceAdminContext,
      title: options.title,
      onChange: requestedMarket => options.render(surface, user, adminContext, requestedMarket),
    });

    root.appendChild(surface);
    return options.render(surface, user, adminContext, selector.initialMarket);
  }

  function renderPilotageShell(root, user, adminContext) {
    return renderMarketSurfaceShell(root, user, adminContext, {
      surface: 'pilotage',
      title: 'Vue de pilotage',
      render: renderPilotage,
    });
  }

  function renderCommerceShell(root, user, adminContext) {
    return renderMarketSurfaceShell(root, user, adminContext, {
      surface: 'commerce',
      title: 'Vue Commerce',
      render: renderCommerce,
    });
  }

  function renderOperationsShell(root, user, adminContext) {
    return renderMarketSurfaceShell(root, user, adminContext, {
      surface: 'operations',
      title: 'Vue Opérations',
      render: renderOperations,
    });
  }

  function renderDemo(root, user) {
    if (!global.KomerceDemoOrderFlow) throw new Error('demo_order_flow_module_missing');
    return global.KomerceDemoOrderFlow.mount({
      root,
      user,
      document: global.document,
      fetch: global.fetch.bind(global),
    });
  }

  function renderReady(root, user, adminContext) {
    const surface = surfaceForPath(global.location.pathname);
    if (surface === SURFACES.DEMO) return renderDemo(root, user);
    if (surface === SURFACES.COMMERCE) return renderCommerceShell(root, user, adminContext);
    if (surface === SURFACES.OPERATIONS) return renderOperationsShell(root, user, adminContext);
    return renderPilotageShell(root, user, adminContext);
  }

  async function boot() {
    const root = document.getElementById('canonical-admin-root');
    if (!root) throw new Error('canonical_admin_root_missing');

    const user = await requireSession();
    const adminContext = await requireAdminContext();
    global.KOMERCE_CANONICAL_AUTH_USER = user;
    global.KOMERCE_CANONICAL_ADMIN_CONTEXT = adminContext;
    await renderReady(root, user, adminContext);
    return user;
  }

  global.KomerceCanonicalAdmin = {
    SURFACES,
    boot,
    requireSession,
    requireAdminContext,
    surfaceForPath,
    marketDisplayName,
    marketChoices,
    initialRequestedMarket,
    mountMarketSelector,
    renderPilotage,
    renderCommerce,
    renderOperations,
    renderMarketSurfaceShell,
    renderPilotageShell,
    renderCommerceShell,
    renderOperationsShell,
    renderDemo,
    renderReady,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      boot().catch(err => {
        if (err.message !== 'unauthorized' && err.message !== 'forbidden') {
          console.error('[canonical-admin] bootstrap failed', err);
        }
      });
    }, { once: true });
  } else {
    boot().catch(err => {
      if (err.message !== 'unauthorized' && err.message !== 'forbidden') {
        console.error('[canonical-admin] bootstrap failed', err);
      }
    });
  }
})(window);

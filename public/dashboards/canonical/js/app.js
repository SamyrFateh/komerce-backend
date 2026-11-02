/**
 * @komerce-arch
 * @role          canonical-admin-entrypoint
 * @domain        admin-dashboard
 * @layer         ui-entrypoint
 * @criticality   medium
 * @inputs        user_session, server_resolved_admin_context, url_path, requested_market_view
 * @outputs       canonical_admin_boot_state, canonical_market_selection
 * @depends       canonical admin-context, pilotage, commerce, operations, finance, operations-workspace, shipping-customs-workspace, catalog-workspace, finance-accounting-workspace, sourcing-workspace, purchasing-workspace, pricing-workspace, action-center, order-360, client-index, client-360, product-360, supplier-360, demo-order-flow
 * @used-by       /admin, /admin/pilotage, /admin/commerce, /admin/operations, /admin/finance, /admin/workspaces/operations, /admin/workspaces/shipping-customs, /admin/workspaces/catalog, /admin/workspaces/accounting, /admin/workspaces/sourcing, /admin/workspaces/purchasing, /admin/workspaces/pricing, /admin/action-center, /admin/orders/:reference, /admin/clients, /admin/clients/:phone, /admin/products/:productRef, /admin/demo, /admin-next aliases
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

  const ALLOWED_ROLES = new Set(['admin', 'market_operator', 'finance', 'sourcing', 'agent_hub', 'agent_relais', 'agent_transitaire', 'support']);
  const SURFACES = Object.freeze({
    PILOTAGE: 'pilotage',
    COMMERCE: 'commerce',
    ORDERS: 'orders',
    OPERATIONS: 'operations',
    FINANCE: 'finance',
    OPERATIONS_WORKSPACE: 'operations-workspace',
    SHIPPING_CUSTOMS_WORKSPACE: 'shipping-customs-workspace',
    CATALOG_WORKSPACE: 'catalog-workspace',
    ACCOUNTING_WORKSPACE: 'accounting-workspace',
    SOURCING_WORKSPACE: 'sourcing-workspace',
    PURCHASING_WORKSPACE: 'purchasing-workspace',
    IMPORT_RUNTIME: 'import-runtime',
    HUB_LIVE: 'hub-live',
    RELAIS_LIVE: 'relais-live',
    PRICING_WORKSPACE: 'pricing-workspace',
    ACTION_CENTER: 'action-center',
    ORDER_360: 'order-360',
    CLIENT_INDEX: 'client-index',
    CLIENT_360: 'client-360',
    PRODUCT_360: 'product-360',
    SUPPLIER_360: 'supplier-360',
    DEMO: 'demo',
    SETTINGS: 'settings',
    PROVIDERS_ADMIN: 'providers-admin',
    USERS_ADMIN: 'users-admin',
  });

  // Encadré « À quoi sert cet écran ? » — mots simples, une seule source.
  // Texte volontairement court et sans jargon ; uniquement ce qui est vérifié dans le code.
  // Une surface absente de cette table n'affiche pas d'encadré (pas de texte inventé).
  const SCREEN_PURPOSE = Object.freeze({
    [SURFACES.PILOTAGE]: 'Cet écran montre en un coup d’œil si l’activité va bien : ventes encaissées, commandes en cours, alertes. Il indique aussi quoi regarder en premier.',
    [SURFACES.ORDERS]: 'Cet écran liste les commandes qui attendent une action : paiement à confirmer, colis à créer, commandes à suivre ou bloquées.',
    [SURFACES.COMMERCE]: 'Cet écran montre ce qui se vend, combien ça rapporte, et à quelle étape des commandes se perdent.',
    [SURFACES.OPERATIONS]: 'Cet écran suit les commandes en route : celles qui avancent, celles qui sont en retard et celles qui sont bloquées.',
    [SURFACES.FINANCE]: 'Cet écran montre où en est l’argent : ce qui est encaissé, ce que ça a coûté et ce qu’il reste en marge. Un chiffre « estimé » n’est pas un chiffre « réel ».',
    [SURFACES.OPERATIONS_WORKSPACE]: 'Le travail du Hub et des Relais : les colis à recevoir, à préparer et à remettre aux clients.',
    [SURFACES.SHIPPING_CUSTOMS_WORKSPACE]: 'Le suivi des envois et de la douane : quels colis voyagent et lesquels attendent d’être dédouanés.',
    [SURFACES.CATALOG_WORKSPACE]: 'Ici, on choisit les produits qui entrent au catalogue et ceux à corriger. Un produit sans prix reste en brouillon : les clients ne le voient pas.',
    [SURFACES.ACCOUNTING_WORKSPACE]: 'Le suivi de l’argent liquide et des paiements : ce qui est encaissé, ce qui est déposé, et ce qu’il reste à vérifier.',
    [SURFACES.SOURCING_WORKSPACE]: 'Ici, on choisit parmi les produits trouvés chez les fournisseurs ceux à envoyer au catalogue.',
    [SURFACES.PURCHASING_WORKSPACE]: 'Les achats faits aux fournisseurs : ce qui est commandé, payé et expédié.',
    [SURFACES.IMPORT_RUNTIME]: 'Le suivi en direct des produits qui arrivent des fournisseurs : où en est chaque lot et ce qui le bloque.',
    [SURFACES.HUB_LIVE]: 'L’écran de travail du Hub, en direct : les colis attendus, reçus et à traiter.',
    [SURFACES.RELAIS_LIVE]: 'L’écran de travail du Relais, en direct : les colis arrivés et ceux à remettre aux clients.',
    [SURFACES.PRICING_WORKSPACE]: 'Ici, on fixe les prix de vente. Un bon prix couvre ce que le produit coûte et laisse une marge. Tant qu’un coût réel n’existe pas, on utilise un coût estimé, indiqué comme tel.',
    [SURFACES.ACTION_CENTER]: 'La liste de ce qui demande une action maintenant. Chaque ligne dit qui doit agir et pourquoi.',
    [SURFACES.ORDER_360]: 'Tout sur une commande au même endroit : le client, le paiement, le colis et les étapes déjà faites.',
    [SURFACES.CLIENT_INDEX]: 'La liste des clients, pour retrouver quelqu’un vite et ouvrir sa fiche.',
    [SURFACES.CLIENT_360]: 'La fiche d’un client : ses commandes et son historique.',
    [SURFACES.USERS_ADMIN]: 'Qui a accès à Komerce, et avec quel rôle.',
  });

  // Ancre : uniquement là où la mise en page est connue et testée (canon de layout).
  //  - dashboards à hiérarchie : bloc « attention » (le CSS lui donne `order: 25`, entre attention et primary) ;
  //  - Action Center : bande de métriques.
  // Ailleurs : pas d'encadré, plutôt que de risquer de décaler le hero (la topbar est superposée au hero).
  function purposeAnchor(root) {
    if (!root || typeof root.querySelector !== 'function') return null;
    const attention = root.querySelector('[data-dashboard-role="attention"]');
    const holder = attention && attention.parentNode;
    if (holder && typeof holder.getAttribute === 'function' && holder.getAttribute('data-dashboard-hierarchy')) return attention;
    return root.querySelector('.kmc-action-center > .kmc-metric-strip');
  }

  function mountPurposeBox(root, surface) {
    const text = SCREEN_PURPOSE[surface];
    const anchor = text ? purposeAnchor(root) : null;
    const doc = root && root.ownerDocument;
    if (!anchor || !doc || typeof doc.createElement !== 'function' || !anchor.parentNode
      || typeof anchor.parentNode.insertBefore !== 'function') return null;
    if (typeof root.querySelectorAll === 'function') {
      root.querySelectorAll('.kmc-purpose-box').forEach(old => { if (old.parentNode) old.parentNode.removeChild(old); });
    }
    const box = doc.createElement('details');
    box.className = 'kmc-purpose-box';
    box.open = false; // replié par défaut : l’aide ne pousse pas le contenu métier sous la ligne de flottaison
    box.setAttribute('data-purpose-surface', surface);
    const title = doc.createElement('summary');
    title.textContent = 'À quoi sert cet écran ?';
    const body = doc.createElement('p');
    body.textContent = text;
    box.appendChild(title);
    box.appendChild(body);
    anchor.parentNode.insertBefore(box, anchor.nextSibling);
    return box;
  }

  // Les écrans se rendent de façon asynchrone et peuvent effacer la racine (changement de marché) :
  // on (ré)insère l'encadré dès que l'ancre existe, sans jamais boucler (no-op s'il est déjà en place).
  function watchPurposeBox(root, surface) {
    if (!SCREEN_PURPOSE[surface]) return;
    const ensure = () => {
      const anchor = purposeAnchor(root);
      if (!anchor) return;
      const next = anchor.nextSibling;
      if (next && next.className === 'kmc-purpose-box' && next.getAttribute('data-purpose-surface') === surface) return;
      mountPurposeBox(root, surface);
    };
    ensure();
    if (typeof global.MutationObserver !== 'function' || !root || typeof root.nodeType !== 'number') return;
    let queued = false;
    new global.MutationObserver(() => {
      if (queued) return;
      queued = true;
      Promise.resolve().then(() => { queued = false; ensure(); });
    }).observe(root, { childList: true, subtree: true });
  }

  // Landing par défaut par rôle — voir docs/admin-nav-capability-map.md.
  // Chaque rôle atterrit sur le premier onglet qu'il peut réellement charger
  // côté serveur ; aujourd'hui seuls admin et market_operator ont des
  // onglets primaires au-delà de Dashboard.
  // Landing par défaut par rôle — voir docs/admin-nav-capability-map.md §9.
  // Chaque rôle atterrit directement sur son onglet primaire pertinent,
  // pas sur un Dashboard générique qui ne reflète pas son métier.
  const ROLE_DEFAULT_LANDING = Object.freeze({
    admin:              '/admin/pilotage',
    market_operator:    '/admin/pilotage',
    finance:            '/admin/workspaces/accounting',
    sourcing:           '/admin/import-runtime',
    agent_hub:          '/admin/hub-live',
    agent_relais:       '/admin/relais-live',
    agent_transitaire:  '/admin/workspaces/shipping-customs',
    support:            '/admin/pilotage',
  });

  function defaultLandingSurface(user) {
    const role = (user && user.role) || '';
    return ROLE_DEFAULT_LANDING[role] || '/admin/pilotage';
  }

  function loginUrl() {
    const next = global.location.pathname + global.location.search + global.location.hash;
    return '/login.html?next=' + encodeURIComponent(next);
  }

  async function resolveDelegatedPortalUser(user) {
    if (!user || ALLOWED_ROLES.has(user.role)) return user || null;

    try {
      const response = await global.fetch('/api/admin/dashboard/context', {
        method: 'GET',
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) return null;

      const context = await response.json();
      const access = context && context.access;
      if (!context || !context.actor || context.actor.role !== 'market_operator') return null;
      if (!access || access.mode !== 'market' || !Array.isArray(access.allowedMarkets) || !access.allowedMarkets.length) return null;

      return {
        ...user,
        persisted_role: user.role,
        role: 'market_operator',
        role_source: 'market_delegation_context',
      };
    } catch (_) {
      return null;
    }
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
    const effectiveUser = await resolveDelegatedPortalUser(user);
    if (!effectiveUser) {
      global.location.replace('/');
      throw new Error('forbidden');
    }

    return effectiveUser;
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
    const path = String(pathname || '');
    if (path === '/admin/orders' || path === '/admin-next/orders') return SURFACES.ORDERS;
    if (/^\/admin\/orders\/[^/]+$/.test(path)) return SURFACES.ORDER_360;
    if (path === '/admin/clients' || path === '/admin-next/clients') return SURFACES.CLIENT_INDEX;
    if (/^\/admin\/clients\/[^/]+$/.test(path)) return SURFACES.CLIENT_360;
    if (/^\/admin\/products\/[^/]+$/.test(path)) return SURFACES.PRODUCT_360;
    if (/^\/admin\/suppliers\/[^/]+$/.test(path)) return SURFACES.SUPPLIER_360;
    if (path === '/admin/workspaces/operations' || path === '/admin-next/workspaces/operations') {
      return SURFACES.OPERATIONS_WORKSPACE;
    }
    if (path === '/admin/workspaces/shipping-customs' || path === '/admin-next/workspaces/shipping-customs') {
      return SURFACES.SHIPPING_CUSTOMS_WORKSPACE;
    }
    if (path === '/admin/workspaces/catalog' || path === '/admin-next/workspaces/catalog') {
      return SURFACES.CATALOG_WORKSPACE;
    }
    if (path === '/admin/workspaces/accounting' || path === '/admin-next/workspaces/accounting') {
      return SURFACES.ACCOUNTING_WORKSPACE;
    }
    if (path === '/admin/workspaces/sourcing' || path === '/admin-next/workspaces/sourcing') {
      return SURFACES.SOURCING_WORKSPACE;
    }
    if (path === '/admin/workspaces/purchasing') return SURFACES.PURCHASING_WORKSPACE;
    if (path === '/admin/import-runtime') return SURFACES.IMPORT_RUNTIME;
    if (path === '/admin/hub-live') return SURFACES.HUB_LIVE;
    if (path === '/admin/relais-live') return SURFACES.RELAIS_LIVE;
    if (path === '/admin/workspaces/pricing' || path === '/admin-next/workspaces/pricing') {
      return SURFACES.PRICING_WORKSPACE;
    }
    if (path === '/admin/action-center' || path === '/admin-next/action-center') {
      return SURFACES.ACTION_CENTER;
    }
    if (path === '/admin/demo' || path === '/admin-next/demo') return SURFACES.DEMO;
    if (path === '/admin/settings') return SURFACES.SETTINGS;
    if (path === '/admin/providers') return SURFACES.PROVIDERS_ADMIN;
    if (path === '/admin/users') return SURFACES.USERS_ADMIN;
    if (path === '/admin/commerce' || path === '/admin-next/commerce') return SURFACES.COMMERCE;
    if (path === '/admin/operations' || path === '/admin-next/operations') return SURFACES.OPERATIONS;
    if (path === '/admin/finance' || path === '/admin-next/finance') return SURFACES.FINANCE;
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

  // Convertit un code ISO 3166-1 alpha-2 en emoji drapeau via les Regional
  // Indicator Symbols (U+1F1E6..U+1F1FF, un par lettre A-Z). Fonctionne pour
  // tout code à 2 lettres sans table de correspondance à maintenir.
  function regionFlagEmoji(code) {
    const normalized = String(code || '').trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(normalized)) return '';
    const base = 0x1f1e6;
    const codePoints = [...normalized].map(letter => base + (letter.charCodeAt(0) - 65));
    return String.fromCodePoint(...codePoints);
  }

  function marketChoices(adminContext, options = {}) {
    const access = adminContext && adminContext.access;
    if (!access || !Array.isArray(access.allowedMarkets)) {
      throw new Error('canonical_market_selector_context_missing');
    }

    const choices = [];
    if (access.mode === 'global' && !options.requireMarket) {
      choices.push(Object.freeze({ value: '', marketCode: null, label: 'Global · Tous les marchés' }));
    }
    if (options.requireMarket && options.withPlaceholder) {
      choices.push(Object.freeze({ value: '', marketCode: null, label: 'Choisir un marché…', placeholder: true }));
    }
    access.allowedMarkets.forEach(code => {
      const flag = regionFlagEmoji(code);
      const label = flag ? `${flag} ${marketDisplayName(code)}` : marketDisplayName(code);
      choices.push(Object.freeze({ value: code, marketCode: code, label }));
    });
    return Object.freeze(choices);
  }

  function explicitMarketState(adminContext, contextContract) {
    if (!contextContract || typeof contextContract.resolveExplicitMarket !== 'function') {
      throw new Error('canonical_market_selector_contract_missing');
    }
    return contextContract.resolveExplicitMarket(adminContext, String(global.location?.search || ''));
  }

  function initialRequestedMarket(adminContext, contextContract, options = {}) {
    if (!contextContract || typeof contextContract.resolveMarketView !== 'function') {
      throw new Error('canonical_market_selector_contract_missing');
    }

    if (options.requireMarket) {
      // L1 : aucun repli implicite. Marché retenu seulement s'il est explicite (?market= autorisé)
      // ou si la délégation est mono-marché ; sinon null (invite « Choisir un marché »).
      const explicit = explicitMarketState(adminContext, contextContract);
      return explicit.marketCode
        ? contextContract.resolveMarketView(adminContext, explicit.marketCode).marketCode
        : null;
    }

    // Contexte transporté par l'URL (?market=) : retenu seulement s'il fait partie des marchés autorisés par le serveur.
    try {
      const requested = String(new URLSearchParams(String(global.location?.search || '')).get('market') || '').toUpperCase();
      const allowed = adminContext && adminContext.access && adminContext.access.allowedMarkets;
      if (requested && Array.isArray(allowed) && allowed.includes(requested)) {
        return contextContract.resolveMarketView(adminContext, requested).marketCode;
      }
    } catch (_) { /* repli sur le défaut serveur */ }

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

    const initialMarket = initialRequestedMarket(adminContext, contextContract, {
      requireMarket: Boolean(options.requireMarket),
    });
    const choices = marketChoices(adminContext, {
      requireMarket: Boolean(options.requireMarket),
      withPlaceholder: Boolean(options.requireMarket) && !initialMarket,
    });
    let selectedMarket = initialMarket;
    let placeholderOption = null;

    const bar = doc.createElement('section');
    bar.className = 'kmc-market-context';
    bar.setAttribute('aria-label', 'Périmètre de données');

    const copy = doc.createElement('div');
    copy.className = 'kmc-market-context-copy';
    copy.appendChild(textNode(doc, 'span', 'kmc-market-context-kicker', options.requireMarket ? 'CONTEXTE D’ACTION' : 'PÉRIMÈTRE'));
    copy.appendChild(textNode(doc, 'strong', 'kmc-market-context-title', options.title || 'Vue de pilotage'));
    const description = textNode(doc, 'span', 'kmc-market-context-description',
      options.requireMarket && !initialMarket ? 'Aucun marché sélectionné' : scopeDescription(initialMarket));
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
      if (choice.placeholder) placeholderOption = option;
      select.appendChild(option);
    });
    select.value = initialMarket || '';

    select.addEventListener('change', async () => {
      const previousMarket = selectedMarket;
      let resolved;
      try {
        const requestedMarket = select.value || null;
        if (options.requireMarket && !requestedMarket) throw new Error('canonical_workspace_market_required');
        resolved = contextContract.resolveMarketView(adminContext, requestedMarket);
      } catch (error) {
        select.value = previousMarket || '';
        console.error('[canonical-admin] market selection rejected', error);
        return;
      }

      select.disabled = true;
      try {
        await onChange(resolved.marketCode);
        if (global.KomerceCanonicalNavigation && typeof global.KomerceCanonicalNavigation.syncContext === 'function') {
          global.KomerceCanonicalNavigation.syncContext({ market: resolved.marketCode });
        }
        selectedMarket = resolved.marketCode;
        description.textContent = scopeDescription(selectedMarket);
        if (placeholderOption && typeof select.removeChild === 'function') {
          select.removeChild(placeholderOption);
          placeholderOption = null;
        }
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

  function renderOrders(root, user, adminContext, requestedMarket) {
    return canonicalMount(global.KomerceCanonicalOrders, 'canonical_orders_module_missing', root, user, adminContext, requestedMarket);
  }

  function renderOperations(root, user, adminContext, requestedMarket) {
    return canonicalMount(global.KomerceCanonicalOperations, 'canonical_operations_module_missing', root, user, adminContext, requestedMarket);
  }

  function renderFinance(root, user, adminContext, requestedMarket) {
    return canonicalMount(global.KomerceCanonicalFinance, 'canonical_finance_module_missing', root, user, adminContext, requestedMarket);
  }

  function renderOperationsWorkspace(root, user, adminContext, requestedMarket) {
    return canonicalMount(
      global.KomerceCanonicalOperationsWorkspace,
      'canonical_operations_workspace_module_missing',
      root,
      user,
      adminContext,
      requestedMarket
    );
  }

  // Hub live · Exécution : même module d'exécution canonique que le Workspace, restreint aux actions Hub.
  function renderHubExecution(root, user, adminContext, requestedMarket) {
    const moduleApi = global.KomerceCanonicalOperationsWorkspace;
    if (!moduleApi) throw new Error('canonical_operations_workspace_module_missing');
    return moduleApi.mount({
      root,
      user,
      adminContext,
      requestedMarket,
      mode: 'execution',
      contextContract: global.KomerceAdminContext,
      document: global.document,
      fetch: global.fetch.bind(global),
      renderer: global.KomerceDashboardRenderer,
      ui: global.KomerceCanonicalUI,
    });
  }

  function isHubExecutionRequest() {
    return new URLSearchParams(String(global.location?.search || '')).get('view') === 'execute';
  }

  function renderHubExecutionShell(root, user, adminContext) {
    return renderMarketSurfaceShell(root, user, adminContext, {
      surface: 'hub-live-execution',
      title: 'Hub live · Exécution',
      requireMarket: true,
      render: renderHubExecution,
    });
  }

  function renderShippingCustomsWorkspace(root, user, adminContext, requestedMarket) {
    return canonicalMount(
      global.KomerceCanonicalShippingCustomsWorkspace,
      'canonical_shipping_customs_workspace_module_missing',
      root,
      user,
      adminContext,
      requestedMarket
    );
  }

  function renderFinanceAccountingWorkspace(root, user, adminContext, requestedMarket) {
    return canonicalMount(
      global.KomerceCanonicalFinanceJournalWorkspace || global.KomerceCanonicalFinanceAccountingWorkspace,
      'canonical_accounting_workspace_module_missing',
      root,
      user,
      adminContext,
      requestedMarket
    );
  }
  function renderCatalogWorkspace(root, user, adminContext) {
    if (!global.KomerceCanonicalCatalogWorkspace) throw new Error('canonical_catalog_workspace_module_missing');
    return global.KomerceCanonicalCatalogWorkspace.mount({
      root,
      user,
      adminContext,
      document: global.document,
      fetch: global.fetch.bind(global),
      ui: global.KomerceCanonicalUI,
    });
  }

  function renderSourcingWorkspace(root, user) {
    if (!global.KomerceCanonicalSourcingWorkspace) throw new Error('canonical_sourcing_workspace_module_missing');
    return global.KomerceCanonicalSourcingWorkspace.mount({
      root,
      user,
      document: global.document,
      fetch: global.fetch.bind(global),
      ui: global.KomerceCanonicalUI,
    });
  }

  function renderPurchasingWorkspace(root, user) {
    if (!global.KomerceCanonicalPurchasingWorkspace) throw new Error('canonical_purchasing_workspace_module_missing');
    return global.KomerceCanonicalPurchasingWorkspace.mount({
      root,
      user,
      document: global.document,
      fetch: global.fetch.bind(global),
      ui: global.KomerceCanonicalUI,
    });
  }

  function renderImportRuntime(root, user) {
    if (!global.KomerceCanonicalImportRuntime) throw new Error('canonical_import_runtime_module_missing');
    return global.KomerceCanonicalImportRuntime.mount({
      root,
      user,
      document: global.document,
      fetch: global.fetch.bind(global),
    });
  }

  function renderHubLive(root, user, adminContext) {
    if (isHubExecutionRequest()) return renderHubExecutionShell(root, user, adminContext);
    if (!global.KomerceCanonicalHubLive) throw new Error('canonical_hub_live_module_missing');
    return global.KomerceCanonicalHubLive.mount({ root, user, document: global.document, fetch: global.fetch.bind(global) });
  }

  // Relais live · Exécution : même module d'exécution canonique, restreint aux actions Relais.
  function renderRelayExecution(root, user, adminContext, requestedMarket) {
    const moduleApi = global.KomerceCanonicalOperationsWorkspace;
    if (!moduleApi) throw new Error('canonical_operations_workspace_module_missing');
    return moduleApi.mount({
      root, user, adminContext, requestedMarket, mode: 'relay-execution',
      contextContract: global.KomerceAdminContext, document: global.document, fetch: global.fetch.bind(global),
      renderer: global.KomerceDashboardRenderer, ui: global.KomerceCanonicalUI,
    });
  }

  function renderRelayLive(root, user, adminContext) {
    if (isHubExecutionRequest()) {
      return renderMarketSurfaceShell(root, user, adminContext, {
        surface: 'relais-live-execution',
        title: 'Relais live · Exécution',
        requireMarket: true,
        render: renderRelayExecution,
      });
    }
    if (!global.KomerceCanonicalRelayLive) throw new Error('canonical_relay_live_module_missing');
    return global.KomerceCanonicalRelayLive.mount({ root, user, document: global.document, fetch: global.fetch.bind(global) });
  }

  function renderPricingWorkspace(root, user, adminContext, requestedMarket) {
    return canonicalMount(
      global.KomerceCanonicalPricingWorkspace,
      'canonical_pricing_workspace_module_missing',
      root,
      user,
      adminContext,
      requestedMarket
    );
  }

  function renderActionCenter(root, user) {
    if (!global.KomerceCanonicalActionCenter) throw new Error('canonical_action_center_module_missing');
    return global.KomerceCanonicalActionCenter.mount({
      root,
      user,
      document: global.document,
      fetch: global.fetch.bind(global),
      ui: global.KomerceCanonicalUI,
    });
  }

  function renderOrder360(root, user) {
    if (!global.KomerceCanonicalOrder360) throw new Error('canonical_order_360_module_missing');
    return global.KomerceCanonicalOrder360.mount({
      root,
      user,
      pathname: global.location.pathname,
      document: global.document,
      fetch: global.fetch.bind(global),
      ui: global.KomerceCanonicalUI,
    });
  }

  function renderClientIndex(root, user, adminContext, requestedMarket) {
    if (!global.KomerceCanonicalClientIndex) throw new Error('canonical_client_index_module_missing');
    return global.KomerceCanonicalClientIndex.mount({
      root,
      user,
      adminContext,
      requestedMarket,
      contextContract: global.KomerceAdminContext,
      document: global.document,
      fetch: global.fetch.bind(global),
      ui: global.KomerceCanonicalUI,
    });
  }

  function renderClient360(root, user, adminContext) {
    if (!global.KomerceCanonicalClient360) throw new Error('canonical_client_360_module_missing');
    return global.KomerceCanonicalClient360.mount({
      root,
      user,
      adminContext,
      contextContract: global.KomerceAdminContext,
      pathname: global.location.pathname,
      document: global.document,
      fetch: global.fetch.bind(global),
      ui: global.KomerceCanonicalUI,
    });
  }

  function renderProduct360(root, user, adminContext) {
    if (!global.KomerceCanonicalProduct360) throw new Error('canonical_product_360_module_missing');
    return global.KomerceCanonicalProduct360.mount({
      root,
      user,
      adminContext: adminContext || null,
      pathname: global.location.pathname,
      document: global.document,
      fetch: global.fetch.bind(global),
      ui: global.KomerceCanonicalUI,
    });
  }

  function renderSupplier360(root, user) {
    if (!global.KomerceCanonicalSupplier360) throw new Error('canonical_supplier_360_module_missing');
    return global.KomerceCanonicalSupplier360.mount({
      root,
      user,
      pathname: global.location.pathname,
      document: global.document,
      fetch: global.fetch.bind(global),
      ui: global.KomerceCanonicalUI,
    });
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

    let promptShown = false;
    const renderCurrent = requestedMarket => {
      if (promptShown) { surface.replaceChildren(); promptShown = false; }
      return options.render(surface, user, adminContext, requestedMarket);
    };
    const renderAtomically = async requestedMarket => {
      // Pricing garde l'Atelier courant visible pendant que le marché suivant
      // se construit hors DOM. Le swap n'arrive qu'après un rendu réussi :
      // aucun flash du workspace historique, aucun écran blanc en cas d'échec.
      const stage = global.document.createElement('div');
      stage.className = 'kmc-market-surface-stage';
      stage.dataset.marketSurfaceStage = '';
      await options.render(stage, user, adminContext, requestedMarket);
      surface.replaceChildren(stage);
      promptShown = false;
      return stage;
    };

    const selector = mountMarketSelector({
      document: global.document,
      container: root,
      adminContext,
      contextContract: global.KomerceAdminContext,
      title: options.title,
      requireMarket: Boolean(options.requireMarket),
      onChange: requestedMarket => options.atomicSwap
        ? renderAtomically(requestedMarket)
        : renderCurrent(requestedMarket),
    });

    root.appendChild(surface);
    if (options.requireMarket && !selector.initialMarket) {
      // L1 : aucune surface marché montée, donc aucune requête /market/ avant le choix.
      const explicit = explicitMarketState(adminContext, global.KomerceAdminContext);
      promptShown = true;
      if (global.KomerceMarketPrompt) {
        global.KomerceMarketPrompt.render(global.document, surface, {
          state: explicit.state,
          requested: explicit.requested,
        });
      }
      return Promise.resolve(null);
    }
    return renderCurrent(selector.initialMarket);
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

  function renderOrdersShell(root, user, adminContext) {
    return renderMarketSurfaceShell(root, user, adminContext, {
      surface: 'orders',
      title: 'Commandes',
      render: renderOrders,
    });
  }

  function renderClientIndexShell(root, user, adminContext) {
    return renderMarketSurfaceShell(root, user, adminContext, {
      surface: 'client-index',
      title: 'Clients visibles',
      render: renderClientIndex,
    });
  }

  function renderOperationsShell(root, user, adminContext) {
    return renderMarketSurfaceShell(root, user, adminContext, {
      surface: 'operations',
      title: 'Vue Opérations',
      render: renderOperations,
    });
  }

  function renderFinanceShell(root, user, adminContext) {
    return renderMarketSurfaceShell(root, user, adminContext, {
      surface: 'finance',
      title: 'Vue Finance',
      render: renderFinance,
    });
  }

  // L'ancien écran Hub & Relais est retiré : l'URL redirige vers l'exécution Hub live / Relais live.
  function operationsWorkspaceTarget(user) {
    const role = (user && user.role) || '';
    const base = role === 'agent_relais' ? '/admin/relais-live' : '/admin/hub-live';
    const market = new URLSearchParams(String(global.location?.search || '')).get('market');
    return base + '?view=execute' + (market ? '&market=' + encodeURIComponent(market) : '');
  }

  function renderOperationsWorkspaceShell(root, user, adminContext) {
    if (global.location && typeof global.location.replace === 'function') {
      global.location.replace(operationsWorkspaceTarget(user));
      return undefined;
    }
    return renderMarketSurfaceShell(root, user, adminContext, {
      surface: 'operations-workspace',
      title: 'Workspace Operations / Hub-Relais',
      requireMarket: true,
      render: renderOperationsWorkspace,
    });
  }

  function renderShippingCustomsWorkspaceShell(root, user, adminContext) {
    return renderMarketSurfaceShell(root, user, adminContext, {
      surface: 'shipping-customs-workspace',
      title: 'Workspace Expéditions & Douane',
      requireMarket: true,
      render: renderShippingCustomsWorkspace,
    });
  }

  function renderFinanceAccountingWorkspaceShell(root, user, adminContext) {
    return renderMarketSurfaceShell(root, user, adminContext, {
      surface: 'accounting-workspace',
      title: 'Workspace Finance / Comptabilité',
      requireMarket: true,
      render: renderFinanceAccountingWorkspace,
    });
  }

  function renderPricingWorkspaceShell(root, user, adminContext) {
    return renderMarketSurfaceShell(root, user, adminContext, {
      surface: 'pricing-workspace',
      title: 'Workspace Pricing / Atelier des coûts',
      requireMarket: true,
      atomicSwap: true,
      render: renderPricingWorkspace,
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

  // Paramètres migré dans le shell Canonical : KomerceCanonicalSettingsWorkspace
  // (public/dashboards/canonical/js/settings-workspace.js) est un module
  // Canonical natif — fetch direct, zéro dépendance au shell Legacy.
  async function renderSettingsWorkspace(root) {
    root.innerHTML = '';
    if (!global.KomerceCanonicalSettingsWorkspace || typeof global.KomerceCanonicalSettingsWorkspace.render !== 'function') {
      root.innerHTML = '<p style="padding:40px;text-align:center;color:#dc2626">'
        + '❌ KomerceCanonicalSettingsWorkspace indisponible — script non chargé</p>';
      return;
    }
    await global.KomerceCanonicalSettingsWorkspace.render(root);
  }

  // Utilisateurs (Administration) : module Canonical natif, lecture seule.
  async function renderUsersAdmin(root) {
    root.innerHTML = '';
    if (!global.KomerceCanonicalUsersAdmin || typeof global.KomerceCanonicalUsersAdmin.render !== 'function') {
      root.textContent = 'KomerceCanonicalUsersAdmin indisponible — script non chargé';
      return;
    }
    await global.KomerceCanonicalUsersAdmin.render(root);
  }

  // Providers & certifications : module Canonical natif, lecture seule.
  async function renderProvidersAdmin(root) {
    root.innerHTML = '';
    if (!global.KomerceCanonicalProvidersAdmin || typeof global.KomerceCanonicalProvidersAdmin.render !== 'function') {
      root.textContent = 'KomerceCanonicalProvidersAdmin indisponible — script non chargé';
      return;
    }
    await global.KomerceCanonicalProvidersAdmin.render(root);
  }

  function renderReady(root, user, adminContext) {
    const surface = surfaceForPath(global.location.pathname);
    watchPurposeBox(root, surface);
    if (surface === SURFACES.SETTINGS) return renderSettingsWorkspace(root, user);
    if (surface === SURFACES.PROVIDERS_ADMIN) return renderProvidersAdmin(root);
    if (surface === SURFACES.USERS_ADMIN) return renderUsersAdmin(root);
    if (surface === SURFACES.ORDER_360) return renderOrder360(root, user);
    if (surface === SURFACES.CLIENT_INDEX) return renderClientIndexShell(root, user, adminContext);
    if (surface === SURFACES.CLIENT_360) return renderClient360(root, user, adminContext);
    if (surface === SURFACES.PRODUCT_360) return renderProduct360(root, user, adminContext);
    if (surface === SURFACES.SUPPLIER_360) return renderSupplier360(root, user);
    if (surface === SURFACES.OPERATIONS_WORKSPACE) return renderOperationsWorkspaceShell(root, user, adminContext);
    if (surface === SURFACES.SHIPPING_CUSTOMS_WORKSPACE) return renderShippingCustomsWorkspaceShell(root, user, adminContext);
    if (surface === SURFACES.CATALOG_WORKSPACE) return renderCatalogWorkspace(root, user, adminContext);
    if (surface === SURFACES.ACCOUNTING_WORKSPACE) return renderFinanceAccountingWorkspaceShell(root, user, adminContext);
    if (surface === SURFACES.SOURCING_WORKSPACE) return renderSourcingWorkspace(root, user);
    if (surface === SURFACES.PURCHASING_WORKSPACE) return renderPurchasingWorkspace(root, user);
    if (surface === SURFACES.IMPORT_RUNTIME) return renderImportRuntime(root, user);
    if (surface === SURFACES.HUB_LIVE) return renderHubLive(root, user, adminContext);
    if (surface === SURFACES.RELAIS_LIVE) return renderRelayLive(root, user, adminContext);
    if (surface === SURFACES.PRICING_WORKSPACE) return renderPricingWorkspaceShell(root, user, adminContext);
    if (surface === SURFACES.ACTION_CENTER) return renderActionCenter(root, user);
    if (surface === SURFACES.DEMO) return renderDemo(root, user);
    if (surface === SURFACES.COMMERCE) return renderCommerceShell(root, user, adminContext);
    if (surface === SURFACES.ORDERS) return renderOrdersShell(root, user, adminContext);
    if (surface === SURFACES.OPERATIONS) return renderOperationsShell(root, user, adminContext);
    if (surface === SURFACES.FINANCE) return renderFinanceShell(root, user, adminContext);
    return renderPilotageShell(root, user, adminContext);
  }

  async function boot() {
    const root = document.getElementById('canonical-admin-root');
    if (!root) throw new Error('canonical_admin_root_missing');
    const user = await requireSession();

    // `/admin` est l'unique porte d'entrée interne. Une session déjà ouverte
    // doit obtenir exactement la même landing métier qu'une session qui vient
    // de passer par /login.html, avant tout chargement d'un AdminContext qui
    // pourrait ne pas appartenir au rôle (Hub, Relais, Finance, etc.).
    const entryPath = String(global.location.pathname || '');
    if (entryPath === '/admin' || entryPath === '/admin/') {
      const landing = defaultLandingSurface(user);
      if (landing !== entryPath) {
        global.location.replace(landing);
        return user;
      }
    }

    const surface = surfaceForPath(global.location.pathname);
    // Ancien écran Hub & Relais retiré : l'URL historique mène à l'exécution Hub live / Relais live.
    if (surface === SURFACES.OPERATIONS_WORKSPACE) {
      global.location.replace(operationsWorkspaceTarget(user));
      return user;
    }
    const adminContext = (surface === SURFACES.CATALOG_WORKSPACE || surface === SURFACES.SOURCING_WORKSPACE || surface === SURFACES.PURCHASING_WORKSPACE || surface === SURFACES.IMPORT_RUNTIME || surface === SURFACES.ACTION_CENTER || surface === SURFACES.SETTINGS)
      ? null
      : await requireAdminContext();
    global.KOMERCE_CANONICAL_AUTH_USER = user;
    global.KOMERCE_CANONICAL_ADMIN_CONTEXT = adminContext;

    // La navigation se monte automatiquement sur DOMContentLoaded mais le
    // user n'est pas encore résolu à ce moment (session asynchrone). On la
    // remonte ici avec le user authentifié pour que le filtrage par rôle
    // (masquage des utilités admin-only pour market_operator) s'applique.
    if (global.KomerceCanonicalNavigation) {
      const navEl = global.document.getElementById('canonical-admin-navigation');
      if (navEl && navEl.parentNode) navEl.parentNode.removeChild(navEl);
      global.KomerceCanonicalNavigation.mount({ user, surface, adminContext });
    }

    // Landing intelligente : si la surface courante appartient à un domaine
    // N1 (docs/doctrine/ADMIN_NAVIGATION_DOCTRINE_V2.md) que ce rôle ne peut
    // pas voir, ou à un espace N2 non autorisé au sein d'un domaine par
    // ailleurs visible (ex. agent_relais sur Expéditions & Douane), on
    // redirige vers sa landing plutôt que de rendre une vue qui va 403.
    // Dashboard est toujours autorisé pour tout rôle connu de ALLOWED_ROLES,
    // donc la landing elle-même ne peut jamais redéclencher cette redirection.
    if (global.KomerceCanonicalNavigation
      && typeof global.KomerceCanonicalNavigation.visibleNavigationFor === 'function'
      && typeof global.KomerceCanonicalNavigation.activePrimarySurface === 'function') {
      const nav = global.KomerceCanonicalNavigation;
      const visibleDomains = nav.visibleNavigationFor(user, adminContext);
      const visibleDomainIds = visibleDomains.map(domain => domain.id);
      const activeDomainId = nav.activePrimarySurface(surface);
      let authorized = visibleDomainIds.includes(activeDomainId);

      if (authorized && typeof nav.activeSpaceFor === 'function' && typeof nav.visibleSpacesFor === 'function') {
        const activeSpaceId = nav.activeSpaceFor(surface);
        if (activeSpaceId) {
          const activeDomain = visibleDomains.find(domain => domain.id === activeDomainId);
          const visibleSpaceIds = nav.visibleSpacesFor(activeDomain, user && user.role).map(space => space.id);
          authorized = visibleSpaceIds.includes(activeSpaceId);
        }
      }

      if (!authorized) {
        const landing = defaultLandingSurface(user);
        global.location.replace(landing);
        return user;
      }
    }

    await renderReady(root, user, adminContext);
    return user;
  }

  global.KomerceCanonicalAdmin = {
    SURFACES,
    boot,
    requireSession,
    resolveDelegatedPortalUser,
    requireAdminContext,
    surfaceForPath,
    marketDisplayName,
    regionFlagEmoji,
    marketChoices,
    initialRequestedMarket,
    explicitMarketState,
    mountMarketSelector,
    renderPilotage,
    renderCommerce,
    renderOperations,
    renderFinance,
    renderOperationsWorkspace,
    renderShippingCustomsWorkspace,
    renderCatalogWorkspace,
    renderSourcingWorkspace,
    renderImportRuntime,
    renderHubLive,
    renderHubExecution,
    renderRelayLive,
    renderPricingWorkspace,
    renderActionCenter,
    renderFinanceAccountingWorkspace,
    renderOrder360,
    renderClientIndex,
    renderClient360,
    renderProduct360,
    renderMarketSurfaceShell,
    renderPilotageShell,
    renderCommerceShell,
    renderClientIndexShell,
    renderOperationsShell,
    renderFinanceShell,
    renderOperationsWorkspaceShell,
    operationsWorkspaceTarget,
    renderShippingCustomsWorkspaceShell,
    renderFinanceAccountingWorkspaceShell,
    renderPricingWorkspaceShell,
    renderDemo,
    renderReady,
    mountPurposeBox,
    watchPurposeBox,
    SCREEN_PURPOSE,
    ROLE_DEFAULT_LANDING,
    defaultLandingSurface,
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
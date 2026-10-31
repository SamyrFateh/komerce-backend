/**
 * @komerce-arch
 * @role          market-country-catalog-ui
 * @domain        admin-dashboard
 * @layer         ui-workspace
 * @criticality   high
 * @inputs        authenticated_user, server_admin_context, market_catalog_exposure
 * @outputs       market_scoped_catalog_configuration_ui, auditable_exposure_requests
 * @depends       /api/auth/me, /api/admin/dashboard/context, /api/market-delegation/markets/:marketCode/catalog/exposure, market-catalog-decision, market-ready-to-sell, decision-primitives
 * @used-by       /dashboards/canonical/market-catalog.html
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      catalog_global_truth_stays_central, market_operator_configures_market_exposure, client_market_id_never_authority, dashboard_no_business_recompute
 * @impact-areas  admin-dashboard, catalog, market-delegation
 * @version       2026-09
 */
'use strict';

(function bootMarketCatalog(global) {
  const root = global.document && global.document.getElementById('market-catalog-root');
  if (!root) return;

  function el(tag, className, value) {
    const node = global.document.createElement(tag);
    if (className) node.className = className;
    if (value != null) node.textContent = String(value);
    return node;
  }

  async function request(url, options = {}) {
    const response = await global.fetch(url, {
      method: options.method || 'GET',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(options.body == null ? {} : { 'Content-Type': 'application/json' }),
      },
      body: options.body == null ? undefined : JSON.stringify(options.body),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body.error || `HTTP ${response.status}`);
      error.status = response.status;
      error.code = body.code || null;
      throw error;
    }
    return body;
  }

  // L1 : aucun repli sur le premier marché autorisé (CG pour un admin global).
  function explicitMarket(context) {
    const contract = global.KomerceAdminContext;
    if (!contract || typeof contract.resolveExplicitMarket !== 'function') throw new Error('Contrat de contexte marché indisponible.');
    return contract.resolveExplicitMarket(context, global.location.search);
  }

  function marketFromContext(context) {
    return explicitMarket(context).marketCode;
  }

  // Cross-dashboard handoff: a product is not a market decision.
  // Keep it in the URL while requiring an explicit authorized market choice.
  function focusedRef() {
    return String(new URL(global.location.href).searchParams.get('product_ref') || '').trim();
  }

  function urlWithMarket(code) {
    const url = new URL(global.location.href);
    url.searchParams.set('market', String(code).toUpperCase());
    return url.toString();
  }

  function renderProductMarketChoice(explicit, permittedCodes = []) {
    const productRef = focusedRef();
    if (!productRef) return;
    const section = el('section', 'kmc-market-handoff kmc-market-handoff-chooser');
    section.dataset.marketHandoff = 'choose';
    section.appendChild(el('p', 'kmc-market-handoff-kicker', 'DÉCISION COMMERCIALE · PRODUIT CIBLÉ'));
    section.appendChild(el('h2', '', productRef));
    section.appendChild(el('p', 'kmc-market-handoff-note',
      'Ce produit vient du Catalogue global. Choisissez le marché sur lequel vous voulez examiner sa commercialisation. Aucun marché n’est choisi automatiquement.'));
    const allowed = Array.isArray(explicit.allowedMarkets) ? explicit.allowedMarkets : [];
    const permitted = new Set(permittedCodes);
    const choices = el('div', 'kmc-market-handoff-options');
    allowed.forEach(code => {
      if (permitted.has(code)) {
        const link = el('a', 'kmc-workspace-action is-secondary', 'Ouvrir ' + code);
        link.href = urlWithMarket(code);
        link.setAttribute('data-handoff-market', code);
        choices.appendChild(link);
      } else {
        const blocked = el('span', 'kmc-market-handoff-blocked', code + ' · accès Catalogue requis');
        blocked.setAttribute('data-market-inaccessible', code);
        choices.appendChild(blocked);
      }
    });
    section.appendChild(choices);
    if (allowed.length && !allowed.some(code => permitted.has(code))) {
      section.appendChild(el('p', 'kmc-market-handoff-error',
        'Aucune habilitation Catalogue pays active pour ce compte. Une appartenance active au marché et la capacité catalog.read sont nécessaires. Faites vérifier vos droits auprès de l’administrateur des marchés.'));
    } else if (!allowed.length) {
      section.appendChild(el('p', 'kmc-market-handoff-error',
        'Aucun marché autorisé : la décision ne peut pas être ouverte avec ce compte.'));
    }
    const back = el('a', 'kmc-market-handoff-back', '← Retour au Catalogue global');
    back.href = '/admin/workspaces/catalog?product_ref=' + encodeURIComponent(productRef);
    section.appendChild(back);
    root.appendChild(section);
  }

  function renderProductMarketFocus(payload, marketCode) {
    const productRef = focusedRef();
    if (!productRef) return;
    const section = el('section', 'kmc-market-handoff kmc-market-handoff-selected');
    section.dataset.marketHandoff = 'selected';
    section.appendChild(el('p', 'kmc-market-handoff-kicker', 'PRODUIT CIBLÉ · DÉCISION MARCHÉ'));
    section.appendChild(el('h2', '', productRef + ' · ' + marketCode));
    const readyRows = Array.isArray(payload.ready_to_sell?.items)
      ? payload.ready_to_sell.items : [];
    const exposureRows = Array.isArray(payload.exposure) ? payload.exposure : [];
    const readyRow = readyRows.find(row => row.product_ref === productRef);
    const exposureRow = exposureRows.find(row => row.product_ref === productRef && row.decision_recorded === true);
    const message = readyRow
      ? 'Ce produit est présent dans la file de décision ci-dessous. Les conditions et actions disponibles sont propres à ce marché.'
      : exposureRow
        ? 'Ce produit possède déjà une décision sur ce marché. Consultez la section des produits déjà décidés ci-dessous.'
        : 'Ce produit n’est pas actuellement dans la liste des produits prêts à vendre ni dans les décisions déjà enregistrées sur ce marché. Vérifiez les prérequis commerciaux, sans déduire un refus.';
    section.appendChild(el('p', 'kmc-market-handoff-note', message));
    const actions = el('div', 'kmc-market-handoff-options');
    if (readyRow) {
      const target = el('a', 'kmc-workspace-action', 'Voir sa ligne de décision');
      target.href = '#market-ready-to-sell';
      actions.appendChild(target);
    } else if (exposureRow) {
      const target = el('a', 'kmc-workspace-action', 'Voir la décision existante');
      target.href = '#market-ready-to-sell';
      actions.appendChild(target);
    }
    const marketPicker = el('a', 'kmc-workspace-action is-secondary', 'Changer de marché');
    const url = new URL(global.location.href);
    url.searchParams.delete('market');
    marketPicker.href = url.toString();
    actions.appendChild(marketPicker);
    const back = el('a', 'kmc-market-handoff-back', '← Retour au Catalogue global');
    back.href = '/admin/workspaces/catalog?product_ref=' + encodeURIComponent(productRef);
    actions.appendChild(back);
    section.appendChild(actions);
    root.appendChild(section);
  }

  function renderMarketPrompt(explicit, permittedCodes = []) {
    root.className = 'canonical-boot';
    root.replaceChildren();
    root.appendChild(el('p', 'canonical-eyebrow', 'KOMERCE · CATALOGUE PAYS'));
    root.appendChild(el('h1', '', 'Catalogue pays'));
    global.KomerceMarketPrompt.render(global.document, root, {
      state: explicit.state,
      requested: explicit.requested,
    });
    renderProductMarketChoice(explicit, permittedCodes);
  }

  function renderMarketAccessDenied(marketCode, explicit, permittedCodes = [], reason = '') {
    root.className = 'canonical-boot';
    root.replaceChildren();
    root.appendChild(el('p', 'canonical-eyebrow', 'KOMERCE · ACCÈS CATALOGUE PAYS'));
    root.appendChild(el('h1', '', 'Habilitation marché requise'));
    root.appendChild(el('p', 'kmc-market-handoff-error',
      marketCode + ' : votre compte ne détient pas actuellement la capacité catalog.read via une appartenance active au marché. ' +
      'L’accès global au back-office ne confère pas automatiquement les droits de Catalogue pays.'));
    if (reason) root.appendChild(el('p', 'kmc-market-handoff-note', reason));
    renderProductMarketChoice(explicit, permittedCodes);
  }

  async function catalogReadableCodes() {
    // Authentication + active membership + active ceiling tested by the server.
    // This discovery does NOT authorize an action; market routes still guard.
    const payload = await request('/api/market-delegation/catalog/authorized-markets');
    if (!Array.isArray(payload.market_codes)) {
      throw new Error('Impossible de vérifier les habilitations Catalogue pays.');
    }
    return payload.market_codes;
  }

  function formatDate(value) {
    const date = value ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' }).format(date);
  }

  function setFeedback(message, tone = '') {
    const target = root.querySelector('[data-catalog-feedback]');
    if (!target) return;
    target.className = `kmc-workspace-feedback${tone ? ` is-${tone}` : ''}`;
    target.textContent = message || '';
  }

  function refreshNavigation(user, context) {
    global.KOMERCE_AUTH_USER = user;
    global.KOMERCE_CANONICAL_AUTH_USER = user;
    global.KOMERCE_CANONICAL_ADMIN_CONTEXT = context;
    const nav = global.KomerceCanonicalNavigation;
    if (!nav || typeof nav.mount !== 'function') return;
    const existing = global.document.getElementById('canonical-admin-navigation');
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
    nav.mount({
      user,
      adminContext: context,
      surface: 'market-catalog',
      pathname: global.location.pathname,
    });
  }

  function renderHeader(payload, marketCode) {
    const header = el('header', 'kmc-workspace-header');
    const copy = el('div');
    copy.appendChild(el('span', 'kmc-workspace-kicker', 'CATALOGUE · PAYS'));
    copy.appendChild(el('h1', 'kmc-workspace-title', `${payload.market.name || marketCode} · Catalogue des prix`));
    copy.appendChild(el(
      'p',
      'kmc-workspace-subtitle',
      `${payload.market.currency || '—'} · choisissez les prix et gérez la publication des produits`
    ));
    header.appendChild(copy);

    const feedback = el('div', 'kmc-workspace-feedback', 'Prêt.');
    feedback.dataset.catalogFeedback = '';
    feedback.setAttribute('role', 'status');
    header.appendChild(feedback);
    root.appendChild(header);
    return header;
  }

  function renderMarketSelector(context, marketCode, header) {
    const allowed = context.access && Array.isArray(context.access.allowedMarkets)
      ? context.access.allowedMarkets
      : [];
    if (allowed.length <= 1 || !header) return null;

    const controls = el('div', 'kmc-market-catalog-hero-controls');
    const label = el('label', 'kmc-market-catalog-market-label', 'Marché');
    const select = global.document.createElement('select');
    select.className = 'kmc-workspace-input kmc-market-context-select';
    select.setAttribute('aria-label', 'Sélectionner le marché');
    allowed.forEach(code => {
      const option = global.document.createElement('option');
      option.value = code;
      option.textContent = code;
      option.selected = code === marketCode;
      select.appendChild(option);
    });
    select.addEventListener('change', () => {
      const url = new URL(global.location.href);
      url.searchParams.set('market', select.value);
      global.location.href = url.toString();
    });
    label.appendChild(select);
    controls.appendChild(label);
    header.appendChild(controls);
    return controls;
  }

  function renderDecisionOverview(payload) {
    const projection = global.KomerceMarketCatalogDecision;
    const decisionUi = global.KomerceDecisionUI;
    const ui = global.KomerceCanonicalUI;
    if (!projection || !decisionUi || !ui || !ui.MetricStrip) {
      throw new Error('market_catalog_decision_primitives_missing');
    }

    const decisions = projection.decisionItems(payload);
    if (decisions.length) {
      const decisionHost = el('div', 'kmc-cockpit-decisions kmc-dashboard-attention-band');
      decisionHost.setAttribute('data-dashboard-role', 'attention');
      decisionUi.DecisionStrip.render(decisionHost, { items: decisions });
      root.appendChild(decisionHost);
    }

    const section = el('section', 'kmc-decision-surface-card kmc-market-catalog-essential');
    section.setAttribute('data-market-catalog-overview', 'decision-first-v1');
    section.setAttribute('data-dashboard-role', 'primary');
    section.appendChild(el('h2', 'kmc-decision-dashboard-section-title', 'Catalogue du marché'));
    section.appendChild(el(
      'p',
      'kmc-decision-dashboard-section-copy',
      'Voir ce qui est visible, ce qui reste à décider et les références à relire.'
    ));

    const metricHost = el('div', 'kmc-workspace-metrics kmc-market-catalog-essential-metrics');
    ui.MetricStrip.render(metricHost, { items: projection.metricItems(payload) });
    section.appendChild(metricHost);

    const priorities = projection.priorityRows(payload);
    if (priorities.length) {
      section.appendChild(el('h3', 'kmc-market-catalog-priority-title', 'À arbitrer maintenant'));
      const priorityHost = el('div', 'kmc-market-catalog-essential-priorities');
      decisionUi.PriorityList.render(priorityHost, { items: priorities });
      section.appendChild(priorityHost);
    }

    root.appendChild(section);
  }

  function actionButton(label, tone, handler) {
    const button = el('button', `kmc-workspace-action${tone === 'secondary' ? ' is-secondary' : ''}`, label);
    button.type = 'button';
    button.addEventListener('click', handler);
    return button;
  }

  function renderReadyToSell(payload, marketCode) {
    const ready = global.KomerceMarketCatalogPricingList || global.KomerceMarketReadyToSell;
    if (!ready || typeof ready.render !== 'function') throw new Error('market_country_pricing_list_missing');
    const focusedProductRef = focusedRef();
    ready.render({
      root,
      payload,
      marketCode,
      focusedProductRef: String(focusedProductRef || '').trim() || null,
      request,
      feedback: setFeedback,
      reload: load,
    });
  }

  function renderExposure(payload, marketCode) {
    const projection = global.KomerceMarketCatalogDecision;
    if (!projection) throw new Error('market_catalog_decision_projection_missing');

    const section = el('section', 'kmc-section');
    section.id = 'market-catalog-exposure';
    section.appendChild(el('h2', 'kmc-section-title', 'Produits déjà décidés'));
    section.appendChild(el(
      'p',
      'kmc-workspace-note',
      'Les produits déjà décidés restent pilotables ici : exposer ou masquer ne modifie jamais leur fiche globale.'
    ));

    const rows = (Array.isArray(payload.exposure) ? payload.exposure : []).filter(row => row.decision_recorded === true);
    if (!rows.length) {
      section.appendChild(el('div', 'kmc-workspace-empty', 'Aucun produit actif dans le catalogue global.'));
      root.appendChild(section);
      return;
    }

    const canManage = Array.isArray(payload.actor_capabilities)
      && payload.actor_capabilities.includes('catalog.expose');
    const wrap = el('div', 'kmc-workspace-table-wrap');
    const table = el('table', 'kmc-workspace-table');
    table.innerHTML = '<thead><tr><th>Produit</th><th>Catégorie</th><th>SKU</th><th>État pays</th><th>Qualité</th><th>Décision</th><th>Action</th></tr></thead>';
    const tbody = global.document.createElement('tbody');

    async function applyExposure(row, next, button) {
      button.disabled = true;
      setFeedback(`${row.sku || row.product_ref || 'Produit'} · mise à jour…`);
      try {
        await request(
          `/api/market-delegation/markets/${encodeURIComponent(marketCode)}/catalog/exposure/${encodeURIComponent(row.product_id)}`,
          { method: 'PUT', body: { commercial_exposure: next } }
        );
        await load();
      } catch (error) {
        button.disabled = false;
        setFeedback(`${error.message}${error.code ? ` · ${error.code}` : ''}`, 'critical');
      }
    }

    rows.forEach(row => {
      const tr = global.document.createElement('tr');
      const product = el('td');
      product.appendChild(el('strong', '', row.product_name || row.product_ref || 'Produit'));
      product.appendChild(el('div', 'kmc-workspace-note', row.product_ref || '—'));
      tr.appendChild(product);
      tr.appendChild(el('td', '', [row.category, row.subcategory].filter(Boolean).join(' · ') || '—'));
      tr.appendChild(el('td', '', row.sku || '—'));

      const status = projection.exposureStatus(row);
      const statusCell = el('td');
      statusCell.appendChild(el('strong', '', status.label));
      tr.appendChild(statusCell);

      const quality = projection.qualityStatus(row);
      const qualityCell = el('td');
      qualityCell.appendChild(el('span', 'kmc-workspace-note', quality.label));
      tr.appendChild(qualityCell);
      tr.appendChild(el('td', '', row.decision_recorded === true ? formatDate(row.decided_at) : 'Aucune'));

      const actionCell = el('td');
      if (canManage) {
        if (row.decision_recorded !== true) {
          const expose = actionButton('Exposer', 'primary', event => applyExposure(row, 'ENABLED', event.currentTarget));
          const keepHidden = actionButton('Garder masqué', 'secondary', event => applyExposure(row, 'DISABLED', event.currentTarget));
          actionCell.appendChild(expose);
          actionCell.appendChild(keepHidden);
        } else if (row.commercial_exposure === 'ENABLED') {
          actionCell.appendChild(actionButton('Masquer', 'secondary', event => applyExposure(row, 'DISABLED', event.currentTarget)));
        } else {
          actionCell.appendChild(actionButton('Exposer', 'primary', event => applyExposure(row, 'ENABLED', event.currentTarget)));
        }
      } else {
        actionCell.appendChild(el('span', 'kmc-workspace-note', 'Lecture seule'));
      }
      tr.appendChild(actionCell);
      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    wrap.appendChild(table);
    section.appendChild(wrap);
    root.appendChild(section);
  }

  async function load() {
    try {
      const [user, context] = await Promise.all([
        request('/api/auth/me'),
        request('/api/admin/dashboard/context'),
      ]);
      const explicit = explicitMarket(context);
      // Only a focused cross-dashboard handoff needs the effective capability
      // inventory. Generic market pages preserve their existing behavior.
      const permittedCodes = focusedRef() ? await catalogReadableCodes() : null;
      if (!explicit.marketCode) {
        renderMarketPrompt(explicit, permittedCodes || []);
        refreshNavigation(user, context);
        return;
      }
      const marketCode = explicit.marketCode;
      if (permittedCodes && !permittedCodes.includes(marketCode)) {
        renderMarketAccessDenied(marketCode, explicit, permittedCodes);
        refreshNavigation(user, context);
        return;
      }
      const pricePage = new URL(global.location.href).searchParams.get('price_page') || '1';
      const payload = await request(`/api/market-delegation/markets/${encodeURIComponent(marketCode)}/catalog/exposure?price_page=${encodeURIComponent(pricePage)}`);

      root.className = 'kmc-workspace';
      root.setAttribute('data-workspace-kind', 'market-catalog');
      root.setAttribute('data-dashboard-hierarchy', 'hero-attention-primary-secondary');
      root.replaceChildren();
      refreshNavigation(user, context);
      const header = renderHeader(payload, marketCode);
      header.setAttribute('data-dashboard-role', 'hero');
      renderMarketSelector(context, marketCode, header);
      renderProductMarketFocus(payload, marketCode);
      // One principal surface: the market pricing catalogue owns both price
      // and exposure decisions. The old dashboard strips remain as safe fallback.
      if (!global.KomerceMarketCatalogPricingList) renderDecisionOverview(payload);
      renderReadyToSell(payload, marketCode);
      if (!global.KomerceMarketCatalogPricingList) renderExposure(payload, marketCode);
    } catch (error) {
      if (error.status === 401) {
        global.location.replace('/login.html?next=' + encodeURIComponent(global.location.pathname + global.location.search));
        return;
      }
      if (['MARKET_MEMBERSHIP_REQUIRED', 'MARKET_CAPABILITY_REQUIRED',
        'MARKET_CAPABILITY_OUTSIDE_CEILING'].includes(error.code)) {
        const marketCode = new URL(global.location.href).searchParams.get('market') || 'Marché';
        renderMarketAccessDenied(String(marketCode).toUpperCase(),
          { allowedMarkets: [] }, [], error.message);
        return;
      }
      root.className = 'canonical-boot';
      root.replaceChildren();
      root.appendChild(el('p', 'canonical-eyebrow', 'KOMERCE · CATALOGUE PAYS'));
      root.appendChild(el('h1', '', 'Catalogue indisponible'));
      root.appendChild(el('p', '', `${error.message}${error.code ? ` · ${error.code}` : ''}`));
    }
  }

  global.KomerceMarketCatalog = Object.freeze({ marketFromContext, load });
  load();
})(globalThis);

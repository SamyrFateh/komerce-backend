/**
 * @komerce-arch
 * @role          market-country-catalog-ui
 * @domain        admin-dashboard
 * @layer         ui-workspace
 * @criticality   high
 * @inputs        authenticated_user, server_admin_context, market_catalog_exposure
 * @outputs       market_scoped_catalog_configuration_ui, auditable_exposure_requests
 * @depends       /api/auth/me, /api/admin/dashboard/context, /api/market-delegation/markets/:marketCode/catalog/exposure, market-catalog-decision, decision-primitives
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

  function marketFromContext(context) {
    const access = context && context.access || {};
    const allowed = Array.isArray(access.allowedMarkets) ? access.allowedMarkets : [];
    const requested = new URL(global.location.href).searchParams.get('market');
    if (requested && allowed.includes(requested.toUpperCase())) return requested.toUpperCase();
    if (access.defaultMarket && allowed.includes(access.defaultMarket)) return access.defaultMarket;
    return allowed[0] || null;
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
    copy.appendChild(el('h1', 'kmc-workspace-title', `${payload.market.name || marketCode} · Choisir les produits du marché`));
    copy.appendChild(el(
      'p',
      'kmc-workspace-subtitle',
      `Market ID ${marketCode} · ${payload.market.currency || '—'} · choisissez les produits qui ont leur place sur ce marché`
    ));
    header.appendChild(copy);

    const nav = el('nav', 'kmc-workspace-nav');
    const pricing = el('a', 'kmc-workspace-nav-link', 'Atelier économique →');
    pricing.href = `/admin/workspaces/pricing?market=${encodeURIComponent(marketCode)}`;
    nav.appendChild(pricing);
    const buyer = el('a', 'kmc-workspace-nav-link', 'Voir la boutique →');
    buyer.href = `/?market=${encodeURIComponent(marketCode)}`;
    buyer.target = '_blank';
    nav.appendChild(buyer);
    header.appendChild(nav);

    const feedback = el('div', 'kmc-workspace-feedback', 'Prêt.');
    feedback.dataset.catalogFeedback = '';
    feedback.setAttribute('role', 'status');
    header.appendChild(feedback);
    root.appendChild(header);
  }

  function renderMarketSelector(context, marketCode) {
    const allowed = context.access && Array.isArray(context.access.allowedMarkets)
      ? context.access.allowedMarkets
      : [];
    if (allowed.length <= 1) return;

    // Conservé comme proxy technique pour le sélecteur transverse N1. Le
    // Visual Freeze masque ce bloc quand la navigation Canonical est montée.
    const section = el('section', 'kmc-section');
    section.appendChild(el('h2', 'kmc-section-title', 'Marché actif'));
    const select = global.document.createElement('select');
    select.className = 'kmc-workspace-input kmc-market-context-select';
    select.setAttribute('aria-label', 'Sélectionner le Market ID');
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
    section.appendChild(select);
    root.appendChild(section);
  }

  function renderDecisionOverview(payload) {
    const projection = global.KomerceMarketCatalogDecision;
    const decisionUi = global.KomerceDecisionUI;
    const ui = global.KomerceCanonicalUI;
    if (!projection || !decisionUi || !ui || !ui.MetricStrip) {
      throw new Error('market_catalog_decision_primitives_missing');
    }

    const section = el('section', 'kmc-decision-surface-card');
    section.setAttribute('data-market-catalog-overview', 'decision-first-v1');
    section.appendChild(el('h2', 'kmc-decision-dashboard-section-title', 'Produits à décider'));
    section.appendChild(el(
      'p',
      'kmc-decision-dashboard-section-copy',
      'Les nouveaux produits arrivent ici prêts à être examinés. Validez ceux qui conviennent à votre marché ; les autres restent masqués.'
    ));

    const decisions = projection.decisionItems(payload);
    if (decisions.length) {
      const decisionHost = el('div');
      decisionUi.DecisionStrip.render(decisionHost, { items: decisions });
      section.appendChild(decisionHost);
    }

    const metricHost = el('div');
    metricHost.className = 'kmc-workspace-metrics';
    ui.MetricStrip.render(metricHost, { items: projection.metricItems(payload) });
    section.appendChild(metricHost);
    root.appendChild(section);

    const priorities = projection.priorityRows(payload);
    if (priorities.length) {
      const prioritySection = el('section', 'kmc-decision-surface-card');
      prioritySection.appendChild(el('h2', 'kmc-decision-dashboard-section-title', 'À arbitrer maintenant'));
      prioritySection.appendChild(el(
        'p',
        'kmc-decision-dashboard-section-copy',
        'Références visibles à relire ou références encore sans décision pays.'
      ));
      const priorityHost = el('div');
      decisionUi.PriorityList.render(priorityHost, { items: priorities });
      prioritySection.appendChild(priorityHost);
      root.appendChild(prioritySection);
    }
  }

  function actionButton(label, tone, handler) {
    const button = el('button', `kmc-workspace-action${tone === 'secondary' ? ' is-secondary' : ''}`, label);
    button.type = 'button';
    button.addEventListener('click', handler);
    return button;
  }

  function renderIncomingProducts(payload, marketCode) {
    const section = el('section', 'kmc-section');
    section.id = 'market-catalog-review';
    section.appendChild(el('h2', 'kmc-section-title', 'Nouveaux produits'));
    section.appendChild(el(
      'p',
      'kmc-workspace-note',
      'Décidez uniquement si le produit a sa place sur votre marché. Les contrôles techniques ont déjà été faits en amont.'
    ));

    const queue = payload.review_queue || {};
    const rows = Array.isArray(queue.items) ? queue.items : [];
    const canManage = Array.isArray(payload.actor_capabilities)
      && payload.actor_capabilities.includes('catalog.expose');

    if (!rows.length) {
      section.appendChild(el('div', 'kmc-workspace-empty', 'Aucun nouveau produit à valider.'));
      root.appendChild(section);
      return;
    }

    const wrap = el('div', 'kmc-workspace-table-wrap');
    const table = el('table', 'kmc-workspace-table');
    table.innerHTML = '<thead><tr><th>Produit</th><th>Catégorie</th><th>Stock</th><th>Action</th></tr></thead>';
    const tbody = global.document.createElement('tbody');

    async function validate(row, button) {
      button.disabled = true;
      setFeedback(`${row.product_ref || 'Produit'} · validation pour ${marketCode}…`);
      try {
        await request(
          `/api/market-delegation/markets/${encodeURIComponent(marketCode)}/catalog/review/${encodeURIComponent(row.product_id)}/validate`,
          { method: 'POST', body: {} }
        );
        setFeedback(`${row.product_name || row.product_ref || 'Produit'} · validé pour ${marketCode}.`, 'positive');
        await load();
      } catch (error) {
        button.disabled = false;
        setFeedback(`${error.message}${error.code ? ` · ${error.code}` : ''}`, 'critical');
      }
    }

    async function decline(row, button) {
      button.disabled = true;
      setFeedback(`${row.product_ref || 'Produit'} · décision en cours…`);
      try {
        await request(
          `/api/market-delegation/markets/${encodeURIComponent(marketCode)}/catalog/exposure/${encodeURIComponent(row.product_id)}`,
          { method: 'PUT', body: { commercial_exposure: 'DISABLED' } }
        );
        setFeedback(`${row.product_name || row.product_ref || 'Produit'} · non retenu pour ${marketCode}.`);
        await load();
      } catch (error) {
        button.disabled = false;
        setFeedback(`${error.message}${error.code ? ` · ${error.code}` : ''}`, 'critical');
      }
    }

    rows.forEach(row => {
      const tr = global.document.createElement('tr');

      const product = el('td');
      const line = el('div', 'kmc-market-product-line');
      if (row.image_url) {
        const image = global.document.createElement('img');
        image.src = row.image_url;
        image.alt = row.product_name || 'Produit';
        image.loading = 'lazy';
        image.width = 56;
        image.height = 56;
        image.style.objectFit = 'cover';
        image.style.borderRadius = '10px';
        line.appendChild(image);
      }
      const copy = el('div');
      copy.appendChild(el('strong', '', row.product_name || row.product_ref || 'Produit'));
      copy.appendChild(el('div', 'kmc-workspace-note', row.product_ref || '—'));
      if (row.description) {
        copy.appendChild(el('div', 'kmc-workspace-note', String(row.description).slice(0, 140)));
      }
      line.appendChild(copy);
      product.appendChild(line);
      tr.appendChild(product);

      tr.appendChild(el('td', '', [row.category, row.subcategory].filter(Boolean).join(' · ') || '—'));
      tr.appendChild(el('td', '', row.stock == null ? 'Non précisé' : String(row.stock)));

      const actionCell = el('td');
      const detail = el('a', 'kmc-workspace-nav-link', 'Voir la fiche');
      detail.href = `/admin/products/${encodeURIComponent(row.product_ref)}`;
      detail.target = '_blank';
      actionCell.appendChild(detail);

      if (canManage) {
        actionCell.appendChild(actionButton(
          'Valider pour ce marché',
          'primary',
          event => validate(row, event.currentTarget)
        ));
        actionCell.appendChild(actionButton(
          'Ne pas retenir',
          'secondary',
          event => decline(row, event.currentTarget)
        ));
      } else {
        actionCell.appendChild(el('span', 'kmc-workspace-note', 'Lecture seule'));
      }
      tr.appendChild(actionCell);
      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    wrap.appendChild(table);
    section.appendChild(wrap);

    if (Number(queue.total) > rows.length) {
      section.appendChild(el(
        'p',
        'kmc-workspace-note',
        `${rows.length} affichés sur ${queue.total} produit(s) à valider. Les suivants apparaissent au fur et à mesure des décisions.`
      ));
    }

    root.appendChild(section);
  }

  function renderExposure(payload, marketCode) {
    const projection = global.KomerceMarketCatalogDecision;
    if (!projection) throw new Error('market_catalog_decision_projection_missing');

    const section = el('section', 'kmc-section');
    section.id = 'market-catalog-exposure';
    section.appendChild(el('h2', 'kmc-section-title', 'Produits déjà publiés'));
    section.appendChild(el(
      'p',
      'kmc-workspace-note',
      'Vous pouvez à tout moment rendre visible ou masquer un produit déjà publié sur ce marché.'
    ));

    const rows = Array.isArray(payload.exposure) ? payload.exposure : [];
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
      const marketCode = marketFromContext(context);
      if (!marketCode) throw new Error('Aucun marché autorisé pour ce compte.');
      const payload = await request(`/api/market-delegation/markets/${encodeURIComponent(marketCode)}/catalog/exposure`);

      root.className = 'kmc-workspace';
      root.replaceChildren();
      refreshNavigation(user, context);
      renderHeader(payload, marketCode);
      renderMarketSelector(context, marketCode);
      renderDecisionOverview(payload);
      renderIncomingProducts(payload, marketCode);
      renderExposure(payload, marketCode);
    } catch (error) {
      if (error.status === 401) {
        global.location.replace('/login.html?next=' + encodeURIComponent(global.location.pathname + global.location.search));
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

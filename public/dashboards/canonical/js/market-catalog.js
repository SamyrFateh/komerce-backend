/**
 * @komerce-arch
 * @role          market-country-catalog-ui
 * @domain        admin-dashboard
 * @layer         ui-workspace
 * @criticality   high
 * @inputs        authenticated_user, server_admin_context, market_catalog_exposure
 * @outputs       market_scoped_catalog_configuration_ui, auditable_exposure_requests
 * @depends       /api/auth/me, /api/admin/dashboard/context, /api/market-delegation/markets/:marketCode/catalog/exposure
 * @used-by       /dashboards/canonical/market-catalog.html
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      catalog_global_truth_stays_central, market_operator_configures_market_exposure, client_market_id_never_authority
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
    copy.appendChild(el('span', 'kmc-workspace-kicker', 'CATALOGUE · CONFIGURATION PAYS'));
    copy.appendChild(el('h1', 'kmc-workspace-title', `${payload.market.name || marketCode} · Catalogue pays`));
    copy.appendChild(el(
      'p',
      'kmc-workspace-subtitle',
      `Market ID ${marketCode} · ${payload.market.currency || '—'} · la vérité produit globale reste inchangée`
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

  function renderSummary(payload) {
    const rows = Array.isArray(payload.exposure) ? payload.exposure : [];
    const enabled = rows.filter(row => row.commercial_exposure === 'ENABLED').length;
    const disabled = rows.filter(row => row.commercial_exposure !== 'ENABLED').length;
    const section = el('section', 'kmc-workspace-metrics');
    const cards = [
      ['Produits configurés', rows.length],
      ['Exposés dans ce marché', enabled],
      ['Masqués dans ce marché', disabled],
    ];
    cards.forEach(([label, value]) => {
      const card = el('article', 'kmc-metric-card');
      card.appendChild(el('span', 'kmc-metric-label', label));
      card.appendChild(el('strong', 'kmc-metric-value', value));
      section.appendChild(card);
    });
    root.appendChild(section);
  }

  function renderExposure(payload, marketCode) {
    const section = el('section', 'kmc-section');
    section.appendChild(el('h2', 'kmc-section-title', 'Exposition commerciale'));
    section.appendChild(el(
      'p',
      'kmc-workspace-note',
      'Ici le Responsable pays choisit quels produits du catalogue global sont visibles dans son marché. Aucune fiche produit globale, aucun SKU global et aucun prix catalogue global ne sont modifiés.'
    ));

    const rows = Array.isArray(payload.exposure) ? payload.exposure : [];
    if (!rows.length) {
      section.appendChild(el('div', 'kmc-workspace-empty', 'Aucun produit configuré pour ce marché.'));
      root.appendChild(section);
      return;
    }

    const canManage = Array.isArray(payload.actor_capabilities)
      && payload.actor_capabilities.includes('catalog.expose');
    const wrap = el('div', 'kmc-workspace-table-wrap');
    const table = el('table', 'kmc-workspace-table');
    table.innerHTML = '<thead><tr><th>Produit</th><th>SKU</th><th>État pays</th><th>Décision</th><th>Action</th></tr></thead>';
    const tbody = global.document.createElement('tbody');

    rows.forEach(row => {
      const tr = global.document.createElement('tr');
      const product = el('td');
      product.appendChild(el('strong', '', row.product_name || row.product_id));
      product.appendChild(el('div', 'kmc-workspace-note', row.product_id));
      tr.appendChild(product);
      tr.appendChild(el('td', '', row.sku || '—'));
      const enabled = row.commercial_exposure === 'ENABLED';
      tr.appendChild(el('td', '', enabled ? 'Exposé' : 'Masqué'));
      tr.appendChild(el('td', '', formatDate(row.decided_at)));

      const actionCell = el('td');
      if (canManage) {
        const button = el('button', 'kmc-workspace-action', enabled ? 'Masquer' : 'Exposer');
        button.type = 'button';
        button.addEventListener('click', async () => {
          const next = enabled ? 'DISABLED' : 'ENABLED';
          button.disabled = true;
          setFeedback(`${row.sku || row.product_id} · mise à jour…`);
          try {
            await request(
              `/api/market-delegation/markets/${encodeURIComponent(marketCode)}/catalog/exposure/${encodeURIComponent(row.product_id)}`,
              { method: 'PUT', body: { commercial_exposure: next } }
            );
            setFeedback(`${row.sku || row.product_id} · ${next === 'ENABLED' ? 'exposé' : 'masqué'} dans ${marketCode}.`, 'positive');
            await load();
          } catch (error) {
            button.disabled = false;
            setFeedback(`${error.message}${error.code ? ` · ${error.code}` : ''}`, 'critical');
          }
        });
        actionCell.appendChild(button);
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
      renderSummary(payload);
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

/**
 * @komerce-arch
 * @role          market-country-autonomy-test-ui
 * @domain        admin-dashboard
 * @layer         ui-workspace
 * @criticality   medium
 * @inputs        server_admin_context, market_pricing_projection, market_price_decisions, activation_preview
 * @outputs       local_price_decision_ui, activation_ui, capability_evidence
 * @depends       /api/admin/dashboard/context, /api/admin/workspaces/pricing/market/:marketCode
 * @used-by       /dashboards/canonical/market-autonomy.html
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      server_scope_is_authority, country_manager_owns_local_strategy, only_LOCAL_ACTIVE_is_buyer_effective
 * @impact-areas  admin-dashboard, market, pricing
 * @version       2026-09
 */

'use strict';

(function bootMarketAutonomy(global) {
  const root = global.document && global.document.getElementById('market-autonomy-root');
  if (!root) return;

  function el(tag, className, value) {
    const node = global.document.createElement(tag);
    if (className) node.className = className;
    if (value != null) node.textContent = String(value);
    return node;
  }

  function fmt(value, currency) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    try {
      return new Intl.NumberFormat('fr-FR', {
        style: 'currency',
        currency,
        maximumFractionDigits: currency === 'KMF' || currency === 'XAF' ? 0 : 2,
      }).format(n);
    } catch (_) {
      return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(n)} ${currency || ''}`.trim();
    }
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

  function feedback(message, tone) {
    const node = root.querySelector('[data-autonomy-feedback]');
    if (!node) return;
    node.className = `kmc-workspace-feedback${tone ? ` is-${tone}` : ''}`;
    node.textContent = message || '';
  }

  function capabilityCard(label, available, detail) {
    const card = el('article', 'kmc-workspace-action-card');
    card.appendChild(el('strong', '', label));
    card.appendChild(el('span', '', available ? 'Disponible ✓' : 'Bloqué / non livré'));
    if (detail) card.appendChild(el('small', '', detail));
    return card;
  }

  function renderHeader(context, marketCode, workspace) {
    const access = workspace.access || {};
    const scope = workspace.scope || {};
    const header = el('header', 'kmc-workspace-header');
    const copy = el('div');
    copy.appendChild(el('span', 'kmc-workspace-kicker', 'MARCHÉ & DÉLÉGATION · PREUVE D’AUTONOMIE'));
    copy.appendChild(el('h1', 'kmc-workspace-title', `${scope.market_name || marketCode} · ${access.role || 'scope'}`));
    copy.appendChild(el('p', 'kmc-workspace-subtitle', `Devise locale : ${scope.market_currency || '—'} · scope serveur · ${access.read_only ? 'lecture / simulation' : 'gestion pays'}`));
    header.appendChild(copy);

    const nav = el('nav', 'kmc-workspace-nav');
    const dashboard = el('a', 'kmc-workspace-nav-link', 'Dashboard →');
    dashboard.href = '/admin/pilotage';
    nav.appendChild(dashboard);
    const workshop = el('a', 'kmc-workspace-nav-link', 'Atelier des coûts →');
    workshop.href = `/admin/workspaces/pricing?market=${encodeURIComponent(marketCode)}`;
    nav.appendChild(workshop);
    const buyer = el('a', 'kmc-workspace-nav-link', 'Voir la boutique →');
    buyer.href = `/?market=${encodeURIComponent(marketCode)}`;
    buyer.target = '_blank';
    nav.appendChild(buyer);
    header.appendChild(nav);

    const status = el('div', 'kmc-workspace-feedback', 'Prêt.');
    status.dataset.autonomyFeedback = '';
    status.setAttribute('role', 'status');
    header.appendChild(status);
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
    select.className = 'kmc-workspace-input';
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

  function renderCapabilities(workspace) {
    const access = workspace.access || {};
    const caps = workspace.capabilities || {};
    const section = el('section', 'kmc-section');
    section.appendChild(el('h2', 'kmc-section-title', 'Capacités effectives'));
    section.appendChild(el('p', 'kmc-workspace-note', 'Les capacités ci-dessous reflètent les APIs réellement disponibles et leur frontière serveur.'));
    const grid = el('div', 'kmc-workspace-actions-grid');
    grid.appendChild(capabilityCard('Lire le modèle pays', true, `scope ${workspace.scope && workspace.scope.market_code || '—'}`));
    grid.appendChild(capabilityCard('Simuler l’impact', Boolean(caps.simulation), 'Viewer et manager · lecture seule.'));
    grid.appendChild(capabilityCard('Modifier les coûts locaux', Boolean(caps.cost_overrides), access.read_only ? 'Viewer : refus serveur.' : 'Manager : override marché audité.'));
    grid.appendChild(capabilityCard('Décider un prix local', Boolean(caps.local_price_drafts), 'La décision reste locale au marché.'));
    grid.appendChild(capabilityCard('Prévisualiser le gate', Boolean(caps.local_price_activation_preview), 'CDR + position + couverture marché.'));
    grid.appendChild(capabilityCard('Activer le prix acheteur', Boolean(caps.local_price_buyer_activation), caps.local_price_buyer_activation ? 'LOCAL_ACTIVE est consommé par catalogue, liste et commande.' : 'Cutover fermé.'));
    section.appendChild(grid);
    root.appendChild(section);
  }

  function previewSummary(preview) {
    const economics = preview.economics || {};
    const gate = preview.market_gate || {};
    const activation = preview.activation || {};
    const ratio = gate.coverage_ratio == null ? '—' : Number(gate.coverage_ratio).toFixed(3);
    return [
      `Prix projeté : ${fmt(economics.projected_price_kmf, 'KMF')}`,
      `CDR : ${fmt(economics.cdr_complete_kmf, 'KMF')}`,
      `Position : ${economics.strategy_risk || '—'}`,
      `Couverture : ${gate.decision_status || '—'} (${ratio})`,
      activation.allowed ? `ACTIVABLE · ${activation.reason}` : `BLOQUÉ · ${activation.reason}`,
    ].join(' · ');
  }

  function renderPrices(marketCode, workspace, pricePayload) {
    const section = el('section', 'kmc-section');
    section.appendChild(el('h2', 'kmc-section-title', 'Prix commercial local'));
    section.appendChild(el('p', 'kmc-workspace-note', `Le manager décide dans ${pricePayload.market.currency}. DRAFT → gate économique → LOCAL_ACTIVE. Le prix global KMF n’est jamais écrasé.`));

    const tableWrap = el('div', 'kmc-workspace-table-wrap');
    const table = el('table', 'kmc-workspace-table');
    table.innerHTML = '<thead><tr><th>Produit</th><th>Base globale</th><th>Décision locale</th><th>État</th><th>Motif</th><th>Actions</th></tr></thead>';
    const tbody = global.document.createElement('tbody');
    const canManage = Boolean(workspace.capabilities && workspace.capabilities.local_price_drafts);

    (pricePayload.products || []).slice(0, 100).forEach(row => {
      const tr = global.document.createElement('tr');
      const product = el('td');
      product.appendChild(el('strong', '', row.product_ref));
      product.appendChild(el('div', 'kmc-workspace-note', row.name || row.category || 'Produit'));
      tr.appendChild(product);
      tr.appendChild(el('td', '', `${new Intl.NumberFormat('fr-FR').format(row.global_price_kmf || 0)} KMF`));

      const localCell = el('td');
      const input = global.document.createElement('input');
      input.type = 'number';
      input.min = '0.0001';
      input.step = pricePayload.market.currency === 'KMF' || pricePayload.market.currency === 'XAF' ? '1' : '0.01';
      input.value = row.local_price == null ? '' : row.local_price;
      input.placeholder = pricePayload.market.currency;
      input.disabled = !canManage;
      localCell.appendChild(input);
      localCell.appendChild(el('small', '', ` ${pricePayload.market.currency}`));
      tr.appendChild(localCell);

      tr.appendChild(el('td', '', row.decision_status || 'Aucune décision locale'));

      const reasonCell = el('td');
      const reason = global.document.createElement('input');
      reason.type = 'text';
      reason.placeholder = 'Motif de décision';
      reason.value = row.decision_reason || '';
      reason.disabled = !canManage;
      reasonCell.appendChild(reason);
      tr.appendChild(reasonCell);

      const actions = el('td');
      if (canManage) {
        const save = el('button', 'kmc-workspace-action', 'Enregistrer');
        save.type = 'button';
        save.addEventListener('click', async () => {
          feedback(`Enregistrement ${row.product_ref}…`);
          try {
            await request(`/api/admin/workspaces/pricing/market/${encodeURIComponent(marketCode)}/products/${encodeURIComponent(row.product_ref)}/local-price`, {
              method: 'POST',
              body: { amount: Number(input.value), reason: reason.value, source: 'market_autonomy_ui' },
            });
            feedback(`${row.product_ref} · décision locale enregistrée.`, 'positive');
            await load();
          } catch (error) {
            feedback(`${error.message}${error.code ? ` · ${error.code}` : ''}`, 'critical');
          }
        });
        actions.appendChild(save);
      }

      if (row.local_price != null) {
        const preview = el('button', 'kmc-workspace-action is-secondary', 'Voir l’impact');
        preview.type = 'button';
        preview.addEventListener('click', async () => {
          feedback(`Simulation du gate ${row.product_ref}…`);
          try {
            const result = await request(`/api/admin/workspaces/pricing/market/${encodeURIComponent(marketCode)}/products/${encodeURIComponent(row.product_ref)}/local-price/activation-preview`);
            feedback(previewSummary(result), result.activation && result.activation.allowed ? 'positive' : 'critical');
          } catch (error) {
            feedback(`${error.message}${error.code ? ` · ${error.code}` : ''}`, 'critical');
          }
        });
        actions.appendChild(preview);
      }

      if (canManage && row.local_price != null && row.decision_status !== 'LOCAL_ACTIVE') {
        const activate = el('button', 'kmc-workspace-action', 'Activer');
        activate.type = 'button';
        activate.addEventListener('click', async () => {
          feedback(`Activation ${row.product_ref}…`);
          try {
            const result = await request(`/api/admin/workspaces/pricing/market/${encodeURIComponent(marketCode)}/products/${encodeURIComponent(row.product_ref)}/local-price/activate`, {
              method: 'POST',
              body: { reason: reason.value || 'Activation après simulation', source: 'market_autonomy_ui' },
            });
            feedback(`${row.product_ref} · LOCAL_ACTIVE · prix maintenant consommé par le parcours acheteur.`, 'positive');
            await load();
          } catch (error) {
            feedback(`${error.message}${error.code ? ` · ${error.code}` : ''}`, 'critical');
          }
        });
        actions.appendChild(activate);
      }

      if (canManage && row.local_price != null) {
        const reset = el('button', 'kmc-workspace-action is-secondary', 'Revenir à la base');
        reset.type = 'button';
        reset.addEventListener('click', async () => {
          feedback(`Reset ${row.product_ref}…`);
          try {
            await request(`/api/admin/workspaces/pricing/market/${encodeURIComponent(marketCode)}/products/${encodeURIComponent(row.product_ref)}/local-price/reset`, {
              method: 'POST',
              body: { reason: reason.value || 'Retour à la base globale', source: 'market_autonomy_ui' },
            });
            feedback(`${row.product_ref} · retour à la base globale.`, 'positive');
            await load();
          } catch (error) {
            feedback(`${error.message}${error.code ? ` · ${error.code}` : ''}`, 'critical');
          }
        });
        actions.appendChild(reset);
      }

      if (!canManage) actions.appendChild(el('span', 'kmc-workspace-note', 'Viewer · lecture seule'));
      tr.appendChild(actions);
      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    tableWrap.appendChild(table);
    section.appendChild(tableWrap);
    root.appendChild(section);
  }

  async function load() {
    try {
      const context = await request('/api/admin/dashboard/context');
      const marketCode = marketFromContext(context);
      if (!marketCode) throw new Error('Aucun marché autorisé pour ce compte.');
      const [workspace, prices] = await Promise.all([
        request(`/api/admin/workspaces/pricing/market/${encodeURIComponent(marketCode)}`),
        request(`/api/admin/workspaces/pricing/market/${encodeURIComponent(marketCode)}/commercial-prices`),
      ]);

      root.className = 'kmc-workspace';
      root.replaceChildren();
      renderHeader(context, marketCode, workspace);
      renderMarketSelector(context, marketCode);
      renderCapabilities(workspace);
      renderPrices(marketCode, workspace, prices);
    } catch (error) {
      root.className = 'canonical-boot';
      root.replaceChildren();
      root.appendChild(el('p', 'canonical-eyebrow', 'KOMERCE · AUTONOMIE PAYS'));
      root.appendChild(el('h1', '', 'Accès indisponible'));
      root.appendChild(el('p', '', `${error.message}${error.code ? ` · ${error.code}` : ''}`));
      const login = el('a', 'kmc-workspace-nav-link', 'Se connecter →');
      login.href = '/login.html?next=' + encodeURIComponent(global.location.pathname + global.location.search);
      root.appendChild(login);
    }
  }

  load();
})(globalThis);

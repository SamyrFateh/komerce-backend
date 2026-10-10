/**
 * @komerce-arch
 * @role          markets-management-ui
 * @domain        admin-dashboard
 * @layer         ui-workspace
 * @criticality   high
 * @inputs        authenticated_admin, /api/admin/markets
 * @outputs       markets_list, readiness_gaps_view, lifecycle_open_suspend_actions
 * @depends       /api/admin/markets, /api/admin/markets/:marketCode/control-plane, /api/admin/markets/:marketCode/lifecycle
 * @used-by       /dashboards/canonical/access.html
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      control_plane_orchestrates_owned_writers, central_by_role_declared, no_new_api, server_readiness_is_authority, merge_is_not_activation
 * @impact-areas  admin-dashboard, market-control-plane
 * @version       2026-10
 */
'use strict';

(function bootMarketsManagement(global) {
  const LABELS = Object.freeze({
    PROVISIONING: 'En préparation',
    ACTIVE: 'Ouvert',
    SUSPENDED: 'Suspendu',
    CLOSED: 'Clôturé',
  });

  // Miroir d'affichage de ALLOWED_TRANSITIONS (services/market-lifecycle-service.js).
  // Le serveur reste l'autorité : une transition refusée remonte son message.
  // CLOSED est volontairement absent de l'UI (irréversible).
  function actionsFor(status) {
    if (status === 'PROVISIONING') return [{ target: 'ACTIVE', label: 'Ouvrir' }];
    if (status === 'ACTIVE') return [{ target: 'SUSPENDED', label: 'Suspendre' }];
    if (status === 'SUSPENDED') return [{ target: 'ACTIVE', label: 'Rouvrir' }];
    return [];
  }

  function statusLabel(status) {
    return LABELS[status] || status || '—';
  }

  function confirmMessage(market, action) {
    const verb = action.target === 'ACTIVE' ? 'ouvrir' : 'suspendre';
    return `Confirmer : ${verb} le marché ${market.code} (${market.name}) ?`;
  }

  async function request(fetchImpl, url, options = {}) {
    const response = await fetchImpl(url, {
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

  function el(doc, tag, className, value) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (value != null) node.textContent = String(value);
    return node;
  }

  function render(host, state, options) {
    const doc = options.document;
    host.replaceChildren();
    host.appendChild(el(doc, 'h2', '', 'Gestion des marchés'));
    host.appendChild(el(doc, 'p', 'kmc-access-muted',
      'Ouvrir ou suspendre un marché. L’ouverture est refusée par le serveur tant que les écarts de préparation ne sont pas levés. La création guidée d’un marché relève du chantier « Créer un nouveau marché ».'));

    const feedback = el(doc, 'p', `kmc-access-feedback${state.feedbackTone ? ` is-${state.feedbackTone}` : ''}`, state.feedback || '');
    feedback.setAttribute('role', 'status');
    host.appendChild(feedback);

    if (!state.markets.length) {
      host.appendChild(el(doc, 'p', 'kmc-access-muted', 'Aucun marché.'));
      return;
    }

    const table = el(doc, 'table', 'kmc-markets-mgmt-table');
    const head = el(doc, 'tr');
    ['Marché', 'Devise', 'État', 'Équipe active', 'Actions'].forEach(label => head.appendChild(el(doc, 'th', '', label)));
    table.appendChild(el(doc, 'thead')).appendChild(head);
    const body = el(doc, 'tbody');
    state.markets.forEach(market => {
      const row = el(doc, 'tr');
      row.dataset.marketCode = market.code;
      row.appendChild(el(doc, 'td', '', `${market.code} · ${market.name}`));
      row.appendChild(el(doc, 'td', '', market.currency));
      const status = el(doc, 'td');
      status.appendChild(el(doc, 'span', 'kmc-markets-mgmt-status', statusLabel(market.lifecycle_status)));
      row.appendChild(status);
      row.appendChild(el(doc, 'td', '', market.active_members == null ? '—' : market.active_members));
      const actions = el(doc, 'td', 'kmc-markets-mgmt-actions');
      const gapsButton = el(doc, 'button', 'kmc-access-button', 'Voir les écarts');
      gapsButton.type = 'button';
      gapsButton.addEventListener('click', () => options.onGaps(market));
      actions.appendChild(gapsButton);
      actionsFor(market.lifecycle_status).forEach(action => {
        const button = el(doc, 'button', action.target === 'ACTIVE' ? 'kmc-access-button is-primary' : 'kmc-access-button is-danger', action.label);
        button.type = 'button';
        button.dataset.lifecycleTarget = action.target;
        button.addEventListener('click', () => options.onLifecycle(market, action));
        actions.appendChild(button);
      });
      row.appendChild(actions);
      body.appendChild(row);
      if (state.gaps && state.gaps.code === market.code) {
        const detail = el(doc, 'tr', 'kmc-markets-mgmt-gaps');
        const cell = el(doc, 'td');
        cell.colSpan = 5;
        if (!state.gaps.items.length) {
          cell.appendChild(el(doc, 'p', '', 'Aucun écart : le marché est prêt.'));
        } else {
          const list = el(doc, 'ul');
          state.gaps.items.forEach(gap => list.appendChild(el(doc, 'li', '', gap.message || gap.code)));
          cell.appendChild(list);
        }
        detail.appendChild(cell);
        body.appendChild(detail);
      }
    });
    table.appendChild(body);
    host.appendChild(table);
  }

  async function mount(host, options = {}) {
    const fetchImpl = options.fetch || global.fetch.bind(global);
    const confirmImpl = options.confirm || ((message) => global.confirm(message));
    const state = { markets: [], gaps: null, feedback: '', feedbackTone: '' };
    const ctx = { document: options.document || global.document };

    async function load() {
      const payload = await request(fetchImpl, '/api/admin/markets');
      state.markets = Array.isArray(payload.markets) ? payload.markets : [];
    }
    function paint() { render(host, state, ctx); }

    ctx.onGaps = async market => {
      try {
        const control = await request(fetchImpl, `/api/admin/markets/${encodeURIComponent(market.code)}/control-plane`);
        state.gaps = { code: market.code, items: control.gaps || [] };
        state.feedback = '';
      } catch (error) {
        state.feedback = error.message;
        state.feedbackTone = 'critical';
      }
      paint();
    };
    ctx.onLifecycle = async (market, action) => {
      if (!confirmImpl(confirmMessage(market, action))) return;
      try {
        await request(fetchImpl, `/api/admin/markets/${encodeURIComponent(market.code)}/lifecycle`, {
          method: 'POST', body: { status: action.target },
        });
        await load();
        state.feedback = `Marché ${market.code} : ${statusLabel(action.target).toLowerCase()}.`;
        state.feedbackTone = 'positive';
      } catch (error) {
        state.feedback = error.message;
        state.feedbackTone = 'critical';
        if (error.code === 'MARKET_NOT_READY_FOR_ACTIVATION') state.gaps = null;
      }
      paint();
    };

    try {
      await load();
    } catch (error) {
      state.feedback = error.message;
      state.feedbackTone = 'critical';
    }
    paint();
    return state;
  }

  const api = { actionsFor, statusLabel, confirmMessage, mount };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.KomerceMarketsManagement = api;

  // Montage sur access.html (admin) : section après la vue décision, avant les accès.
  const doc = global.document;
  const root = doc && doc.getElementById && doc.getElementById('canonical-admin-root');
  if (!root || typeof global.fetch !== 'function') return;
  let attempts = 80;
  (function wait() {
    if (root.querySelector('.kmc-access-hero')) {
      const host = doc.createElement('section');
      host.id = 'markets-management';
      host.className = 'kmc-access-panel kmc-markets-mgmt';
      const overview = doc.getElementById('markets-decision-admin-overview');
      if (overview && overview.parentNode) overview.parentNode.insertBefore(host, overview.nextSibling);
      else root.insertBefore(host, root.querySelector('.kmc-access-hero'));
      mount(host, { document: doc });
      return;
    }
    attempts -= 1;
    if (attempts > 0) global.setTimeout(wait, 50);
  }());
}(typeof window !== 'undefined' ? window : globalThis));

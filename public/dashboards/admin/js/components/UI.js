/**
 * @komerce-arch
 * @role          admin-alert-ui-component
 * @domain        admin-dashboard
 * @layer         ui-component
 * @criticality   low
 * @inputs        alert_object (key, level, message, action_url)
 * @outputs       alert_dom_element
 * @depends       none
 * @used-by       views/ActionCenterView.js, views/ProblemsView.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      none
 * @impact-areas  admin-dashboard, alerts-display
 * @version       2026-06
 */

'use strict';
/**
 * KOMERCE Dashboard — AlertList component
 * ════════════════════════════════════════════════════════════════════════ */

(function (global) {
  'use strict';

  const ICONS = {
    paid_but_stock_blocked: '🔒',
    fixed_overhead_not_allocated: '💸',
    customs_shipment_not_allocated: '🚢',
    payment_fees_missing: '💳',
    cost_incomplete_critical: '📉',
    critical: '🚨',
    elevated: '⚠️',
    info: 'ℹ️',
  };

  function render(alert) {
    const div = document.createElement('div');
    const level = alert.level || 'info';
    div.className = `alert-item is-${level}`;

    const icon = ICONS[alert.key] || ICONS[level] || 'ℹ️';
    const action = alert.action_url
      ? `<a href="${alert.action_url}" class="alert-action">${alert.action_label || 'Voir'}</a>`
      : '';

    div.innerHTML = `
      <div class="alert-icon">${icon}</div>
      <div class="alert-content">
        <div class="alert-title">${alert.label || alert.message || alert.source || 'Alerte'}</div>
        <div class="alert-meta">
          ${alert.count != null ? `${alert.count} concerné(s)` : ''}
          ${alert.created_at ? ` · ${new Date(alert.created_at).toLocaleDateString('fr-FR')}` : ''}
          ${alert.source ? ` · ${alert.source}` : ''}
        </div>
      </div>
      ${action}
    `;

    return div;
  }

  function renderList(container, alerts, opts = {}) {
    container.innerHTML = '';
    container.classList.add('alert-list');

    if (!alerts || !alerts.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = opts.emptyText || 'Aucune alerte';
      container.appendChild(empty);
      return;
    }

    alerts.slice(0, opts.limit || 10).forEach(a => {
      container.appendChild(render(a));
    });
  }

  global.AlertList = { render, renderList };
})(window);


/**
 * KOMERCE Dashboard — BadgeStatus component
 * ════════════════════════════════════════════════════════════════════════ */

(function (global) {
  'use strict';

  const STATUS_COLORS = {
    // Order status
    pending: 'orange',
    confirmed: 'green',
    ordered: 'blue',
    preparation: 'blue',
    shipped: 'blue',
    in_transit: 'blue',
    available: 'amber',
    collected: 'green',
    cancelled: 'red',
    refunded: 'red',
    // Payment status
    paid: 'green',
    failed: 'red',
    // Parcel status
    draft: 'gray',
    arrived: 'amber',
  };

  function status(value) {
    const color = STATUS_COLORS[value] || 'gray';
    const span = document.createElement('span');
    span.className = `badge is-${color}`;
    span.textContent = value;
    return span;
  }

  function costStatus(value) {
    const span = document.createElement('span');
    span.className = `badge badge-cost is-${value}`;
    span.textContent = value;
    return span;
  }

  global.BadgeStatus = { status, costStatus };
})(window);


/**
 * KOMERCE Dashboard — DataTable component
 * ════════════════════════════════════════════════════════════════════════ */

(function (global) {
  'use strict';

  /**
   * Render une table.
   * @param {HTMLElement} container
   * @param {object} config { columns: [{key, label, render?, align?}], rows: [...] }
   */
  function render(container, config) {
    container.innerHTML = '';

    if (!config.rows || !config.rows.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = config.emptyText || 'Aucune donnée';
      container.appendChild(empty);
      return;
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'table-wrapper';

    const table = document.createElement('table');
    table.className = 'data-table';

    // Header
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    config.columns.forEach(col => {
      const th = document.createElement('th');
      th.textContent = col.label;
      if (col.align === 'right') th.style.textAlign = 'right';
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    // Body
    const tbody = document.createElement('tbody');
    config.rows.forEach(row => {
      const tr = document.createElement('tr');
      config.columns.forEach(col => {
        const td = document.createElement('td');
        if (col.align === 'right') td.classList.add('num');
        if (col.cls) td.classList.add(col.cls);
        if (col.render) {
          const content = col.render(row);
          if (content instanceof HTMLElement) td.appendChild(content);
          else td.innerHTML = content || '';
        } else {
          td.textContent = row[col.key] != null ? String(row[col.key]) : '—';
        }
        tr.appendChild(td);
      });
      if (config.onRowClick) {
        tr.style.cursor = 'pointer';
        tr.addEventListener('click', () => config.onRowClick(row));
      }
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrapper.appendChild(table);
    container.appendChild(wrapper);
  }

  global.DataTable = { render };
})(window);


/**
 * KOMERCE Dashboard — Canonical UI states (LOT 2A)
 * ════════════════════════════════════════════════════════════════════════
 * Réutilise strictement les classes historiques loading/empty/error.
 */
(function (global) {
  'use strict';

  function baseState(className, text) {
    const el = document.createElement('div');
    el.className = className;
    if (text != null && text !== '') el.appendChild(document.createTextNode(String(text)));
    return el;
  }

  function emptyState(text = 'Aucune donnée') {
    return baseState('empty-state', text);
  }

  function loadingState(text = 'Chargement...') {
    const el = baseState('loading-state', '');
    const loader = document.createElement('span');
    loader.className = 'loader';
    el.appendChild(loader);
    if (text) el.appendChild(document.createTextNode(` ${text}`));
    return el;
  }

  function errorState(text = 'Erreur de chargement') {
    return baseState('error-state', text);
  }

  global.UIState = { emptyState, loadingState, errorState };
})(window);


/**
 * KOMERCE Dashboard — FilterBar primitive (LOT 2A)
 * Délègue intégralement son état à KmcFilters. Aucun état parallèle.
 */
(function (global) {
  'use strict';

  const LABELS = {
    from: 'Du',
    to: 'Au',
    island: 'Île',
    relais_id: 'Relais',
    status: 'Statut',
    payment_status: 'Paiement',
    cost_status: 'Qualité coût',
    channel: 'Canal',
    origin: 'Origine',
  };

  function requireStore() {
    const store = global.KmcFilters;
    if (!store || !Array.isArray(store.FILTER_KEYS) || typeof store.get !== 'function' || typeof store.set !== 'function') {
      throw new Error('FilterBar requiert KmcFilters');
    }
    return store;
  }

  function render(container, keys) {
    if (!container || typeof container.appendChild !== 'function') {
      throw new Error('FilterBar: container invalide');
    }

    const store = requireStore();
    const requested = Array.isArray(keys) ? keys : [];
    const unknown = requested.filter(key => !store.FILTER_KEYS.includes(key));
    if (unknown.length) throw new Error(`FilterBar: filtre(s) inconnu(s): ${unknown.join(', ')}`);

    const state = store.get();
    container.innerHTML = '';
    const bar = document.createElement('div');
    bar.className = 'grid grid-3';
    bar.setAttribute('data-dashboard-filter-bar', '');

    requested.forEach(key => {
      const label = document.createElement('label');
      label.dataset.filterKey = key;

      const caption = document.createElement('span');
      caption.textContent = LABELS[key] || key;
      label.appendChild(caption);

      const input = document.createElement('input');
      input.name = key;
      input.type = key === 'from' || key === 'to' ? 'date' : 'text';
      input.value = state[key] == null ? '' : String(state[key]);
      input.setAttribute('aria-label', LABELS[key] || key);
      input.addEventListener('change', () => store.set({ [key]: input.value }));

      label.appendChild(input);
      bar.appendChild(label);
    });

    container.appendChild(bar);
    return bar;
  }

  global.FilterBar = { render };
})(window);


/**
 * KOMERCE Dashboard — Section primitive (LOT 2A)
 * Formalise le markup `.page-section` existant, sans nouvelle convention CSS.
 */
(function (global) {
  'use strict';

  const STATES = new Set(['loading', 'empty', 'error']);

  function stateElement(state, message) {
    if (!state) return null;
    if (!STATES.has(state)) throw new Error(`Section: état inconnu: ${state}`);
    if (!global.UIState) throw new Error('Section requiert UIState pour rendre un état');
    if (state === 'loading') return global.UIState.loadingState(message);
    if (state === 'empty') return global.UIState.emptyState(message);
    return global.UIState.errorState(message);
  }

  function appendContent(slot, content) {
    if (content == null) return;
    if (content instanceof HTMLElement) {
      slot.appendChild(content);
      return;
    }
    if (typeof content === 'function') {
      const rendered = content(slot);
      if (rendered instanceof HTMLElement && rendered.parentNode !== slot) slot.appendChild(rendered);
      return;
    }
    slot.textContent = String(content);
  }

  function create(options = {}) {
    const section = document.createElement('section');
    section.className = 'page-section';

    if (options.title) {
      const title = document.createElement('h2');
      title.className = 'page-section-title';
      title.textContent = String(options.title);
      section.appendChild(title);
    }

    const slot = document.createElement('div');
    slot.setAttribute('data-section-slot', '');
    const state = stateElement(options.state, options.message);
    if (state) slot.appendChild(state);
    else appendContent(slot, options.content);

    section.appendChild(slot);
    return { element: section, slot };
  }

  function render(container, options = {}) {
    if (!container || typeof container.appendChild !== 'function') {
      throw new Error('Section: container invalide');
    }
    const built = create(options);
    container.appendChild(built.element);
    return built;
  }

  global.Section = { create, render };
})(window);

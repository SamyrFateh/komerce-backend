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

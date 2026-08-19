/**
 * @komerce-arch
 * @role          admin-dashboard-filter-bar-component
 * @domain        admin-dashboard
 * @layer         ui-component
 * @criticality   medium
 * @inputs        filter_keys, KmcFilters state
 * @outputs       filter_controls_bound_to_KmcFilters
 * @depends       filters-store.js
 * @used-by       future SchemaDashboard renderer
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      kmc_api_only
 * @impact-areas  admin-dashboard, date-filtering
 * @version       2026-08
 */

'use strict';
/**
 * KOMERCE Dashboard — FilterBar primitive
 *
 * Fondation LOT 2A : rend uniquement des clés déjà possédées par KmcFilters.
 * Aucun état parallèle, aucune logique métier, aucun CSS propre.
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

  function normalizeKeys(store, keys) {
    const requested = Array.isArray(keys) ? keys : [];
    const unknown = requested.filter(key => !store.FILTER_KEYS.includes(key));
    if (unknown.length) throw new Error(`FilterBar: filtre(s) inconnu(s): ${unknown.join(', ')}`);
    return requested;
  }

  function createControl(store, key, value) {
    const label = document.createElement('label');
    label.dataset.filterKey = key;

    const caption = document.createElement('span');
    caption.textContent = LABELS[key] || key;
    label.appendChild(caption);

    const input = document.createElement('input');
    input.name = key;
    input.type = key === 'from' || key === 'to' ? 'date' : 'text';
    input.value = value == null ? '' : String(value);
    input.setAttribute('aria-label', LABELS[key] || key);
    input.addEventListener('change', () => {
      store.set({ [key]: input.value });
    });

    label.appendChild(input);
    return label;
  }

  function render(container, keys) {
    if (!container || typeof container.appendChild !== 'function') {
      throw new Error('FilterBar: container invalide');
    }

    const store = requireStore();
    const selectedKeys = normalizeKeys(store, keys);
    const state = store.get();

    container.innerHTML = '';
    const bar = document.createElement('div');
    // Réutilise uniquement la grille existante. Aucun style FilterBar nouveau en 2A.
    bar.className = 'grid grid-3';
    bar.setAttribute('data-dashboard-filter-bar', '');

    selectedKeys.forEach(key => {
      bar.appendChild(createControl(store, key, state[key]));
    });

    container.appendChild(bar);
    return bar;
  }

  global.FilterBar = { render };
})(window);

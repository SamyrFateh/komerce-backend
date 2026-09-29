/**
 * @komerce-arch
 * @role          market-ready-to-sell-ui
 * @domain        dashboard
 * @layer         ui-workspace
 * @criticality   high
 * @inputs        ready_to_sell_projection, market_code, existing catalog/pricing APIs
 * @outputs       local_price_decision, activation_request, market_exposure_request
 * @depends       catalog market validation/exposure APIs, pricing local-price APIs
 * @used-by       public/dashboards/canonical/js/market-catalog.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      certified_product_before_market_decision, one_human_commercial_decision, bulk_only_green_rows, server_rechecks_every_gate
 * @impact-areas  admin-dashboard, market-delegation, catalog, pricing
 * @version       2026-09
 */
'use strict';

(function initReadyToSell(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.KomerceMarketReadyToSell = api;
})(typeof globalThis !== 'undefined' ? globalThis : null, function createReadyToSell() {
  'use strict';

  function number(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function formatAmount(value, currency) {
    const n = number(value);
    if (n == null) return '—';
    try {
      return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n) + ' ' + (currency || '');
    } catch (_) {
      return String(Math.round(n)) + ' ' + (currency || '');
    }
  }

  function statusClass(state) {
    return 'kmc-ready-status is-' + (state?.tone || 'neutral');
  }

  async function approveOne({ row, amount, marketCode, request, feedback }) {
    const localAmount = number(amount);
    if (!row.local_price_active && (!localAmount || localAmount <= 0)) {
      throw new Error('Un prix local strictement positif est requis.');
    }

    const market = encodeURIComponent(marketCode);
    const productId = encodeURIComponent(row.product_id);
    const productRef = encodeURIComponent(row.product_ref);
    const priceBase = `/api/admin/workspaces/pricing/market/${market}/products/${productRef}/local-price`;

    feedback(`${row.product_ref} · préparation de la mise en vente…`);

    if (row.catalog_state === 'candidate') {
      await request(
        `/api/market-delegation/markets/${market}/catalog/review/${productId}/validate`,
        { method: 'POST', body: {} }
      );
    }

    if (!row.local_price_active) {
      await request(priceBase, {
        method: 'POST',
        body: {
          amount: localAmount,
          reason: 'Mise en vente depuis la file Prêts à vendre',
          source: 'market_ready_to_sell',
        },
      });
      await request(priceBase + '/activate', {
        method: 'POST',
        body: {
          reason: 'Confirmation commerciale depuis la file Prêts à vendre',
          source: 'market_ready_to_sell',
        },
      });
    }

    // validateForMarket() expose déjà le candidat. Pour un produit publié,
    // l'exposition n'est activée qu'après le prix LOCAL_ACTIVE.
    if (!row.exposure_enabled && row.catalog_state !== 'candidate') {
      await request(
        `/api/market-delegation/markets/${market}/catalog/exposure/${productId}`,
        { method: 'PUT', body: { commercial_exposure: 'ENABLED' } }
      );
    }
    return true;
  }

  function render(options = {}) {
    const host = options.root;
    const payload = options.payload || {};
    const marketCode = options.marketCode;
    const request = options.request;
    const feedback = options.feedback || (() => {});
    const reload = options.reload || (async () => {});
    if (!host || !host.ownerDocument || typeof request !== 'function') return null;

    const doc = host.ownerDocument;
    const queue = payload.ready_to_sell || {};
    const rows = Array.isArray(queue.items) ? queue.items : [];
    const summary = queue.summary || {};
    const currency = payload.market?.currency || queue.market?.currency || '';

    const section = doc.createElement('section');
    section.className = 'kmc-section kmc-ready-section';
    section.id = 'market-ready-to-sell';

    const head = doc.createElement('div');
    head.className = 'kmc-ready-head';
    head.innerHTML = `
      <div>
        <span class="kmc-workspace-kicker">DERNIER GESTE COMMERCIAL</span>
        <h2 class="kmc-section-title">Produits prêts à vendre</h2>
        <p class="kmc-workspace-note">Fiches déjà certifiées et préparées. Décidez uniquement le prix pays ; Komerce recontrôle les gates avant toute visibilité Boutique.</p>
      </div>
      <div class="kmc-ready-summary">
        <strong>${Number(summary.ready || 0)} prêts</strong>
        <span>${Number(summary.review || 0)} à arbitrer · ${Number(summary.blocked || 0)} bloqués</span>
      </div>`;
    section.appendChild(head);

    if (!rows.length) {
      const empty = doc.createElement('div');
      empty.className = 'kmc-workspace-empty';
      empty.textContent = 'Aucun produit certifié en attente de décision commerciale.';
      section.appendChild(empty);
      host.appendChild(section);
      return section;
    }

    const toolbar = doc.createElement('div');
    toolbar.className = 'kmc-ready-toolbar';
    const bulk = doc.createElement('button');
    bulk.type = 'button';
    bulk.className = 'kmc-workspace-action kmc-ready-bulk';
    toolbar.appendChild(bulk);
    const helper = doc.createElement('span');
    helper.className = 'kmc-workspace-note';
    helper.textContent = 'Le bulk ne sélectionne que les lignes 100 % vertes au prix proposé.';
    toolbar.appendChild(helper);
    section.appendChild(toolbar);

    const wrap = doc.createElement('div');
    wrap.className = 'kmc-workspace-table-wrap';
    const table = doc.createElement('table');
    table.className = 'kmc-workspace-table kmc-ready-table';
    table.innerHTML = '<thead><tr><th></th><th>Produit</th><th>Bas marché</th><th>Prix proposé</th><th>Haut marché</th><th>État</th><th>Action</th></tr></thead>';
    const tbody = doc.createElement('tbody');
    const controls = [];

    function refreshBulkLabel() {
      const selected = controls.filter(control => control.checkbox.checked && !control.checkbox.disabled);
      bulk.textContent = selected.length
        ? `Approuver ${selected.length} produit${selected.length > 1 ? 's' : ''} prêt${selected.length > 1 ? 's' : ''}`
        : 'Aucun produit vert sélectionné';
      bulk.disabled = selected.length === 0;
    }

    rows.forEach(row => {
      const tr = doc.createElement('tr');
      tr.className = 'kmc-ready-row is-' + String(row.decision_state?.tone || 'neutral');

      const selectCell = doc.createElement('td');
      const checkbox = doc.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = Boolean(row.bulk_eligible);
      checkbox.disabled = !row.bulk_eligible;
      checkbox.setAttribute('aria-label', 'Sélectionner ' + (row.product_name || row.product_ref));
      selectCell.appendChild(checkbox);
      tr.appendChild(selectCell);

      const productCell = doc.createElement('td');
      const line = doc.createElement('div');
      line.className = 'kmc-market-product-line';
      if (row.image_url) {
        const image = doc.createElement('img');
        image.src = row.image_url;
        image.alt = row.product_name || 'Produit';
        image.loading = 'lazy';
        image.width = 52;
        image.height = 52;
        line.appendChild(image);
      }
      const copy = doc.createElement('div');
      const title = doc.createElement('strong');
      title.textContent = row.product_name || row.product_ref || 'Produit';
      copy.appendChild(title);
      const ref = doc.createElement('div');
      ref.className = 'kmc-workspace-note';
      ref.textContent = row.product_ref || '—';
      copy.appendChild(ref);
      line.appendChild(copy);
      productCell.appendChild(line);
      tr.appendChild(productCell);

      const low = doc.createElement('td');
      low.className = 'kmc-ready-price-bound';
      low.textContent = formatAmount(row.corridor?.low, currency);
      tr.appendChild(low);

      const priceCell = doc.createElement('td');
      const editor = doc.createElement('div');
      editor.className = 'kmc-ready-price-editor';
      const input = doc.createElement('input');
      input.type = 'number';
      input.min = '0';
      input.step = '1';
      input.inputMode = 'decimal';
      input.value = row.proposed_price?.amount == null ? '' : String(row.proposed_price.amount);
      input.placeholder = 'Prix';
      input.disabled = row.local_price_active || !row.can_approve || row.decision_state?.key === 'BLOCKED';
      const unit = doc.createElement('span');
      unit.textContent = currency;
      editor.appendChild(input);
      editor.appendChild(unit);
      priceCell.appendChild(editor);
      const source = doc.createElement('small');
      source.className = 'kmc-workspace-note';
      source.textContent = row.local_price_active
        ? 'Prix local déjà actif'
        : row.proposed_price?.source === 'MARKET_TARGET'
          ? 'Cible observée'
          : row.proposed_price?.source === 'EXISTING_LOCAL_DECISION'
            ? 'Décision existante'
            : 'À saisir';
      priceCell.appendChild(source);
      tr.appendChild(priceCell);

      const high = doc.createElement('td');
      high.className = 'kmc-ready-price-bound';
      high.textContent = formatAmount(row.corridor?.high, currency);
      tr.appendChild(high);

      const statusCell = doc.createElement('td');
      const badge = doc.createElement('span');
      badge.className = statusClass(row.decision_state);
      badge.textContent = row.decision_state?.label || 'À examiner';
      statusCell.appendChild(badge);
      const evidence = doc.createElement('small');
      evidence.className = 'kmc-ready-evidence';
      evidence.textContent = row.local_price_active
        ? 'LOCAL_ACTIVE'
        : `${Number(row.corridor?.sample_count || 0)} preuve(s) · ${row.corridor?.viability_label || 'viabilité à vérifier'}`;
      statusCell.appendChild(evidence);
      tr.appendChild(statusCell);

      const actionCell = doc.createElement('td');
      const button = doc.createElement('button');
      button.type = 'button';
      button.className = 'kmc-workspace-action';
      button.textContent = row.local_price_active ? 'Exposer maintenant' : 'Mettre en vente';
      button.disabled = !row.can_approve || row.decision_state?.key === 'BLOCKED'
        || (!row.local_price_active && !(number(input.value) > 0));
      actionCell.appendChild(button);
      tr.appendChild(actionCell);

      const original = row.proposed_price?.amount == null ? '' : String(row.proposed_price.amount);
      input.addEventListener('input', () => {
        const modified = input.value !== original;
        if (row.bulk_eligible) {
          checkbox.disabled = modified;
          checkbox.checked = !modified;
        }
        button.disabled = !row.can_approve || row.decision_state?.key === 'BLOCKED'
          || (!row.local_price_active && !(number(input.value) > 0));
        refreshBulkLabel();
      });
      checkbox.addEventListener('change', refreshBulkLabel);

      button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          await approveOne({ row, amount: input.value, marketCode, request, feedback });
          feedback(`${row.product_name || row.product_ref} · mis en vente.`, 'positive');
          await reload();
        } catch (error) {
          button.disabled = false;
          feedback(`${error.message}${error.code ? ' · ' + error.code : ''}`, 'critical');
        }
      });

      controls.push({ row, checkbox, input });
      tbody.appendChild(tr);
    });

    bulk.addEventListener('click', async () => {
      const selected = controls.filter(control => control.checkbox.checked && !control.checkbox.disabled);
      if (!selected.length) return;
      bulk.disabled = true;
      let success = 0;
      const failures = [];
      for (const control of selected) {
        try {
          feedback(`Mise en vente ${success + failures.length + 1}/${selected.length} · ${control.row.product_ref}…`);
          await approveOne({ row: control.row, amount: control.input.value, marketCode, request, feedback });
          success += 1;
        } catch (error) {
          failures.push({ ref: control.row.product_ref, message: error.message });
        }
      }
      feedback(
        failures.length
          ? `${success} mis en vente · ${failures.length} à revoir (${failures.map(item => item.ref).join(', ')})`
          : `${success} produit${success > 1 ? 's' : ''} mis en vente.`,
        failures.length ? 'critical' : 'positive'
      );
      await reload();
    });

    table.appendChild(tbody);
    wrap.appendChild(table);
    section.appendChild(wrap);
    host.appendChild(section);
    refreshBulkLabel();
    return section;
  }

  return Object.freeze({ formatAmount, approveOne, render });
});

/**
 * @komerce-arch
 * @role          market-country-price-list-ui
 * @domain        admin-dashboard
 * @layer         ui-workspace
 * @criticality   high
 * @inputs        market_ready_to_sell server projection, live price preview and canonical writers
 * @outputs       market_scoped_pricing_list, deliberate_market_price_activation, exposure_changes
 * @depends       market-ready-to-sell.js, pricing market preview, market-delegation exposure API
 * @db-read       none
 * @db-write      none
 * @doctrine      one_catalog_one_market_price_decision, server_owns_cost_truth, observed_high_is_not_a_cap
 */
'use strict';

(function initMarketCatalogPricingList(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.KomerceMarketCatalogPricingList = api;
})(typeof globalThis !== 'undefined' ? globalThis : null, function createMarketCatalogPricingList() {
  'use strict';

  const format = (value, currency) => {
    if (value == null || value === '' || !Number.isFinite(Number(value))) return '—';
    return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(Number(value)) + (currency ? ' ' + currency : '');
  };
  const numeric = value => value !== '' && value != null && Number.isFinite(Number(value)) && Number(value) > 0
    ? Number(value) : null;

  // Presentation of server warnings only; the authority lives in the server preview and activation gate.
  function priceMessage(preview) {
    if (!preview) return 'Vérification du prix par le moteur requise.';
    if (!preview.can_proceed || preview.below_variable)
      return 'Prix sous le coût variable ou coût non vérifiable : mise en vente refusée.';
    if (preview.requires_market_gate)
      return 'Sous le seuil de sécurité : le gate économique du marché devra autoriser ce prix.';
    if (preview.warnings.includes('SHARP_DROP_FROM_ACTIVE'))
      return 'Baisse inhabituelle depuis le dernier prix actif : vérifiez les chiffres.';
    if (preview.warnings.includes('BELOW_OBSERVED_MARKET'))
      return 'Prix sous le bas de marché observé : vérifiez la saisie.';
    if (preview.warnings.includes('ABOVE_OBSERVED_MARKET'))
      return 'Au-dessus du repère haut : prix autorisé sous réserve des contrôles habituels.';
    return 'Prix vérifié par le moteur.';
  }

  function render({root: host, payload = {}, marketCode, focusedProductRef = null, request, feedback = () => {}, reload = async () => {}} = {}) {
    if (!host || typeof request !== 'function') return null;
    const doc = host.ownerDocument;
    const rows = Array.isArray(payload.ready_to_sell?.items) ? payload.ready_to_sell.items : [];
    const currency = payload.market?.currency || payload.ready_to_sell?.market?.currency || '';
    const caps = new Set(payload.actor_capabilities || []);
    const canDecide = caps.has('pricing.decide') && caps.has('pricing.activate') && caps.has('catalog.expose');
    const canExpose = caps.has('catalog.expose');
    const section = doc.createElement('section');
    section.className = 'kmc-section kmc-market-price-list';
    section.id = 'market-ready-to-sell';
    section.setAttribute('data-market-price-catalog', '');
    const title = doc.createElement('div');
    title.className = 'kmc-price-list-heading';
    title.innerHTML = '<div><h2>Catalogue des prix</h2><p>Un produit, un prix pays, une décision de publication. Le prix haut du marché est un repère, jamais un plafond.</p></div>';
    section.appendChild(title);
    const tools = doc.createElement('div');
    tools.className = 'kmc-price-list-tools';
    const tabs = doc.createElement('div');
    tabs.className = 'kmc-price-list-filters';
    const search = doc.createElement('input');
    search.type = 'search';
    search.placeholder = 'Rechercher un produit…';
    search.setAttribute('aria-label', 'Rechercher un produit dans le catalogue pays');
    search.className = 'kmc-price-list-search';
    tools.appendChild(tabs);
    tools.appendChild(search);
    section.appendChild(tools);
    const viewport = doc.createElement('div');
    viewport.className = 'kmc-price-list-scroll';
    const table = doc.createElement('table');
    table.className = 'kmc-price-list-table';
    table.innerHTML = '<thead><tr><th>Produit</th><th>Rendu relais</th><th>Coût variable</th><th>Repères marché</th><th>Notre prix</th><th>Contribution</th><th>Publication</th></tr></thead>';
    const tbody = doc.createElement('tbody');
    table.appendChild(tbody);
    viewport.appendChild(table);
    section.appendChild(viewport);
    const empty = doc.createElement('p');
    empty.className = 'kmc-price-list-empty';
    empty.hidden = true;
    section.appendChild(empty);
    const filterLabels = [
      ['all', 'Tous'], ['missing', 'À tarifer'], ['published', 'Publiés'], ['attention', 'À vérifier']
    ];
    let currentFilter = 'all';
    const filterButtons = [];
    let focused = null;

    const matches = row => {
      const state = row.decision_state?.key || '';
      const isPublished = Boolean(row.local_price_active && row.exposure_enabled);
      const missing = !row.local_price_active && row.proposed_price?.source === 'NONE';
      const attention = state === 'BLOCKED' || state === 'REVIEW' || row.blocker != null;
      const filterMatch = currentFilter === 'all' || (currentFilter === 'missing' && missing)
        || (currentFilter === 'published' && isPublished) || (currentFilter === 'attention' && attention);
      const query = search.value.trim().toLocaleLowerCase('fr');
      return filterMatch && (!query || String(row.product_name || '').toLocaleLowerCase('fr').includes(query)
        || String(row.product_ref || '').toLocaleLowerCase('fr').includes(query));
    };
    function applyFilter() {
      let visible = 0;
      Array.from(tbody.children).forEach(tr => {
        const ref = tr.getAttribute('data-product-ref');
        const row = rows.find(r => r.product_ref === ref);
        tr.hidden = !row || !matches(row);
        if (!tr.hidden) visible++;
      });
      empty.hidden = visible !== 0;
      empty.textContent = rows.length ? 'Aucun produit avec ces filtres.' : 'Aucun produit à tarifer sur ce marché.';
      filterButtons.forEach(button => {
        const selected = button.dataset.filter === currentFilter;
        button.setAttribute('aria-pressed', String(selected));
      });
    }
    filterLabels.forEach(([key, label]) => {
      const button = doc.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.dataset.filter = key;
      button.className = 'kmc-price-list-filter';
      button.addEventListener('click', () => {currentFilter = key; applyFilter();});
      tabs.appendChild(button);
      filterButtons.push(button);
    });
    search.addEventListener('input', applyFilter);

    rows.forEach(row => {
      const tr = doc.createElement('tr');
      tr.dataset.productRef = row.product_ref || '';
      tr.setAttribute('data-product-ref', row.product_ref || '');
      if (focusedProductRef && row.product_ref === focusedProductRef) {
        tr.classList.add('is-context-target');
        tr.setAttribute('tabindex', '-1');
        focused = tr;
      }
      const td = (value, className = '') => {
        const cell = doc.createElement('td');
        if (className) cell.className = className;
        if (value != null) cell.textContent = String(value);
        tr.appendChild(cell);
        return cell;
      };
      const product = td(null, 'kmc-price-product');
      const productLine = doc.createElement('div');
      productLine.className = 'kmc-price-product-line';
      if (row.image_url) {
        const image = doc.createElement('img');
        image.src = row.image_url;
        image.loading = 'lazy';
        image.alt = '';
        image.width = 48;
        image.height = 48;
        productLine.appendChild(image);
      }
      const identity = doc.createElement('div');
      const name = doc.createElement('strong');
      name.textContent = row.product_name || row.product_ref || 'Produit';
      identity.appendChild(name);
      const ref = doc.createElement('small');
      ref.textContent = [row.product_ref, row.category].filter(Boolean).join(' · ');
      identity.appendChild(ref);
      productLine.appendChild(identity);
      product.appendChild(productLine);

      const landed = td(null, 'kmc-price-readonly');
      landed.appendChild(doc.createTextNode(format(row.landed_relay_cost_local, currency)));
      const landedInfo = doc.createElement('small');
      landedInfo.textContent = row.landed_relay_cost_local == null ? 'À estimer' : 'Estimation du moteur';
      landed.appendChild(landedInfo);

      const cost = td(null, 'kmc-price-readonly');
      cost.appendChild(doc.createTextNode(format(row.variable_cost_local, currency)));
      const costInfo = doc.createElement('small');
      costInfo.textContent = row.variable_cost_local == null ? 'Coût non établi' : 'Sans charges fixes';
      cost.appendChild(costInfo);

      const marketCell = td(null, 'kmc-price-market');
      const low = row.corridor?.low;
      const high = row.corridor?.high;
      const target = row.corridor?.target;
      const line = doc.createElement('strong');
      line.textContent = low != null && high != null
        ? format(low, currency) + ' – ' + format(high, currency)
        : 'Non établi';
      marketCell.appendChild(line);
      const hint = doc.createElement('small');
      hint.textContent = target != null ? 'Cible ' + format(target, currency)
        : 'Pas de repère local confirmé';
      marketCell.appendChild(hint);

      const priceCell = td(null, 'kmc-price-edit');
      const input = doc.createElement('input');
      input.type = 'number';
      input.min = '0';
      input.step = 'any';
      input.placeholder = 'Prix à définir';
      input.value = row.proposed_price?.amount == null ? '' : String(row.proposed_price.amount);
      input.setAttribute('aria-label', 'Prix local ' + (row.product_name || row.product_ref) + ' en ' + currency);
      input.disabled = !canDecide || row.decision_state?.key === 'BLOCKED';
      priceCell.appendChild(input);
      const priceNote = doc.createElement('small');
      priceCell.appendChild(priceNote);
      const contribution = td('—', 'kmc-price-contribution');
      const contributionNote = doc.createElement('small');
      contributionNote.textContent = 'Estimation moteur';
      contribution.appendChild(contributionNote);
      const action = td(null, 'kmc-price-action');
      const button = doc.createElement('button');
      button.type = 'button';
      button.className = 'kmc-workspace-action kmc-price-action-button';
      action.appendChild(button);
      const actionNote = doc.createElement('small');
      action.appendChild(actionNote);
      const detail = doc.createElement('button');
      detail.type = 'button';
      detail.className = 'kmc-price-detail-toggle';
      detail.textContent = 'Détail du coût';
      product.appendChild(detail);
      const detailBox = doc.createElement('div');
      detailBox.className = 'kmc-price-detail-box';
      detailBox.hidden = true;
      detailBox.textContent = 'Coût rendu relais : ' + format(row.landed_relay_cost_local, currency) +
        ' · coût variable complet : ' + format(row.variable_cost_local, currency) +
        ' · aucune charge fixe de structure ajoutée au produit.';
      product.appendChild(detailBox);
      detail.addEventListener('click', () => {
        detailBox.hidden = !detailBox.hidden;
        detail.textContent = detailBox.hidden ? 'Détail du coût' : 'Masquer le détail';
      });

      let preview = null;
      let previewAmount = null;
      let acknowledgedAmount = null;
      let timer = null;
      let busy = false;
      const activePrice = numeric(row.local_price_active ? row.proposed_price?.amount : null);
      const activeAndExposed = row.local_price_active && row.exposure_enabled;
      const initialContribution = row.proposed_price?.amount != null && row.variable_cost_local != null
        ? Number(row.proposed_price.amount) - Number(row.variable_cost_local) : null;
      // Initially, only server-projected amounts are displayed; changes require a fresh server preview.
      if (initialContribution != null) contribution.firstChild.textContent = format(initialContribution, currency);
      function updateAction() {
        const entered = numeric(input.value);
        const sameActive = row.local_price_active && activePrice === entered;
        const changedActive = row.local_price_active && activePrice !== entered;
        const validPreview = preview && previewAmount === entered;
        const blockedByCost = validPreview && preview.can_proceed !== true;
        const warningPending = validPreview && preview.requires_acknowledgement && acknowledgedAmount !== entered;
        button.disabled = busy || (!row.local_price_active && !canDecide)
          || (row.local_price_active && !canExpose && !canDecide)
          || row.decision_state?.key === 'BLOCKED' || entered == null || blockedByCost;
        if (changedActive) {
          // The old writer turns LOCAL_ACTIVE into a DRAFT before reactivation.
          // Do not silently break an active buyer price until an atomic repricing writer exists.
          button.disabled = true;
          button.textContent = 'Prix actif';
          actionNote.textContent = 'Modification du prix actif non disponible sans transition atomique.';
        } else if (sameActive && activeAndExposed) {
          button.textContent = 'Masquer';
          button.disabled = !canExpose || busy;
          actionNote.textContent = 'Prix actif';
        } else if (sameActive && !row.exposure_enabled) {
          button.textContent = 'Publier';
          button.disabled = !canExpose || busy;
          actionNote.textContent = 'Prix actif · catalogue masqué';
        } else {
          button.textContent = warningPending ? 'Confirmer ce prix' : 'Mettre en vente';
          actionNote.textContent = warningPending ? 'Prix inhabituel : validation explicite' : 'Activation contrôlée';
        }
      }
      function showPreview(result, entered) {
        preview = result;
        previewAmount = entered;
        contribution.firstChild.textContent = result.contribution_local == null
          ? '—' : format(result.contribution_local, currency);
        contribution.classList.toggle('is-negative', result.below_variable === true);
        priceNote.textContent = priceMessage(result);
        priceNote.className = result.below_variable ? 'is-danger'
          : result.requires_acknowledgement || result.requires_market_gate ? 'is-warning' : '';
        updateAction();
      }
      async function requestPreview() {
        const entered = numeric(input.value);
        if (entered == null) { priceNote.textContent = 'Saisir un montant positif.'; updateAction(); return; }
        if (row.local_price_active && activePrice === entered) {updateAction(); return;}
        priceNote.textContent = 'Vérification économique…';
        try {
          const result = await request('/api/admin/workspaces/pricing/market/' +
            encodeURIComponent(marketCode) + '/products/' + encodeURIComponent(row.product_ref) +
            '/local-price/price-preview', {method: 'POST', body: {amount: entered}});
          if (numeric(input.value) === entered) showPreview(result, entered);
        } catch (error) {
          if (numeric(input.value) !== entered) return;
          preview = null;
          previewAmount = null;
          priceNote.textContent = 'Coût ou prix non vérifiable : ' + error.message;
          button.disabled = true;
        }
      }
      input.addEventListener('input', () => {
        if (timer) clearTimeout(timer);
        preview = null;
        previewAmount = null;
        acknowledgedAmount = null;
        priceNote.textContent = 'À vérifier';
        contribution.firstChild.textContent = '—';
        updateAction();
        timer = setTimeout(requestPreview, 400);
      });
      input.addEventListener('blur', () => {
        if (timer) clearTimeout(timer);
        if (!row.local_price_active || numeric(input.value) !== activePrice) requestPreview();
      });
      button.addEventListener('click', async () => {
        if (busy) return;
        const entered = numeric(input.value);
        if (row.local_price_active && entered === activePrice && activeAndExposed) {
          busy = true; updateAction();
          try {
            await request('/api/market-delegation/markets/' + encodeURIComponent(marketCode) +
              '/catalog/exposure/' + encodeURIComponent(row.product_id),
              {method: 'PUT', body: {commercial_exposure: 'DISABLED'}});
            feedback(row.product_ref + ' · masqué.', 'positive');
            await reload();
          } catch (error) {feedback(error.message, 'critical');busy=false;updateAction();}
          return;
        }
        if (row.local_price_active && entered === activePrice && !row.exposure_enabled) {
          busy = true; updateAction();
          try {
            await root.KomerceMarketReadyToSell.approveOne({row, amount: entered, marketCode, request, feedback});
            feedback(row.product_ref + ' · publié.', 'positive');
            await reload();
          } catch (error) {feedback(error.message, 'critical');busy=false;updateAction();}
          return;
        }
        if (!canDecide || entered == null || row.local_price_active) return;
        if (!preview || previewAmount !== entered) await requestPreview();
        if (!preview || previewAmount !== entered || !preview.can_proceed) return;
        if (preview.requires_acknowledgement && acknowledgedAmount !== entered) {
          acknowledgedAmount = entered;
          priceNote.textContent = 'Prix atypique confirmé ? Cliquez à nouveau pour mettre en vente.';
          updateAction();
          return;
        }
        busy = true; updateAction();
        try {
          await root.KomerceMarketReadyToSell.approveOne({row, amount: entered, marketCode, request, feedback});
          feedback(row.product_ref + ' · prix activé, produit publié.', 'positive');
          await reload();
        } catch (error) {feedback(error.message + (error.code ? ' · ' + error.code : ''), 'critical');busy=false;updateAction();}
      });
      updateAction();
      tbody.appendChild(tr);
    });
    applyFilter();
    host.appendChild(section);
    if (focused) {
      feedback(focusedProductRef + ' · suite commerciale retrouvée sur ' + marketCode + '.', 'positive');
      if (typeof focused.scrollIntoView === 'function') focused.scrollIntoView({block:'center',behavior:'smooth'});
      if (typeof focused.focus === 'function') focused.focus({preventScroll:true});
    }
    return section;
  }

  return Object.freeze({ format, priceMessage, render });
});

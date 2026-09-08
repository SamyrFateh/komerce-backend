/**
 * @komerce-arch
 * @role          canonical-pricing-decision-chain-ui
 * @domain        admin-dashboard
 * @layer         ui-orchestration
 * @criticality   high
 * @inputs        server_market_corridor_projection, server_market_decision_projection, pricing_workspace_projection
 * @outputs       readable_economic_decision_chain_dom, authorized_local_price_and_observation_requests
 * @depends       public/dashboards/canonical/js/pricing-workspace.js
 * @used-by       public/dashboards/canonical/index.html
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      workspace_acts_dashboard_observes, browser_never_recomputes_economic_truth, market_bounds_possible_human_decides, local_evidence_never_silently_falls_back_to_global
 * @impact-areas  admin-dashboard, pricing, economic-engine, market-autonomy
 * @version       2026-09
 */

'use strict';

(function initPricingDecisionChain(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (!root) return;
  root.KomercePricingDecisionChain = api;
  api.install(root);
})(typeof globalThis !== 'undefined' ? globalThis : null, function createPricingDecisionChain() {
  const PANEL_ATTR = 'pricingDecisionChain';

  function el(doc, tag, className, value) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (value != null) node.textContent = String(value);
    return node;
  }

  function formatNumber(value, digits = 0) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: digits }).format(n);
  }

  function formatKmf(value) {
    return value == null || !Number.isFinite(Number(value)) ? '—' : `${formatNumber(value)} KMF`;
  }

  function formatMoney(amount, currency) {
    if (amount == null || !Number.isFinite(Number(amount))) return '—';
    return `${formatNumber(amount, 2)} ${currency || ''}`.trim();
  }

  function formatRatio(workspace, value) {
    return workspace && typeof workspace.formatPercentRatio === 'function'
      ? workspace.formatPercentRatio(value)
      : '—';
  }

  function formatDate(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' }).format(date);
  }

  function findWorkshop(rootNode) {
    return rootNode.querySelector('[data-pricing-workshop-enhanced]') || Array.from(rootNode.querySelectorAll('.kmc-section')).find(section => {
      const title = section.querySelector('.kmc-section-title');
      return title && title.textContent.trim() === 'Atelier des coûts';
    }) || null;
  }

  function step(doc, key, label, value, helper, tone = 'neutral') {
    const card = el(doc, 'div', `kmc-decision-chain-step is-${tone}`);
    card.dataset.decisionChainStep = key;
    card.appendChild(el(doc, 'span', 'kmc-decision-chain-step-label', label));
    card.appendChild(el(doc, 'strong', 'kmc-decision-chain-step-value', value));
    if (helper) card.appendChild(el(doc, 'small', 'kmc-decision-chain-step-helper', helper));
    return card;
  }

  function arrow(doc) {
    return el(doc, 'span', 'kmc-decision-chain-arrow', '→');
  }

  function observedPoint(doc, label, point, currency) {
    const card = el(doc, 'div', 'kmc-decision-chain-corridor-point');
    card.appendChild(el(doc, 'span', '', label));
    if (!point) {
      card.appendChild(el(doc, 'strong', '', '—'));
      return card;
    }
    const local = formatMoney(point.observed_amount, point.currency || currency);
    card.appendChild(el(doc, 'strong', '', local));
    if ((point.currency || currency) !== 'KMF') card.appendChild(el(doc, 'small', '', `≈ ${formatKmf(point.price_kmf)} · conversion serveur`));
    if (point.competitor_name) card.appendChild(el(doc, 'small', '', point.competitor_name));
    return card;
  }

  function corridorBlock(doc, corridor) {
    const block = el(doc, 'div', 'kmc-decision-chain-corridor');
    const local = corridor?.corridor?.local || {};
    const currency = corridor?.market?.currency || 'KMF';
    const head = el(doc, 'div', 'kmc-decision-chain-corridor-head');
    head.appendChild(el(doc, 'span', 'kmc-decision-chain-step-label', 'Bornes marché observées'));
    head.appendChild(el(doc, 'small', '', `${formatNumber(local.sample_count)} observation${Number(local.sample_count) > 1 ? 's' : ''} · confiance ${local.confidence || '—'}`));
    block.appendChild(head);

    if (!local.sample_count) {
      block.appendChild(el(doc, 'div', 'kmc-decision-chain-missing', 'Aucune observation locale : le moteur ne transforme pas la référence globale en corridor pays.'));
    } else {
      const points = el(doc, 'div', 'kmc-decision-chain-corridor-points');
      points.appendChild(observedPoint(doc, 'Basse', local.low, currency));
      points.appendChild(observedPoint(doc, 'Cible observée', local.target, currency));
      points.appendChild(observedPoint(doc, 'Haute', local.high, currency));
      block.appendChild(points);
    }

    const global = corridor?.corridor?.global_reference || {};
    const details = doc.createElement('details');
    details.className = 'kmc-decision-chain-reference';
    details.appendChild(el(doc, 'summary', '', `Référence globale informative · ${formatNumber(global.sample_count)} observation${Number(global.sample_count) > 1 ? 's' : ''}`));
    const body = el(doc, 'div', 'kmc-decision-chain-corridor-points');
    body.appendChild(observedPoint(doc, 'Basse', global.low, 'KMF'));
    body.appendChild(observedPoint(doc, 'Cible', global.target, 'KMF'));
    body.appendChild(observedPoint(doc, 'Haute', global.high, 'KMF'));
    details.appendChild(body);
    details.appendChild(el(doc, 'p', 'kmc-decision-chain-note', corridor?.corridor?.rule || 'Référence informative uniquement.'));
    block.appendChild(details);
    return block;
  }

  function selectedPriceBlock(doc, corridor, canManage) {
    const selected = corridor?.selected || {};
    const economics = selected.economics || {};
    const block = el(doc, 'div', 'kmc-decision-chain-selected');
    const current = el(doc, 'div', 'kmc-decision-chain-selected-main');
    current.appendChild(el(doc, 'span', 'kmc-decision-chain-step-label', 'Prix retenu · acheteur effectif'));
    current.appendChild(el(doc, 'strong', 'kmc-decision-chain-selected-price', selected.local_amount != null
      ? formatMoney(selected.local_amount, selected.local_currency)
      : formatKmf(selected.price_kmf)));
    if (selected.local_amount != null && selected.local_currency !== 'KMF') current.appendChild(el(doc, 'small', '', `≈ ${formatKmf(selected.price_kmf)} · conversion serveur`));
    current.appendChild(el(doc, 'small', '', selected.source === 'LOCAL_ACTIVE' ? 'Décision pays active' : 'Base catalogue actuellement effective'));
    block.appendChild(current);

    const candidate = corridor?.candidate || null;
    if (candidate && !candidate.buyer_effective) {
      const draft = el(doc, 'div', 'kmc-decision-chain-candidate');
      draft.appendChild(el(doc, 'span', 'kmc-decision-chain-step-label', 'Décision locale en attente'));
      draft.appendChild(el(doc, 'strong', '', formatMoney(candidate.amount, candidate.currency)));
      if (candidate.currency !== 'KMF') draft.appendChild(el(doc, 'small', '', `≈ ${formatKmf(candidate.price_kmf)} · conversion serveur`));
      draft.appendChild(el(doc, 'small', '', `Contribution unitaire scénario : ${formatKmf(candidate.economics?.contribution_unit_kmf)} · position ${candidate.economics?.strategy_risk || '—'}`));
      if (canManage) {
        const activate = el(doc, 'button', 'kmc-workspace-action kmc-decision-chain-activate', 'Vérifier le gate et activer');
        activate.type = 'button';
        activate.dataset.activateLocalPrice = corridor.product?.product_ref || '';
        draft.appendChild(activate);
      }
      block.appendChild(draft);
    }

    if (canManage) {
      const details = doc.createElement('details');
      details.className = 'kmc-decision-chain-price-editor';
      details.appendChild(el(doc, 'summary', '', 'Décider un prix local'));
      const form = doc.createElement('form');
      form.dataset.localPriceForm = corridor.product?.product_ref || '';
      form.className = 'kmc-decision-chain-inline-form';
      const amount = doc.createElement('input');
      amount.name = 'amount';
      amount.type = 'number';
      amount.min = '0.01';
      amount.step = '0.01';
      amount.required = true;
      amount.placeholder = `Prix ${corridor.market?.currency || ''}`.trim();
      const reason = doc.createElement('input');
      reason.name = 'reason';
      reason.required = true;
      reason.minLength = 3;
      reason.placeholder = 'Pourquoi ce prix ?';
      const submit = el(doc, 'button', 'kmc-workspace-action', 'Enregistrer la décision');
      submit.type = 'submit';
      form.appendChild(amount);
      form.appendChild(reason);
      form.appendChild(submit);
      details.appendChild(form);
      block.appendChild(details);
    }

    block.dataset.selectedContribution = economics.contribution_unit_kmf == null ? '' : String(economics.contribution_unit_kmf);
    return block;
  }

  function flowBlock(doc, workspace, decision) {
    const flow = decision?.flow_break_even || {};
    const mix = flow.observed_mix || {};
    const state = flow.economic_state || {};
    const block = el(doc, 'div', 'kmc-decision-chain-period');
    block.appendChild(el(doc, 'span', 'kmc-decision-chain-period-kicker', 'FLUX DE PÉRIODE · RÉEL RÉCONCILIÉ'));
    block.appendChild(el(doc, 'p', 'kmc-decision-chain-note', 'La partie unitaire ci-dessus éclaire la décision courante. Les chiffres ci-dessous décrivent le flux réellement réconcilié de la fenêtre canonique ; le navigateur ne les multiplie pas entre eux.'));

    const mixGrid = el(doc, 'div', 'kmc-decision-chain-mix');
    mixGrid.appendChild(step(doc, 'mix-articles', 'Articles', formatNumber(mix.article_units), `Contribution moyenne ${formatKmf(mix.contribution_per_article_kmf)}`, 'derived'));
    mixGrid.appendChild(step(doc, 'mix-orders', 'Commandes matures', formatNumber(mix.mature_orders), `Vue agrégée · ${formatKmf(mix.contribution_per_order_kmf)}`, 'derived'));
    mixGrid.appendChild(step(doc, 'mix-parcels', 'Colis', formatNumber(mix.parcels), `Vue agrégée · ${formatKmf(mix.contribution_per_parcel_kmf)}`, 'derived'));
    block.appendChild(mixGrid);

    const result = el(doc, 'div', 'kmc-decision-chain-result');
    result.appendChild(step(doc, 'period-contribution', 'Contribution totale', formatKmf(state.period_contribution_kmf), 'Pool unique réconcilié', 'positive'));
    result.appendChild(arrow(doc));
    result.appendChild(step(doc, 'period-structure', 'Charges à couvrir', formatKmf(state.period_n3_kmf), 'Structure de période', 'fixed'));
    result.appendChild(arrow(doc));
    result.appendChild(step(doc, 'period-coverage', 'Couverture', formatRatio(workspace, state.coverage_ratio), 'Contribution ÷ structure · calcul serveur', 'derived'));
    result.appendChild(arrow(doc));
    result.appendChild(step(doc, 'period-result', 'Résultat de période', formatKmf(state.period_result_kmf), 'Contribution − structure · calcul serveur', Number(state.period_result_kmf) >= 0 ? 'positive' : 'warning'));
    block.appendChild(result);
    return block;
  }

  function observationsBlock(doc, corridor, canManage) {
    const rows = corridor?.corridor?.local?.observations || [];
    const details = doc.createElement('details');
    details.className = 'kmc-decision-chain-observations';
    details.appendChild(el(doc, 'summary', '', `Observations marché · ${rows.length}`));
    if (!rows.length) {
      details.appendChild(el(doc, 'div', 'kmc-decision-chain-missing', 'Aucune observation pays enregistrée pour ce produit.'));
    } else {
      const list = el(doc, 'div', 'kmc-decision-chain-observation-list');
      rows.forEach(row => {
        const item = el(doc, 'div', 'kmc-decision-chain-observation');
        const copy = el(doc, 'div', '');
        copy.appendChild(el(doc, 'strong', '', `${row.competitor_name || 'Concurrent'} · ${formatMoney(row.observed_amount, row.currency)}`));
        copy.appendChild(el(doc, 'small', '', `${formatDate(row.observed_at)} · ${row.source || 'source non renseignée'} · ${row.observation_ref || '—'}`));
        item.appendChild(copy);
        if (canManage && row.observation_ref) {
          const remove = el(doc, 'button', 'kmc-workspace-action is-secondary', 'Retirer du corridor');
          remove.type = 'button';
          remove.dataset.deactivateObservation = row.observation_ref;
          item.appendChild(remove);
        }
        list.appendChild(item);
      });
      details.appendChild(list);
    }

    if (canManage) {
      const form = doc.createElement('form');
      form.className = 'kmc-decision-chain-observation-form';
      form.dataset.marketObservationForm = corridor.product?.product_ref || '';
      const competitor = doc.createElement('input');
      competitor.name = 'competitor_name';
      competitor.required = true;
      competitor.placeholder = 'Concurrent / enseigne';
      const amount = doc.createElement('input');
      amount.name = 'amount';
      amount.type = 'number';
      amount.min = '0.01';
      amount.step = '0.01';
      amount.required = true;
      amount.placeholder = `Prix observé ${corridor.market?.currency || ''}`.trim();
      const notes = doc.createElement('input');
      notes.name = 'notes';
      notes.placeholder = 'Source / contexte';
      const submit = el(doc, 'button', 'kmc-workspace-action is-secondary', 'Ajouter l’observation');
      submit.type = 'submit';
      form.appendChild(competitor);
      form.appendChild(amount);
      form.appendChild(notes);
      form.appendChild(submit);
      details.appendChild(form);
    }
    return details;
  }

  function renderLoaded(doc, workspace, host, corridor, decision, payload, options) {
    host.replaceChildren();
    const canManage = payload.capabilities?.local_strategy_owner === true;
    const economics = corridor?.selected?.economics || {};

    const unitHead = el(doc, 'div', 'kmc-decision-chain-unit-head');
    unitHead.appendChild(el(doc, 'span', 'kmc-decision-chain-period-kicker', `DÉCISION UNITAIRE · ${corridor.product?.product_ref || ''}`));
    unitHead.appendChild(el(doc, 'strong', '', corridor.product?.name || 'Produit'));
    unitHead.appendChild(el(doc, 'p', 'kmc-decision-chain-note', 'Le moteur calcule les frontières économiques. Le terrain renseigne le marché. Le responsable pays décide le prix ; le système contrôle ensuite les gates.'));
    host.appendChild(unitHead);

    const unit = el(doc, 'div', 'kmc-decision-chain-unit');
    unit.appendChild(step(doc, 'purchase', 'Coût d’achat', formatKmf(corridor.product?.purchase_cost_kmf), 'Donnée produit / fournisseur', 'neutral'));
    unit.appendChild(arrow(doc));
    unit.appendChild(step(doc, 'variable', 'Coût variable complet', formatKmf(economics.variable_cost_complete_kmf), 'Frontière économique marginale · moteur serveur', 'variable'));
    unit.appendChild(arrow(doc));
    unit.appendChild(corridorBlock(doc, corridor));
    unit.appendChild(arrow(doc));
    unit.appendChild(selectedPriceBlock(doc, corridor, canManage));
    unit.appendChild(arrow(doc));
    unit.appendChild(step(doc, 'unit-contribution', 'Contribution unitaire', formatKmf(economics.contribution_unit_kmf), `Position ${economics.strategy_risk || '—'} · moteur serveur`, Number(economics.contribution_unit_kmf) >= 0 ? 'positive' : 'critical'));
    host.appendChild(unit);

    if (decision?.flow_break_even?.status === 'READY' && decision.flow_break_even.economic_state) {
      host.appendChild(flowBlock(doc, workspace, decision));
    } else {
      const reason = decision?.flow_break_even?.reason || decision?.reason || 'La vérité de période n’est pas encore décisionnelle.';
      host.appendChild(el(doc, 'div', 'kmc-decision-chain-missing', `Flux de période indisponible : ${reason}`));
    }
    host.appendChild(observationsBlock(doc, corridor, canManage));
  }

  async function fetchChain(workspace, options, productRef) {
    const endpoint = workspace.endpointFor({ requestedMarket: options.requestedMarket });
    const [corridor, decision] = await Promise.all([
      workspace.jsonRequest(options.fetch, `${endpoint}/corridor?product_ref=${encodeURIComponent(productRef)}`),
      workspace.jsonRequest(options.fetch, `${endpoint}/decision`),
    ]);
    return { corridor, decision };
  }

  function createPanel(doc, payload) {
    const panel = el(doc, 'section', 'kmc-decision-chain');
    panel.dataset[PANEL_ATTR] = '';
    const head = el(doc, 'div', 'kmc-decision-chain-head');
    const copy = el(doc, 'div', '');
    copy.appendChild(el(doc, 'span', 'kmc-decision-chain-kicker', 'CHAÎNE DE DÉCISION ÉCONOMIQUE · VÉRITÉ SERVEUR'));
    copy.appendChild(el(doc, 'h3', 'kmc-decision-chain-title', 'Du coût réel à la viabilité du marché'));
    copy.appendChild(el(doc, 'p', 'kmc-decision-chain-note', 'Une lecture causale, pas une addition opaque : coûts variables → marché → prix décidé → contribution → flux → couverture de la structure.'));
    head.appendChild(copy);

    const select = doc.createElement('select');
    select.className = 'kmc-decision-chain-product';
    select.dataset.decisionChainProduct = '';
    select.setAttribute('aria-label', 'Produit à analyser');
    const placeholder = doc.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Choisir un produit…';
    select.appendChild(placeholder);
    (payload.simulation_products || []).forEach(product => {
      const option = doc.createElement('option');
      option.value = product.product_ref;
      option.textContent = `${product.product_ref} · ${product.name || product.category || 'Produit'}`;
      select.appendChild(option);
    });
    head.appendChild(select);
    panel.appendChild(head);

    const host = el(doc, 'div', 'kmc-decision-chain-host');
    host.dataset.decisionChainHost = '';
    host.appendChild(el(doc, 'div', 'kmc-decision-chain-empty', 'Choisissez un produit pour lire sa chaîne économique dans ce marché.'));
    panel.appendChild(host);
    return panel;
  }

  async function loadSelected(rootObject, workspace, options, payload, panel, productRef) {
    const host = panel.querySelector('[data-decision-chain-host]');
    if (!host || !productRef) return;
    host.replaceChildren(el(options.document, 'div', 'kmc-decision-chain-empty', 'Lecture des vérités serveur…'));
    try {
      const { corridor, decision } = await fetchChain(workspace, options, productRef);
      panel.__decisionChainCurrent = { productRef, corridor, decision };
      renderLoaded(options.document, workspace, host, corridor, decision, payload, options);
    } catch (error) {
      host.replaceChildren(el(options.document, 'div', 'kmc-decision-chain-missing', `Chaîne indisponible : ${error.message}`));
    }
  }

  function bindPanel(rootObject, workspace, options, payload, panel) {
    panel.addEventListener('change', event => {
      if (!event.target.matches('[data-decision-chain-product]')) return;
      loadSelected(rootObject, workspace, options, payload, panel, event.target.value);
    });

    panel.addEventListener('submit', async event => {
      if (event.target.matches('[data-market-observation-form]')) {
        event.preventDefault();
        const form = event.target;
        const data = new FormData(form);
        const productRef = form.dataset.marketObservationForm;
        const endpoint = workspace.endpointFor({ requestedMarket: options.requestedMarket });
        try {
          await workspace.jsonRequest(options.fetch, `${endpoint}/price-observations`, {
            method: 'POST',
            body: {
              product_ref: productRef,
              competitor_name: data.get('competitor_name'),
              amount: Number(data.get('amount')),
              notes: data.get('notes') || null,
              source: 'market_manager',
            },
          });
          await loadSelected(rootObject, workspace, options, payload, panel, productRef);
        } catch (error) {
          const host = panel.querySelector('[data-decision-chain-host]');
          host?.prepend(el(options.document, 'div', 'kmc-decision-chain-missing', `Observation refusée : ${error.message}`));
        }
        return;
      }

      if (event.target.matches('[data-local-price-form]')) {
        event.preventDefault();
        const form = event.target;
        const data = new FormData(form);
        const productRef = form.dataset.localPriceForm;
        const endpoint = workspace.endpointFor({ requestedMarket: options.requestedMarket });
        try {
          await workspace.jsonRequest(options.fetch, `${endpoint}/products/${encodeURIComponent(productRef)}/local-price`, {
            method: 'POST',
            body: {
              amount: Number(data.get('amount')),
              reason: data.get('reason'),
              source: 'market_manager_decision_chain',
            },
          });
          await loadSelected(rootObject, workspace, options, payload, panel, productRef);
        } catch (error) {
          const host = panel.querySelector('[data-decision-chain-host]');
          host?.prepend(el(options.document, 'div', 'kmc-decision-chain-missing', `Décision refusée : ${error.message}`));
        }
      }
    });

    panel.addEventListener('click', async event => {
      const remove = event.target.closest('[data-deactivate-observation]');
      if (remove) {
        const current = panel.__decisionChainCurrent;
        if (!current?.productRef) return;
        const endpoint = workspace.endpointFor({ requestedMarket: options.requestedMarket });
        try {
          await workspace.jsonRequest(options.fetch, `${endpoint}/price-observations/${encodeURIComponent(remove.dataset.deactivateObservation)}/deactivate`, {
            method: 'POST',
            body: { reason: 'Retirée du corridor depuis la chaîne de décision.' },
          });
          await loadSelected(rootObject, workspace, options, payload, panel, current.productRef);
        } catch (error) {
          const host = panel.querySelector('[data-decision-chain-host]');
          host?.prepend(el(options.document, 'div', 'kmc-decision-chain-missing', `Retrait refusé : ${error.message}`));
        }
        return;
      }

      const activate = event.target.closest('[data-activate-local-price]');
      if (activate) {
        const productRef = activate.dataset.activateLocalPrice;
        const endpoint = workspace.endpointFor({ requestedMarket: options.requestedMarket });
        try {
          await workspace.jsonRequest(options.fetch, `${endpoint}/products/${encodeURIComponent(productRef)}/local-price/activate`, {
            method: 'POST',
            body: {
              reason: 'Activation depuis la chaîne de décision après contrôle du gate serveur.',
              source: 'market_manager_decision_chain',
            },
          });
          await loadSelected(rootObject, workspace, options, payload, panel, productRef);
        } catch (error) {
          const host = panel.querySelector('[data-decision-chain-host]');
          host?.prepend(el(options.document, 'div', 'kmc-decision-chain-missing', `Activation refusée : ${error.message}`));
        }
      }
    });
  }

  function enhance(rootObject, workspace, options, payload) {
    if (!options?.requestedMarket || !options.root || !options.document || !payload) return false;
    if (options.root.querySelector('[data-pricing-decision-chain]')) return true;
    const workshop = findWorkshop(options.root);
    if (!workshop) return false;
    const slot = workshop.querySelector('[data-section-slot]') || workshop.querySelector('.kmc-section-body') || workshop;
    const panel = createPanel(options.document, payload);
    slot.appendChild(panel);
    bindPanel(rootObject, workspace, options, payload, panel);
    return true;
  }

  function install(rootObject) {
    const workspace = rootObject && rootObject.KomerceCanonicalPricingWorkspace;
    if (!workspace || workspace.__decisionChainInstalled || typeof workspace.mount !== 'function') return false;
    const originalMount = workspace.mount.bind(workspace);
    workspace.mount = async function decisionChainAwareMount(options) {
      const payload = await originalMount(options);
      enhance(rootObject, workspace, options, payload);
      return payload;
    };
    workspace.__decisionChainInstalled = true;
    return true;
  }

  return {
    createPanel,
    corridorBlock,
    flowBlock,
    renderLoaded,
    fetchChain,
    enhance,
    install,
  };
});
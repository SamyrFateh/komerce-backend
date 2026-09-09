/**
 * @komerce-arch
 * @role          canonical-pricing-equilibrium-panel
 * @domain        admin-dashboard
 * @layer         ui-presentation
 * @criticality   high
 * @inputs        server_authoritative_market_decision.flow_break_even
 * @outputs       realtime_equilibrium_panel_dom
 * @depends       public/dashboards/canonical/js/pricing-workspace.js
 * @used-by       public/dashboards/canonical/index.html
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      one_contribution_many_views, browser_never_recomputes_economic_truth, derived_values_are_not_editable
 * @impact-areas  admin-dashboard, pricing, economic-engine
 * @version       2026-09
 */

'use strict';

(function initPricingEquilibriumPanel(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (!root) return;
  root.KomercePricingEquilibriumPanel = api;
  api.install(root);
})(typeof globalThis !== 'undefined' ? globalThis : null, function createPricingEquilibriumPanel() {
  const PANEL_ATTR = 'pricingFlowEquilibrium';

  function el(doc, tag, className, value) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (value != null) node.textContent = String(value);
    return node;
  }

  function formatNumber(value, digits = 0) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '—';
    return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: digits }).format(number);
  }

  function formatKmf(value) {
    return value == null || !Number.isFinite(Number(value)) ? '—' : `${formatNumber(value)} KMF`;
  }

  function formatRatioPercent(workspace, value) {
    return workspace && typeof workspace.formatPercentRatio === 'function'
      ? workspace.formatPercentRatio(value)
      : '—';
  }

  const METRIC_ICONS = {
    'charges': { svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v6c0 1.66 3.13 3 7 3s7-1.34 7-3V6"/><path d="M5 12v6c0 1.66 3.13 3 7 3s7-1.34 7-3v-6"/></svg>', tone: 'violet' },
    'contribution': { svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>', tone: 'green' },
    'couverture': { svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 2a10 10 0 0 1 0 20" fill="currentColor" opacity=".2"/></svg>', tone: 'teal' },
    'reste': { svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>', tone: 'red' },
    'moyenne': { svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="12" width="4" height="9" rx="1"/><rect x="10" y="7" width="4" height="14" rx="1"/><rect x="17" y="3" width="4" height="18" rx="1"/></svg>', tone: 'blue' },
  };

  function metric(doc, label, value, helper, tone, iconKey) {
    const card = el(doc, 'div', `kmc-flow-equilibrium-metric is-derived${tone ? ` is-${tone}` : ''}`);
    if (iconKey && METRIC_ICONS[iconKey]) {
      const iconWrap = el(doc, 'div', `kmc-flow-equilibrium-icon is-${METRIC_ICONS[iconKey].tone}`);
      iconWrap.innerHTML = METRIC_ICONS[iconKey].svg;
      card.appendChild(iconWrap);
    }
    card.appendChild(el(doc, 'span', 'kmc-flow-equilibrium-label', label));
    card.appendChild(el(doc, 'strong', 'kmc-flow-equilibrium-value', value));
    if (helper) card.appendChild(el(doc, 'small', 'kmc-flow-equilibrium-helper', helper));
    return card;
  }

  function unitCard(doc, label, value, helper) {
    const card = el(doc, 'div', 'kmc-flow-equilibrium-unit is-derived');
    card.appendChild(el(doc, 'span', 'kmc-flow-equilibrium-unit-label', label));
    card.appendChild(el(doc, 'strong', 'kmc-flow-equilibrium-unit-value', value));
    if (helper) card.appendChild(el(doc, 'small', 'kmc-flow-equilibrium-unit-helper', helper));
    return card;
  }

  function findDecisionSection(rootNode) {
    return Array.from(rootNode.querySelectorAll('.kmc-section')).find(section => {
      const title = section.querySelector('.kmc-section-title');
      return title && title.textContent.trim() === 'Décision marché';
    }) || null;
  }

  function appendUnitTriplet(doc, host, values, suffix) {
    host.appendChild(unitCard(doc, 'Articles', values.articles == null ? '—' : `≈ ${formatNumber(values.articles)}`, suffix));
    host.appendChild(unitCard(doc, 'Commandes', values.orders == null ? '—' : `≈ ${formatNumber(values.orders)}`, suffix));
    host.appendChild(unitCard(doc, 'Colis', values.parcels == null ? '—' : `≈ ${formatNumber(values.parcels)}`, suffix));
  }

  function buildFlowDetails(doc, flow) {
    const observed = flow.observed_mix || {};
    const target = flow.economic_break_even || {};
    const details = doc.createElement('details');
    details.className = 'kmc-flow-equilibrium-details';
    details.appendChild(el(doc, 'summary', '', 'Voir le détail du flux et des équivalents'));

    const body = el(doc, 'div', 'kmc-flow-equilibrium-details-body');

    const productivity = el(doc, 'div', 'kmc-flow-equilibrium-block');
    productivity.appendChild(el(doc, 'strong', 'kmc-flow-equilibrium-block-title', 'Même contribution · trois lectures du flux'));
    const productGrid = el(doc, 'div', 'kmc-flow-equilibrium-units');
    productGrid.appendChild(unitCard(doc, 'Article', formatKmf(observed.contribution_per_article_kmf), `${formatNumber(observed.article_units)} unités observées`));
    productGrid.appendChild(unitCard(doc, 'Commande', formatKmf(observed.contribution_per_order_kmf), `${formatNumber(observed.mature_orders)} commandes matures`));
    productGrid.appendChild(unitCard(doc, 'Colis', formatKmf(observed.contribution_per_parcel_kmf), `${formatNumber(observed.parcels)} colis observés`));
    productivity.appendChild(productGrid);
    body.appendChild(productivity);

    const remaining = el(doc, 'div', 'kmc-flow-equilibrium-block is-remaining');
    remaining.appendChild(el(doc, 'strong', 'kmc-flow-equilibrium-block-title', 'Reste à produire · au mix réconcilié actuel'));
    const remainingGrid = el(doc, 'div', 'kmc-flow-equilibrium-units');
    appendUnitTriplet(doc, remainingGrid, {
      articles: target.additional_equivalent_articles,
      orders: target.additional_equivalent_orders,
      parcels: target.additional_equivalent_parcels,
    }, 'équivalents supplémentaires');
    remaining.appendChild(remainingGrid);
    remaining.appendChild(el(doc, 'p', 'kmc-flow-equilibrium-rule', 'OU — ces trois nombres traduisent le même gap. Ils ne s’additionnent jamais.'));
    if (target.status === 'CURRENT_MIX_NOT_PROJECTABLE') remaining.appendChild(el(doc, 'p', 'kmc-flow-equilibrium-alert', 'Le mix actuel ne converge pas vers l’équilibre.'));
    body.appendChild(remaining);

    const velocity = flow.flow_velocity || null;
    if (velocity) {
      const cadence = el(doc, 'div', 'kmc-flow-equilibrium-block is-cadence');
      cadence.appendChild(el(doc, 'strong', 'kmc-flow-equilibrium-block-title', `Cadence lissée · fenêtre ${formatNumber(velocity.window_days)} jours`));
      const cadenceGrid = el(doc, 'div', 'kmc-flow-equilibrium-units');
      cadenceGrid.appendChild(unitCard(doc, 'Articles / jour', formatNumber(velocity.articles_per_day, 2), 'moyenne glissante'));
      cadenceGrid.appendChild(unitCard(doc, 'Commandes / jour', formatNumber(velocity.orders_per_day, 2), 'moyenne glissante'));
      cadenceGrid.appendChild(unitCard(doc, 'Colis / jour', formatNumber(velocity.parcels_per_day, 2), 'moyenne glissante'));
      cadence.appendChild(cadenceGrid);
      cadence.appendChild(el(doc, 'p', 'kmc-flow-equilibrium-rule', `Vitesse d’absorption : ${formatKmf(velocity.contribution_per_day_kmf)} / jour${velocity.projected_days_to_break_even == null ? '' : ` · équilibre projeté ≈ ${formatNumber(velocity.projected_days_to_break_even, 1)} jours`}.`));
      body.appendChild(cadence);
    }

    details.appendChild(body);
    return details;
  }

  function buildPanel(doc, workspace, decision) {
    const flow = decision && decision.flow_break_even;
    const coverage = decision && decision.coverage ? decision.coverage : {};
    const panel = el(doc, 'section', 'kmc-flow-equilibrium-panel');
    panel.dataset[PANEL_ATTR] = '';

    const head = el(doc, 'div', 'kmc-flow-equilibrium-head');
    const copy = el(doc, 'div', 'kmc-flow-equilibrium-copy');
    copy.appendChild(el(doc, 'span', 'kmc-flow-equilibrium-kicker', 'ÉQUILIBRE DU FLUX · VÉRITÉ SERVEUR'));
    copy.appendChild(el(doc, 'h3', 'kmc-flow-equilibrium-title', 'Le portefeuille couvre la structure.'));
    copy.appendChild(el(doc, 'p', 'kmc-flow-equilibrium-intro', 'Une contribution économique issue des articles vendus. Les valeurs ci-dessous sont calculées par le moteur et ne sont pas éditables.'));
    head.appendChild(copy);
    panel.appendChild(head);

    if (!flow || flow.status !== 'READY') {
      const unavailable = el(doc, 'div', 'kmc-flow-equilibrium-unavailable');
      unavailable.appendChild(el(doc, 'strong', '', 'Projection d’équilibre non décisionnelle'));
      unavailable.appendChild(el(doc, 'span', '', flow?.reason || 'La vérité de couverture ne permet pas encore de projeter le flux.'));
      panel.appendChild(unavailable);
      return panel;
    }

    const observed = flow.observed_mix || {};
    const target = flow.economic_break_even || {};
    const state = el(doc, 'div', 'kmc-flow-equilibrium-state');
    state.appendChild(metric(doc, 'Charges à couvrir', formatKmf(coverage.denominator_n3_kmf), 'Fixes directes + quote-part fixes mutualisées', null, 'charges'));
    state.appendChild(metric(doc, 'Contribution générée', formatKmf(coverage.numerator_contribution_kmf ?? observed.reconciled_contribution_kmf), 'Somme des contributions de tous les articles', null, 'contribution'));
    state.appendChild(metric(doc, 'Couverture', formatRatioPercent(workspace, coverage.coverage_ratio), 'Contribution / charges structurelles', null, 'couverture'));
    state.appendChild(metric(doc, 'Reste à couvrir', formatKmf(target.gap_kmf), target.status === 'TARGET_REACHED' ? 'Objectif atteint' : 'Distance restante avant l’équilibre', target.status === 'TARGET_REACHED' ? 'positive' : 'warning', 'reste'));
    state.appendChild(metric(doc, 'Contribution moyenne / article', formatKmf(observed.contribution_per_article_kmf), 'Par article (mix réel)', null, 'moyenne'));
    panel.appendChild(state);

    panel.appendChild(buildFlowDetails(doc, flow));

    const safety = flow.policy_safety_target || null;
    if (safety && Number(safety.target_coverage_ratio) !== 1) {
      panel.appendChild(el(doc, 'p', 'kmc-flow-equilibrium-safety', `Cible de sécurité politique : ${formatRatioPercent(workspace, safety.target_coverage_ratio)} · gap ${formatKmf(safety.gap_kmf)}.`));
    }

    panel.appendChild(el(doc, 'p', 'kmc-flow-equilibrium-footnote', 'Projection à structure et mix constants. Les futurs paliers de capacité restent exclus tant qu’ils ne sont pas modélisés comme charges de structure.'));
    return panel;
  }

  async function readDecision(rootObject, workspace, options) {
    const context = { requestedMarket: options.requestedMarket || null };
    if (!context.requestedMarket) return null;
    return workspace.jsonRequest(options.fetch, `${workspace.endpointFor(context)}/decision`);
  }

  async function enhance(rootObject, workspace, options) {
    if (!options?.requestedMarket || !options.root || !options.document) return false;
    if (options.root.querySelector(`[data-${PANEL_ATTR.replace(/[A-Z]/g, m => `-${m.toLowerCase()}`)}]`)) return true;
    const decisionSection = findDecisionSection(options.root);
    if (!decisionSection) return false;

    let decision;
    try { decision = await readDecision(rootObject, workspace, options); } catch (_) { return false; }

    const panel = buildPanel(options.document, workspace, decision);
    const metrics = decisionSection.querySelector('.kmc-market-decision-metrics');
    const period = decisionSection.querySelector('.kmc-market-decision-period');
    const anchor = period || (metrics ? metrics.nextSibling : null);
    const slot = decisionSection.querySelector('[data-section-slot]') || decisionSection;
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(panel, anchor);
    else slot.appendChild(panel);
    return true;
  }

  function install(rootObject) {
    const workspace = rootObject && rootObject.KomerceCanonicalPricingWorkspace;
    if (!workspace || workspace.__equilibriumPanelInstalled || typeof workspace.mount !== 'function') return false;
    const originalMount = workspace.mount.bind(workspace);
    workspace.mount = async function equilibriumAwareMount(options) {
      const payload = await originalMount(options);
      await enhance(rootObject, workspace, options);
      if (options?.requestedMarket && options.root && typeof rootObject.MutationObserver === 'function') {
        let scheduled = false;
        const observer = new rootObject.MutationObserver(() => {
          if (scheduled || options.root.querySelector('[data-pricing-flow-equilibrium]')) return;
          scheduled = true;
          Promise.resolve().then(async () => { scheduled = false; await enhance(rootObject, workspace, options); });
        });
        observer.observe(options.root, { childList: true, subtree: true });
      }
      return payload;
    };
    workspace.__equilibriumPanelInstalled = true;
    return true;
  }

  return { buildPanel, enhance, install };
});
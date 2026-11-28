/**
 * @komerce-arch
 * @role          canonical-commerce-decision-view
 * @domain        admin-dashboard
 * @layer         ui-orchestration
 * @criticality   medium
 * @inputs        canonical_commerce_payload, decision_primitives
 * @outputs       decision_first_commerce_dom
 * @depends       commerce, primitives, decision-primitives
 * @used-by       canonical admin Commerce runtime
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      dashboard_no_business_recompute, decision_first_dashboard_visuals, server_decision_signal_authority
 * @impact-areas  admin-dashboard, commerce, economic-engine, local-stock
 * @version       2026-09
 */
'use strict';

(function initCommerceDecision(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.KomerceCanonicalCommerce && root.KomerceDecisionUI) {
    root.KomerceCanonicalCommerce = api.enhance(root.KomerceCanonicalCommerce, root.KomerceDecisionUI);
  }
})(typeof globalThis !== 'undefined' ? globalThis : null, function createCommerceDecision() {
  'use strict';

  function text(doc, tag, className, value) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (value != null) node.textContent = String(value);
    return node;
  }

  function kpi(payload, key) {
    return (Array.isArray(payload && payload.kpis) ? payload.kpis : [])
      .find(item => item && item.key === key) || null;
  }

  function metricDisplay(base, item) {
    if (!item || item.value == null) return '—';
    if (item.unit === 'KMF') return base.formatKmf(item.value);
    if (item.unit === '%') return `${base.formatNumber(item.value)} %`;
    return base.formatNumber(item.value, 0);
  }

  function overallWarningCount(payload) {
    const quality = payload && payload.data_quality && typeof payload.data_quality === 'object'
      ? payload.data_quality : null;
    if (quality && Array.isArray(quality.warnings)) return quality.warnings.length;
    return (Array.isArray(payload && payload.kpis) ? payload.kpis : [])
      .filter(item => item && item.data_quality && item.data_quality.warning).length;
  }

  function incompleteProfitability(payload) {
    return (Array.isArray(payload && payload.product_profitability) ? payload.product_profitability : [])
      .filter(row => {
        if (!row) return false;
        if (row.consolidated_margin_kmf == null) return true;
        const coverage = Number(row.cost_coverage_pct);
        return Number.isFinite(coverage) && coverage < 100;
      });
  }

  function destinationForSignal(signal) {
    const destination = signal && signal.destination;
    if (!destination || !destination.kind) return {};
    if (destination.kind === 'pricing_workspace') {
      const suffix = destination.market_code ? `?market=${encodeURIComponent(destination.market_code)}` : '';
      return { href: `/admin/workspaces/pricing${suffix}`, actionLabel: 'Ouvrir l’Atelier →' };
    }
    if (destination.kind === 'market_catalog') {
      const suffix = destination.market_code ? `?market=${encodeURIComponent(destination.market_code)}` : '';
      return { href: `/dashboards/canonical/market-catalog.html${suffix}`, actionLabel: 'Voir le Catalogue pays →' };
    }
    if (destination.kind === 'commerce_funnel') return { href: '#commerce-funnel', actionLabel: 'Voir le funnel →' };
    return {};
  }

  function serverDecisionItems(payload, base) {
    // Reconciliation signals remain in the canonical API; they are not sales alerts.
    return (Array.isArray(payload && payload.decision_signals) ? payload.decision_signals : [])
      .filter(signal => signal && signal.kind !== 'costing_incomplete')
      .map(signal => {
      const severity = signal && signal.severity;
      const tone = severity === 'critical' ? 'critical' : (severity === 'warning' ? 'warning' : 'info');
      let value = signal && signal.value;
      if (signal && signal.value_kmf != null) value = base.formatKmf(signal.value_kmf);
      else if (signal && signal.value_count != null) value = base.formatNumber(signal.value_count, 0);
      return {
        key: signal && signal.key ? signal.key : signal && signal.kind,
        label: signal && signal.label ? signal.label : 'Décision',
        helper: signal && signal.helper ? signal.helper : '',
        value: value == null ? '—' : value,
        tone,
        icon: tone === 'critical' ? '!' : (tone === 'warning' ? '△' : 'i'),
        ...destinationForSignal(signal),
      };
    });
  }

  function decisionItems(payload, base) {
    const warnings = overallWarningCount(payload);
    if (Array.isArray(payload && payload.decision_signals)) {
      const items = serverDecisionItems(payload, base);
      if (warnings > 0) {
        items.push({
          key: 'data-quality',
          label: 'Qualité des données',
          helper: 'Warnings pouvant affecter la lecture commerciale',
          value: base.formatNumber(warnings, 0),
          tone: 'warning',
          icon: 'i',
        });
      }
      return items.slice(0, 5);
    }

    const items = [];
    const lost = payload && payload.funnel ? Number(payload.funnel.lost) : NaN;
    const incomplete = incompleteProfitability(payload);
    const margin = kpi(payload, 'marge_consolidee');

    if (Number.isFinite(lost) && lost > 0) {
      items.push({
        key: 'orders-lost',
        label: 'Commandes annulées ou remboursées',
        helper: 'Statuts actuels, non un taux de conversion',
        value: base.formatNumber(lost, 0),
        tone: 'critical',
        icon: '↓',
        href: '#commerce-funnel',
        actionLabel: 'Voir le funnel →',
      });
    }

    // No incomplete-cost warning on the sales dashboard: see economic reconciliation.

    if (margin && Number.isFinite(Number(margin.value)) && Number(margin.value) < 0) {
      items.push({
        key: 'negative-margin',
        label: 'Marge négative',
        helper: 'Marge consolidée de la période',
        value: metricDisplay(base, margin),
        tone: 'critical',
        icon: '!',
        href: '#commerce-kpis',
        actionLabel: 'Voir les KPI →',
      });
    }

    if (warnings > 0) {
      items.push({
        key: 'data-quality',
        label: 'Qualité des données',
        helper: 'Warnings pouvant affecter la lecture commerciale',
        value: base.formatNumber(warnings, 0),
        tone: 'warning',
        icon: 'i',
      });
    }

    return items.slice(0, 4);
  }

  function metricItems(payload, base) {
    const labels = {
      'ca-encaisse': 'Ventes payées (avoir inclus)',
      commandes: 'Commandes créées',
      'panier-moyen': 'Panier moyen',
      'produits-actifs-vendus': 'Produits actifs vendus',
      'quantites-vendues': 'Quantités vendues',
    };
    const items = Object.entries(base.projectMetrics(payload)).map(([key, item]) => ({
      key,
      label: labels[key] || key,
      ...item,
    }));
    const lost = payload && payload.funnel ? Number(payload.funnel.lost) : NaN;
    if (Number.isFinite(lost)) {
      items.push({
        key: 'commandes-perdues',
        label: 'Annulées ou remboursées',
        value: base.formatNumber(lost, 0),
        tone: lost > 0 ? 'critical' : 'neutral',
      });
    }
    return items;
  }

  function rankedCategories(payload, base) {
    return (Array.isArray(payload && payload.categories) ? payload.categories : []).map(row => ({
      title: row.category || 'Catégorie',
      helper: `${base.formatNumber(row.orders, 0)} commande(s) · ${base.formatNumber(row.quantity, 0)} unité(s)`,
      value: row.revenue_display ? base.formatMoney(row.revenue_display.value, row.revenue_display.unit) : base.formatKmf(row.revenue_kmf),
      tone: 'info',
    }));
  }

  // Fiche Produit 360 avec retour vers Commerce (marché et période conservés).
  function productHref(productRef) {
    const nav = globalThis.KomerceCanonicalNavigation;
    const href = `/admin/products/${encodeURIComponent(productRef)}`;
    return nav && typeof nav.withNavContext === 'function' ? nav.withNavContext(href, 'Retour au commerce') : href;
  }

  function rankedProducts(payload, base) {
    return (Array.isArray(payload && payload.top_products) ? payload.top_products : []).map(row => ({
      title: row.name || row.product_ref || 'Produit',
      ...(row.product_ref ? { href: productHref(row.product_ref), actionLabel: 'Fiche produit →' } : {}),
      helper: `${row.category || 'Sans catégorie'} · ${base.formatNumber(row.quantity, 0)} unité(s)${row.share_pct == null ? '' : ` · ${base.formatNumber(row.share_pct, 1)} % des lignes produit`}`,
      value: row.revenue_display ? base.formatMoney(row.revenue_display.value, row.revenue_display.unit) : base.formatKmf(row.revenue_kmf),
      tone: 'neutral',
    }));
  }

  // Encaissé net : journal financier (paiements constatés − remboursements, par date de paiement). Autre cohorte que le CA.
  function collectedText(payload, base) {
    const collected = payload && payload.collected;
    if (!collected || !collected.available) {
      return 'Flux monétaires clients documentés : non disponibles pour cette période — jamais remplacés par les ventes payées.';
    }
    const native = (collected.native_net || []).map(item => `${base.formatNumber(item.total, 0)} ${item.currency}`).join(' · ');
    const eur = collected.eur_net == null ? 'EUR non disponible' : `${base.formatNumber(collected.eur_net, 2)} €${collected.eur_partial ? ' (EUR partiel : taux indisponible sur certains mouvements)' : ''}`;
    return `Sous-total des flux monétaires clients documentés (paiements réglés − remboursements monétaires confirmés, dates sources) : ${eur}${native ? ` · devises du journal ${native}` : ''}. Couverture intégrale non certifiée ; distinct des ventes payées.`;
  }

  function viabilityItems(payload, base) {
    return (Array.isArray(payload && payload.product_viability) ? payload.product_viability : []).map(row => {
      const status = row.status || 'MARKET_EVIDENCE_INSUFFICIENT';
      const tone = status === 'NON_VIABLE_STRUCTURAL'
        ? 'critical'
        : (status === 'VIABLE_UNDER_CONDITIONS' ? 'warning' : (status === 'VIABLE' ? 'positive' : 'info'));
      const gap = Number(row.purchase_cost_gap_to_safe_ceiling_kmf);
      const gapLabel = row.purchase_cost_gap_to_safe_ceiling_kmf == null || !Number.isFinite(gap)
        ? null
        : `Écart sourcing ${gap >= 0 ? '+' : ''}${base.formatKmf(gap)}`;
      const helperParts = [row.label, row.reason].filter(Boolean);
      return {
        title: row.name || row.product_ref || 'Produit',
        helper: helperParts.join(' · '),
        value: gapLabel || row.sourcing_action || '—',
        tone,
      };
    });
  }

  function profitabilityItems(payload, base) {
    return (Array.isArray(payload && payload.product_profitability) ? payload.product_profitability : []).map(row => {
      const coverage = row.cost_coverage_pct == null ? '—' : `${base.formatNumber(row.cost_coverage_pct, 1)} %`;
      const realMargin = row.consolidated_margin_kmf == null
        ? 'marge réelle inconnue'
        : `marge réelle ${base.formatKmf(row.consolidated_margin_kmf)}`;
      const numericMargin = Number(row.consolidated_margin_kmf);
      const numericCoverage = Number(row.cost_coverage_pct);
      const incomplete = row.consolidated_margin_kmf == null || (Number.isFinite(numericCoverage) && numericCoverage < 100);
      return {
        title: row.name || row.product_ref || 'Produit',
        helper: `Couverture coûts ${coverage} · ${realMargin}`,
        value: base.formatKmf(row.revenue_kmf),
        tone: Number.isFinite(numericMargin) && numericMargin < 0 ? 'critical' : (incomplete ? 'warning' : 'neutral'),
      };
    });
  }

  function funnelStages(payload, base) {
    const steps = payload && payload.funnel && Array.isArray(payload.funnel.steps)
      ? payload.funnel.steps : [];
    return steps.map(step => ({
      label: step.label || step.id || 'Étape',
      value: base.formatNumber(step.count, 0),
      ...(step.pct == null ? {} : { rate: `${base.formatNumber(step.pct)} %` }),
    }));
  }

  function trust(payload, base) {
    const quality = payload && payload.data_quality && typeof payload.data_quality === 'object'
      ? payload.data_quality : {};
    const scope = payload && payload.scope;
    let generatedAt;
    if (quality.generated_at) {
      const date = new Date(quality.generated_at);
      if (!Number.isNaN(date.getTime())) generatedAt = date.toLocaleString('fr-FR');
    }
    const warnings = overallWarningCount(payload);
    return {
      // L3 — périmètre de recette : faits simulés, jamais présentés comme activité réelle.
      stateLabel: payload && payload.simulation
        ? `Recette ${payload.simulation.scope} — faits simulés`
        : (quality.scope_enforced === false ? 'Scope à vérifier' : 'Source canonique'),
      ...(payload && payload.simulation ? { simulationLabel: payload.simulation.label } : {}),
      scopeLabel: scope && scope.mode === 'market' && scope.market
        ? `${scope.market.code} · ${scope.market.name || ''}`.trim()
        : 'Vue autorisée',
      generatedAt,
      qualityLabel: payload && payload.period != null ? `Période : ${base.formatNumber(payload.period, 0)} jours` : undefined,
      ...(warnings > 0 ? { warningLabel: `${warnings} warning(s)` } : {}),
    };
  }

  function cardSection(doc, title, description, id) {
    const section = doc.createElement('section');
    section.className = 'kmc-decision-surface-card';
    if (id) section.setAttribute('id', id);
    section.appendChild(text(doc, 'h2', 'kmc-decision-dashboard-section-title', title));
    if (description) section.appendChild(text(doc, 'p', 'kmc-decision-dashboard-section-copy', description));
    const body = doc.createElement('div');
    section.appendChild(body);
    return { section, body };
  }


  // Séries servies par le serveur (/commerce) : le navigateur ne fait que les dessiner.
  // Barres : hauteur = valeur / max affiché (mise à l'échelle graphique, pas un indicateur).
  function salesSeriesBars(payload, base) {
    const rows = Array.isArray(payload && payload.sales_series) ? payload.sales_series : [];
    const max = rows.reduce((m, r) => Math.max(m, Number(r && r.sales_kmf) || 0), 0);
    return rows.map(r => ({
      day: r.day,
      label: String(r.day || '').slice(5).split('-').reverse().join('/'),
      value: base.formatKmf(r.sales_kmf),
      heightPct: max > 0 ? Math.max(2, Math.round(((Number(r.sales_kmf) || 0) / max) * 100)) : 0,
    }));
  }

  // Peu de jours observés (ex. un seul) : la série ne représente pas une tendance et ne doit pas saturer le cadre.
  const SPARSE_SERIES_DAYS = 4;
  function salesSeriesAxis(bars) {
    if (!bars.length) return [];
    return bars.length === 1 || bars[0].label === bars[bars.length - 1].label ? [bars[0].label] : [bars[0].label, bars[bars.length - 1].label];
  }
  function salesSeriesNote(bars) {
    if (!bars.length || bars.length >= SPARSE_SERIES_DAYS) return null;
    return bars.length === 1
      ? `Un seul jour avec des ventes payées (${bars[0].label}) : pas de tendance à lire.`
      : `${bars.length} jours avec des ventes payées sur la période : tendance peu significative.`;
  }

  const MARKET_COLORS = Object.freeze(['#ea580c', '#0f766e', '#7c3aed', '#d97706', '#64748b', '#0369a1', '#be123c', '#4d7c0f']);

  function marketShares(payload, base) {
    const rows = Array.isArray(payload && payload.sales_by_market) ? payload.sales_by_market : [];
    return rows.map((r, i) => ({
      code: r.market_code, name: r.market_name || r.market_code,
      value: base.formatKmf(r.sales_kmf),
      share: r.share_pct == null ? null : Number(r.share_pct),
      color: MARKET_COLORS[i % MARKET_COLORS.length],
    }));
  }

  // Jour métier fourni par l'API (fuseau du marché) : affiché tel quel, jamais reconverti localement.
  function businessDayLabel(day) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ''));
    return m ? `${m[3]}/${m[2]}/${m[1]}` : 'Non disponible';
  }

  function seriesSubtitle(payload) {
    const def = payload && payload.period_definition;
    const base = 'Ventes payées par jour de création · jours sans vente non représentés.';
    return def && def.timezone ? `${base} Jours civils ${def.timezone}.` : base;
  }

  function recentOrderRows(payload, base) {
    const labels = (globalThis.KomerceCanonicalOrders && globalThis.KomerceCanonicalOrders.STATUS_LABELS) || {};
    return (Array.isArray(payload && payload.recent_orders) ? payload.recent_orders : []).map(r => {
      return {
        reference: r.reference,
        date: businessDayLabel(r.business_day),
        market: r.market_code || '—',
        client: r.client_name || '—',
        amount: r.total_kmf == null ? 'Non disponible' : base.formatKmf(r.total_kmf),
        status: labels[r.status] || r.status || 'Non disponible',
      };
    });
  }

  function seriesSection(doc, payload, base) {
    const card = cardSection(doc, 'Évolution des ventes payées',
      seriesSubtitle(payload), 'commerce-sales-series');
    const bars = salesSeriesBars(payload, base);
    if (!bars.length) {
      card.body.appendChild(text(doc, 'p', 'kmc-commerce-ranking-empty', 'Aucune vente payée sur la période sélectionnée.'));
      return card.section;
    }
    const chart = doc.createElement('div');
    chart.className = bars.length < SPARSE_SERIES_DAYS ? 'kmc-com-bars is-sparse' : 'kmc-com-bars';
    chart.setAttribute('role', 'img');
    chart.setAttribute('aria-label', 'Ventes payées par jour');
    bars.forEach(b => {
      const col = doc.createElement('div');
      col.className = 'kmc-com-bar';
      col.setAttribute('title', `${b.label} · ${b.value}`);
      const fill = doc.createElement('span');
      fill.className = 'kmc-com-bar-fill';
      fill.style.height = `${b.heightPct}%`;
      col.appendChild(fill);
      chart.appendChild(col);
    });
    card.body.appendChild(chart);
    const axis = doc.createElement('div');
    axis.className = 'kmc-com-bars-axis';
    salesSeriesAxis(bars).forEach(label => axis.appendChild(text(doc, 'span', '', label)));
    card.body.appendChild(axis);
    const note = salesSeriesNote(bars);
    if (note) card.body.appendChild(text(doc, 'p', 'kmc-com-bars-note', note));
    return card.section;
  }

  function marketSection(doc, payload, base) {
    const card = cardSection(doc, 'Répartition des ventes par marché',
      'Ventes payées de la période, wallet inclus.', 'commerce-market-share');
    const shares = marketShares(payload, base);
    if (!shares.length) {
      card.body.appendChild(text(doc, 'p', 'kmc-commerce-ranking-empty', 'Aucune vente payée par marché sur la période.'));
      return card.section;
    }
    const wrap = doc.createElement('div');
    wrap.className = 'kmc-com-market';
    let acc = 0;
    const stops = shares.filter(m => m.share != null).map(m => { const from = acc; acc += m.share; return `${m.color} ${from}% ${acc}%`; });
    const donut = doc.createElement('div');
    donut.className = 'kmc-com-donut';
    donut.setAttribute('aria-hidden', 'true');
    donut.style.background = `conic-gradient(${stops.join(', ')}${acc < 100 ? `, #e2e8f0 ${acc}% 100%` : ''})`;
    wrap.appendChild(donut);
    const legend = doc.createElement('ul');
    legend.className = 'kmc-com-legend';
    shares.forEach(m => {
      const li = doc.createElement('li');
      const dot = doc.createElement('i');
      dot.style.background = m.color;
      li.appendChild(dot);
      li.appendChild(text(doc, 'span', '', m.name));
      li.appendChild(text(doc, 'b', '', m.value));
      li.appendChild(text(doc, 'em', '', m.share == null ? '—' : `${String(m.share).replace('.', ',')} %`));
      legend.appendChild(li);
    });
    wrap.appendChild(legend);
    card.body.appendChild(wrap);
    return card.section;
  }

  const BUYER_METRICS = Object.freeze([
    ['paid_buyers','Acheteurs payants'],
    ['repeat_paid_buyers','Acheteurs récurrents'],
  ]);

  function buyerDrillUrl(payload, kind, page, endpoint) {
    const period = payload?.period_definition;
    const count = payload?.buyer_cohort?.[kind];
    if (!BUYER_METRICS.some(([key])=>key===kind) || !Number.isSafeInteger(count) || count<0
        || !Number.isSafeInteger(page) || page<1 || !period?.from || !period?.to
        || ![7,30,90].includes(Number(payload.period)) || !endpoint) return null;
    const params = new URLSearchParams({period:String(payload.period),buyer_drill:kind,as_of:period.to,page:String(page)});
    if (payload.simulation?.scope) params.set('simulation_scope',payload.simulation.scope);
    return endpoint + '?' + params.toString();
  }

  function matchesBuyerDrill(payload, kind, page, result) {
    const total = payload?.buyer_cohort?.[kind];
    const p = result?.pagination;
    const period = payload?.period_definition;
    const other = result?.period_definition;
    const minOrders = kind === 'repeat_paid_buyers' ? 2 : 1;
    return Number.isSafeInteger(total) && total>=0 && result?.kind===kind
      && result.scope?.mode===payload.scope?.mode && result.scope?.market?.code===payload.scope?.market?.code
      && (result.simulation?.scope||null)===(payload.simulation?.scope||null)
      && other?.from===period?.from && other?.to===period?.to && other?.timezone===period?.timezone
      && Number(result.period)===Number(payload.period)
      && p?.total===total && p.page===page && p.page_size===25 && p.total_pages===Math.ceil(total/25)
      && Array.isArray(result.accounts) && result.accounts.length===Math.min(25,Math.max(0,total-(page-1)*25))
      && result.accounts.every(row=>Number.isSafeInteger(row.paid_orders)&&row.paid_orders>=minOrders
        && typeof row.latest_order_reference==='string'&&row.latest_order_reference.length>0);
  }

  function renderBuyerCohort(doc, payload, options, base) {
    const cohort=payload?.buyer_cohort;
    if (!cohort) return null;
    const host=doc.createElement('section');
    host.className='kmc-commerce-buyer-cohort';
    host.setAttribute('data-buyer-cohort','');
    host.appendChild(text(doc,'h3','kmc-commerce-flow-title','Acheteurs identifiés'));
    host.appendChild(text(doc,'p','kmc-decision-dashboard-section-copy',
      'Comptes distincts ayant payé une commande créée sur la période ; récurrents : au moins deux commandes éligibles sur cette même période.'));
    if (cohort.completeness==='partial') host.appendChild(text(doc,'p','kmc-decision-dashboard-section-copy',
      String(cohort.unidentified_paid_orders)+' commande(s) payée(s) sans compte identifié : exclues du nombre d’acheteurs.'));
    if (cohort.completeness==='unknown') host.appendChild(text(doc,'p','kmc-decision-dashboard-section-copy','Population non déterminée.'));
    const strip=doc.createElement('div');
    strip.className='kmc-commerce-buyer-metrics';
    const panel=doc.createElement('div');
    panel.className='kmc-commerce-buyer-detail';
    panel.setAttribute('aria-live','polite');
    panel.hidden=true;
    let seq=0,active=null;
    const buttons=[];
    const close=()=>{
      seq++;active=null;panel.hidden=true;panel.replaceChildren();
      buttons.forEach(button=>button.setAttribute('aria-expanded','false'));
    };
    const endpoint=options.buyerEndpoint;
    const fetchFn=options.fetch;
    async function load(kind,page,button) {
      const url=buyerDrillUrl(payload,kind,page,endpoint);
      if (!url || typeof fetchFn!=='function') return;
      const request=++seq;active=kind;
      buttons.forEach(item=>item.setAttribute('aria-expanded',item===button?'true':'false'));
      panel.hidden=false;panel.replaceChildren();
      const heading=text(doc,'h4','kmc-commerce-flow-title',BUYER_METRICS.find(([key])=>key===kind)[1]);
      panel.appendChild(heading);
      const dismiss=text(doc,'button','kmc-commerce-buyer-close','Fermer');
      dismiss.type='button';dismiss.addEventListener('click',close);panel.appendChild(dismiss);
      const content=doc.createElement('div');
      content.appendChild(text(doc,'p','kmc-decision-dashboard-section-copy','Chargement…'));
      panel.appendChild(content);
      try {
        const response=await fetchFn(url,{method:'GET',credentials:'include',headers:{Accept:'application/json'}});
        if (!response.ok) throw new Error('buyer_drill_read_failed');
        const result=await response.json();
        if (request!==seq || !host.isConnected) return;
        content.replaceChildren();
        if (!matchesBuyerDrill(payload,kind,page,result)) {
          content.appendChild(text(doc,'p','kmc-decision-dashboard-section-copy','Population modifiée ou non réconciliée. Actualisez Commerce avant de consulter le détail.'));
          return;
        }
        content.appendChild(text(doc,'p','kmc-decision-dashboard-section-copy',
          result.pagination.total+' compte(s) · même période et périmètre que l’indicateur.'));
        const list=doc.createElement('ol');
        list.className='kmc-commerce-buyer-list';
        result.accounts.forEach(row=>{
          const item=doc.createElement('li');
          const copy=text(doc,'span','',row.paid_orders+' commande(s) payée(s) · dernière commande : ');
          item.appendChild(copy);
          const ref=text(doc,'span','kmc-commerce-buyer-reference',row.latest_order_reference);
          item.appendChild(ref);list.appendChild(item);
        });
        content.appendChild(list);
        if (!result.accounts.length) content.appendChild(text(doc,'p','kmc-decision-dashboard-section-copy','Aucun compte dans cette population.'));
        const paging=doc.createElement('div');paging.className='kmc-commerce-buyer-pagination';
        const previous=text(doc,'button','','Précédent');previous.type='button';previous.disabled=page<=1;
        previous.addEventListener('click',()=>load(kind,page-1,button));
        const next=text(doc,'button','','Suivant');next.type='button';next.disabled=page>=result.pagination.total_pages;
        next.addEventListener('click',()=>load(kind,page+1,button));
        paging.appendChild(previous);
        paging.appendChild(text(doc,'span','',result.pagination.total_pages ? page+' / '+result.pagination.total_pages : '0 / 0'));
        paging.appendChild(next);content.appendChild(paging);
      } catch (_error) {
        if (request!==seq || !host.isConnected) return;
        content.replaceChildren(text(doc,'p','kmc-decision-dashboard-section-copy','Détail indisponible ou accès refusé. Aucun résultat supposé.'));
      }
    }
    BUYER_METRICS.forEach(([kind,label])=>{
      const count=cohort[kind];
      const known=Number.isSafeInteger(count)&&count>=0;
      const button=text(doc,'button','kmc-commerce-buyer-metric',label+' · '+(known?base.formatNumber(count,0):'—'));
      button.type='button';button.setAttribute('data-buyer-drill',kind);button.setAttribute('aria-expanded','false');
      button.disabled=!known||!buyerDrillUrl(payload,kind,1,endpoint)||typeof fetchFn!=='function';
      button.addEventListener('click',()=>active===kind?close():load(kind,1,button));
      buttons.push(button);strip.appendChild(button);
    });
    host.appendChild(strip);host.appendChild(panel);return host;
  }

  function render(rootNode, payload, options, base, decisionUi) {
    const doc = options.document;
    const ui = options.ui;
    rootNode.replaceChildren();
    rootNode.className = '';

    const dashboard = doc.createElement('article');
    dashboard.className = 'kmc-dashboard kmc-decision-dashboard';
    if (typeof globalThis !== 'undefined' && globalThis.KomerceCanonicalCockpitPattern) {
      globalThis.KomerceCanonicalCockpitPattern.decorateDashboard(dashboard, 'commerce');
    }
    dashboard.setAttribute('data-dashboard-id', 'commerce');
    dashboard.setAttribute('data-dashboard-visual', 'decision-first-v1');
    dashboard.setAttribute('data-dashboard-hierarchy', 'hero-attention-primary-secondary');

    const header = doc.createElement('header');
    header.className = 'kmc-dashboard-header';
    header.setAttribute('data-dashboard-role', 'hero');
    header.appendChild(text(doc, 'p', 'canonical-eyebrow', 'COMMERCE'));
    header.appendChild(text(doc, 'h1', 'kmc-dashboard-title', 'Activité commerciale'));
    header.appendChild(text(doc, 'p', 'kmc-dashboard-description', 'Ventes payées, volumes et situation des commandes créées pendant la période.'));
    if (payload && payload.simulation && payload.simulation.scope) {
      header.appendChild(text(doc, 'p', 'canonical-eyebrow',
        `Recette ${payload.simulation.scope} — faits simulés, pas une activité réelle`));
      dashboard.setAttribute('data-simulation-scope', String(payload.simulation.scope));
    }
    header.appendChild(decisionUi.PeriodControl.create(doc,{period:options.period || payload.period || '30',ariaLabel:'Période Commerce',onChange:options.onPeriodChange}));
    dashboard.appendChild(header);

    const decisions = decisionItems(payload, base);
    if (decisions.length) {
      const host = doc.createElement('div');
      host.className = 'kmc-cockpit-decisions kmc-dashboard-attention-band';
      host.setAttribute('data-dashboard-role', 'attention');
      decisionUi.DecisionStrip.render(host, { items: decisions });
      dashboard.appendChild(host);
    }

    const activity = cardSection(
      doc,
      'Activité commerciale',
      'Montants payés wallet inclus ; cohorte selon la date de création des commandes.',
      'commerce-activity'
    );
    activity.section.className += ' is-cockpit-truth is-cockpit-flow';
    activity.section.setAttribute('data-dashboard-role', 'primary');

    const salesKeys = new Set(['ca-encaisse', 'commandes', 'panier-moyen', 'quantites-vendues']);
    const headline = metricItems(payload, base).filter(item => salesKeys.has(item.key));
    if (headline.length) {
      const metricsHost = doc.createElement('div');
      metricsHost.className = 'kmc-commerce-essential-metrics';
      ui.MetricStrip.render(metricsHost, { items: headline });
      activity.body.appendChild(metricsHost);
      activity.body.appendChild(text(doc, 'p', 'kmc-decision-dashboard-section-copy kmc-commerce-revenue-definition',
        'Chiffre d’affaires = commandes payées créées sur la période, avoir wallet inclus, hors annulées et remboursées. Ce n’est pas un encaissement de caisse.'));
      activity.body.appendChild(text(doc, 'p', 'kmc-decision-dashboard-section-copy kmc-commerce-collected',
        collectedText(payload, base)));
    }

    const buyerCohort = renderBuyerCohort(doc,payload,options,base);
    if (buyerCohort) activity.body.appendChild(buyerCohort);

    const flowTitle = text(doc, 'h3', 'kmc-commerce-flow-title', 'Parcours des commandes');
    activity.body.appendChild(flowTitle);
    const funnelHost = doc.createElement('div');
    funnelHost.className = 'kmc-commerce-essential-funnel';
    funnelHost.id = 'commerce-funnel';
    decisionUi.Funnel.render(funnelHost, { stages: funnelStages(payload, base) });
    activity.body.appendChild(funnelHost);
    activity.body.appendChild(text(doc, 'p', 'kmc-decision-dashboard-section-copy',
      'État observé des commandes créées sur la période ; ce n’est pas un taux de conversion.'));

    dashboard.appendChild(activity.section);

    const trends = doc.createElement('div');
    trends.className = 'kmc-decision-dashboard-grid-2 kmc-com-trends';
    trends.setAttribute('data-dashboard-role', 'secondary');
    trends.appendChild(seriesSection(doc, payload, base));
    trends.appendChild(marketSection(doc, payload, base));
    dashboard.appendChild(trends);

    // Les cinq meilleures lignes produit et les catégories viennent DIRECTEMENT
    // des agrégats serveur. Ne jamais en déduire la vente payée de commande :
    // transport, remises et wallet ont des assiettes distinctes.
    const top = rankedProducts(payload, base);
    const categories = rankedCategories(payload, base);
    const rankings = doc.createElement('div');
    rankings.className = 'kmc-decision-dashboard-grid-2 kmc-commerce-ranking-grid';
    rankings.setAttribute('data-dashboard-role', 'secondary');

    const products = cardSection(
      doc, 'Top produits',
      'Montants des lignes produit, hors transport et remises · cinq premiers produits · part = part du montant total des lignes produit payées, pas du CA.',
      'commerce-top-products'
    );
    if (top.length) {
      decisionUi.RankedList.render(products.body, { items: top });
    } else {
      products.body.appendChild(text(doc, 'p', 'kmc-commerce-ranking-empty',
        'Aucune ligne produit payée sur la période sélectionnée.'));
    }
    rankings.appendChild(products.section);

    const categoriesCard = cardSection(
      doc, 'Répartition par catégorie',
      'Volume et montant des lignes produit · pas une répartition des ventes payées par marché.',
      'commerce-categories'
    );
    if (categories.length) {
      decisionUi.RankedList.render(categoriesCard.body, { items: categories });
    } else {
      categoriesCard.body.appendChild(text(doc, 'p', 'kmc-commerce-ranking-empty',
        'Aucune catégorie vendue sur la période sélectionnée.'));
    }
    rankings.appendChild(categoriesCard.section);
    dashboard.appendChild(rankings);

    rootNode.appendChild(dashboard);
    return { element: dashboard, visual: 'decision-first-v1' };
  }

  function enhance(base, decisionUi) {
    if (!base || typeof base.mount !== 'function') throw new Error('commerce_decision_base_missing');
    const baseMount = base.mount;
    const enhanced = {
      ...base,
      mount(options) {
        const rerender = nextPeriod => enhanced.mount({ ...options, period: nextPeriod });
        return baseMount({...options,onPayload:(payload,period,endpoint)=>render(options.root,payload,{...options,period,buyerEndpoint:endpoint,onPeriodChange:rerender},base,decisionUi)}).then(result => {
          // Le montage de base peut finir après qu'une nouvelle vue a remplacé
          // celle-ci. Dans ce cas, il n'y a ni payload ni rendu à enrichir.
          if (result?.stale) return result;
          if (!result || !result.payload) {
            const renderer = options.renderer?.createRenderer?.({
              document: options.document,
              ui: options.ui,
            });
            renderer?.render?.(options.root, [], {
              state: 'error',
              stateMessage: 'Les données Commerce n’ont pas été reçues. Relancez l’écran.',
            });
            return result || Object.freeze({ stale: false, unavailable: true });
          }
          return {...result,decisionFirst:true};
        });
      },
      projectDecisionItems: payload => decisionItems(payload, base),
      projectMetricItems: payload => metricItems(payload, base),
      projectRankedCategories: payload => rankedCategories(payload, base),
      projectRankedProducts: payload => rankedProducts(payload, base),
      projectViabilityItems: payload => viabilityItems(payload, base),
      projectProfitabilityItems: payload => profitabilityItems(payload, base),
      projectFunnelStages: payload => funnelStages(payload, base),
      projectSalesSeries: payload => salesSeriesBars(payload, base),
      projectMarketShares: payload => marketShares(payload, base),
      projectRecentOrders: payload => recentOrderRows(payload, base),
      projectTrust: payload => trust(payload, base),
    };
    return Object.freeze(enhanced);
  }

  return Object.freeze({
    kpi,
    metricDisplay,
    salesSeriesBars,
    salesSeriesAxis,
    businessDayLabel,
    salesSeriesNote,
    marketShares,
    recentOrderRows,
    overallWarningCount,
    incompleteProfitability,
    destinationForSignal,
    serverDecisionItems,
    decisionItems,
    metricItems,
    rankedCategories,
    rankedProducts,
    viabilityItems,
    profitabilityItems,
    funnelStages,
    trust,
    buyerDrillUrl,
    matchesBuyerDrill,
    renderBuyerCohort,
    render,
    enhance,
  });
});

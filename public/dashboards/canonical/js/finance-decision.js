/**
 * @komerce-arch
 * @role          canonical-finance-decision-view
 * @domain        admin-dashboard
 * @layer         ui-orchestration
 * @criticality   medium
 * @inputs        canonical_finance_payload, supplier_payment_review, decision_primitives
 * @outputs       decision_first_finance_dom, global_supplier_payment_review_queue
 * @depends       finance, primitives, decision-primitives
 * @used-by       canonical admin Finance runtime
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      dashboard_no_business_recompute, decision_first_dashboard_visuals
 * @impact-areas  admin-dashboard, finance, economic-engine, purchasing
 * @version       2026-10
 */
'use strict';

(function initFinanceDecision(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.KomerceCanonicalFinance && root.KomerceDecisionUI) {
    root.KomerceCanonicalFinance = api.enhance(root.KomerceCanonicalFinance, root.KomerceDecisionUI);
  }
})(typeof globalThis !== 'undefined' ? globalThis : null, function createFinanceDecision() {
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

  function displayMetric(base, item) {
    if (!item || item.value == null) return '—';
    if (item.unit === 'KMF') return base.formatKmf(item.value);
    if (item.unit === '%') return `${base.formatNumber(item.value)} %`;
    return base.formatNumber(item.value, 0);
  }

  const CLASS_LABELS = Object.freeze({
    overrun: 'Surcoût confirmé', saving: 'Économie confirmée', provisional: 'Écart provisoire',
    not_comparable: 'Non comparable', none: 'Sans écart',
  });
  const CLASS_HELP = Object.freeze({
    overrun: 'Réel supérieur à l’estimé, coûts complets',
    saving: 'Réel inférieur à l’estimé, coûts complets',
    provisional: 'Coûts réels encore incomplets : pas une économie ni un surcoût',
    not_comparable: 'Estimation absente, coût attendu inconnu ou périmètre différent',
    none: 'Valeurs comparables et identiques',
  });
  const REASON_LABELS = Object.freeze({
    estimate_absent: 'Estimation absente',
    no_real_cost: 'Aucun coût réel établi',
    expected_cost_unknown: 'Coût attendu encore inconnu (ex. douane)',
    scope_not_comparable: 'Périmètres non comparables',
    real_incomplete: 'Coûts réels incomplets',
  });
  const STATE_LABELS = Object.freeze({
    unknown: 'Inconnu — à établir', expected: 'Attendu, pas encore dû', confirmed: 'Confirmé',
    zero_confirmed: 'Zéro confirmé', not_applicable: 'Non applicable',
  });
  const STATUS_LABELS = Object.freeze({
    pending: 'En attente', pending_group_payment: 'Paiement groupé en attente', confirmed: 'Confirmée',
    ordered: 'Commandée au fournisseur', preparation: 'En préparation', shipped: 'Expédiée',
    in_transit: 'En transit', available: 'Disponible au relais', collected: 'Remise client',
  });
  const VARIANCE_ORDER = Object.freeze(['overrun', 'saving', 'provisional', 'not_comparable', 'none']);
  const CLASS_TITLES = Object.freeze({
    overrun: 'Surcoûts confirmés', saving: 'Économie confirmée', provisional: 'Écart provisoire',
    not_comparable: 'Non comparable', none: 'Sans écart',
  });
  const CLASS_SHORT_HELP = Object.freeze({
    overrun: 'Réel supérieur à l’estimé, coûts complets', saving: 'Réel inférieur à l’estimé, coûts complets',
    provisional: 'Coûts réels encore incomplets', not_comparable: 'Estimation absente ou périmètre différent',
    none: 'Valeurs comparables et identiques',
  });

  function varianceHelper(summary) {
    const parts = [];
    if (summary.overrun.orders) parts.push(`${summary.overrun.orders} surcoût(s) confirmé(s)`);
    if (summary.saving.orders) parts.push(`${summary.saving.orders} économie(s) confirmée(s)`);
    if (summary.provisional.orders) parts.push(`${summary.provisional.orders} provisoire(s)`);
    if (summary.not_comparable.orders) parts.push(`${summary.not_comparable.orders} non comparable(s)`);
    if (summary.none.orders) parts.push(`${summary.none.orders} sans écart`);
    return parts.join(' · ');
  }

  function orderHref(base, reference) {
    const loc = typeof globalThis !== 'undefined' && globalThis.location ? globalThis.location : null;
    const returnTo = loc ? `${loc.pathname || '/admin/finance'}${loc.search || ''}` : '/admin/finance';
    // Ancre #couts : la fiche 360 ouvre sa section Coûts & écarts (présente si finance.read).
    return base.contextualHref(`/admin/orders/${encodeURIComponent(reference)}#couts`, returnTo, 'Retour à Finance');
  }

  function ownerHref(base, owner) {
    if (!owner || !owner.href) return null;
    const loc = typeof globalThis !== 'undefined' && globalThis.location ? globalThis.location : null;
    const returnTo = loc ? `${loc.pathname || '/admin/finance'}${loc.search || ''}` : '/admin/finance';
    return base.contextualHref(owner.href, returnTo, 'Retour à Finance');
  }

  // Notes de définition : numérateur, dénominateur, périmètre — jamais un pourcentage orphelin.
  function indicatorNotes(payload, base) {
    const notes = [];
    const comp = kpi(payload, 'taux_completude_couts');
    const q = comp && comp.data_quality ? comp.data_quality : {};
    if (comp && comp.value != null && q.items_total != null) {
      notes.push({
        key: 'completeness',
        title: `Complétude des coûts : ${base.formatNumber(comp.value)} %`,
        text: `${base.formatNumber(q.items_with_data, 0)} commande(s) sur ${base.formatNumber(q.items_total, 0)} ont tous leurs coûts attendus à leur stade d’avancement (commandes pas encore démarrées exclues). `
          + `Ce n’est pas la marge finale : seules ${base.formatNumber(q.final_margin_ready == null ? 0 : q.final_margin_ready, 0)} commande(s) remises au client, sans coût manquant ni douane inconnue, ont une marge réelle finale calculable.`,
      });
    }
    const split = payload && payload.margin_scope && payload.margin_scope.real_cost_split;
    const real = kpi(payload, 'cout_reel');
    if (real && real.value != null && split) {
      notes.push({
        key: 'real-cost',
        title: `Coût réel : ${base.formatKmf(real.value)} — coûts partiels inclus`,
        text: `${base.formatKmf(split.final.amount_kmf)} sur ${base.formatNumber(split.final.orders, 0)} commande(s) aux coûts finalisés `
          + `+ ${base.formatKmf(split.partial.amount_kmf)} sur ${base.formatNumber(split.partial.orders, 0)} commande(s) aux coûts encore partiels. `
          + 'Un coût partiel n’est pas un coût complet : ne pas en déduire une marge.',
      });
    }
    const scope = payload && payload.margin_scope;
    const margin = kpi(payload, 'marge_consolidee');
    if (margin && margin.value != null && scope) {
      const refs = (scope.eligible_references || []).join(' + ') || '—';
      const excluded = (scope.excluded || []).map(e => `${base.formatNumber(e.count, 0)} · ${e.label.toLowerCase()}`).join(' ; ');
      notes.push({
        key: 'margin',
        title: `Marge consolidée : ${base.formatKmf(margin.value)} — ${base.formatNumber(scope.eligible_orders, 0)} commande(s) éligible(s) sur ${base.formatNumber(scope.paid_orders, 0)} encaissée(s)`,
        text: `Périmètre : ${refs} (seules commandes à marge réelle finale). Exclues : ${excluded || 'aucune'}.`,
      });
    }
    return notes;
  }

  function followUpRows(row) {
    const fu = row.follow_up || { to_establish: [], not_yet_due: [] };
    return [
      ...fu.to_establish.map(c => ({ ...c, group: 'to_establish' })),
      ...fu.not_yet_due.map(c => ({ ...c, group: 'not_yet_due' })),
    ];
  }

  function el(doc, tag, className, content) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (content != null) node.textContent = String(content);
    return node;
  }

  function actionLink(doc, href, label) {
    if (!href) return null;
    const a = el(doc, 'a', 'kmc-fin-link', label);
    a.setAttribute('href', href);
    return a;
  }

  function simpleTable(doc, headers, rows, numericFrom) {
    const wrap = el(doc, 'div', 'kmc-fin-table-wrap');
    const table = el(doc, 'table', 'kmc-fin-table');
    const head = doc.createElement('tr');
    headers.forEach((h, i) => { const th = el(doc, 'th', numericFrom != null && i >= numericFrom && i < numericFrom + 3 ? 'is-num' : '', h); head.appendChild(th); });
    const thead = doc.createElement('thead'); thead.appendChild(head); table.appendChild(thead);
    const tbody = doc.createElement('tbody');
    rows.forEach(cells => {
      const tr = doc.createElement('tr');
      cells.forEach((cell, i) => {
        const td = el(doc, 'td', numericFrom != null && i >= numericFrom && i < numericFrom + 3 ? 'is-num' : '');
        if (cell && typeof cell === 'object' && cell.nodeType) td.appendChild(cell); else td.textContent = cell == null ? '—' : String(cell);
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
  }

  function renderIncompleteOrders(doc, body, payload, base) {
    const rows = Array.isArray(payload && payload.incomplete_cost_orders) ? payload.incomplete_cost_orders : [];
    if (!rows.length) {
      body.appendChild(el(doc, 'p', 'kmc-finance-review-empty', 'Aucune commande n’a de coût attendu non enregistré à ce stade.'));
      return;
    }
    rows.forEach(row => {
      const items = followUpRows(row);
      const due = items.filter(i => i.group === 'to_establish');
      const later = items.filter(i => i.group === 'not_yet_due');
      const details = el(doc, 'details', 'kmc-fin-order');
      details.setAttribute('data-order-ref', row.reference || '');
      const summary = el(doc, 'summary', 'kmc-fin-order-summary');
      summary.appendChild(el(doc, 'strong', 'kmc-fin-ref', row.reference || 'Commande'));
      summary.appendChild(el(doc, 'span', 'kmc-fin-meta', `${row.market_code || 'marché —'} · ${STATUS_LABELS[row.status] || row.status || '—'}`));
      summary.appendChild(el(doc, 'span', 'kmc-fin-count', `${due.length} à établir · ${later.length} pas encore dû(s)`));
      details.appendChild(summary);
      const content = el(doc, 'div', 'kmc-fin-order-body');
      const e = row.cost_explanation || {};
      if (e.missing_estimate) content.appendChild(el(doc, 'p', 'kmc-fin-note', 'Estimation de coût absente pour cette commande.'));
      content.appendChild(simpleTable(doc, ['Composante', 'État', 'Motif', 'Responsable'], items.map(i => [
        i.label,
        i.group === 'to_establish' ? STATE_LABELS.unknown : STATE_LABELS.expected,
        i.reason || '—',
        i.owner ? (actionLink(doc, ownerHref(base, i.owner), `${i.owner.label} →`) || i.owner.label) : 'À identifier',
      ])));
      content.appendChild(el(doc, 'p', 'kmc-fin-note', `Conséquence : ${e.margin && e.margin.label ? e.margin.label : 'marge finale non évaluée'} Les coûts inconnus ne sont jamais comptés comme zéro.`));
      const link = actionLink(doc, orderHref(base, row.reference), 'Ouvrir la commande 360 →');
      if (link) content.appendChild(link);
      details.appendChild(content);
      body.appendChild(details);
    });
  }

  function renderVariances(doc, body, payload, base) {
    const vs = payload && payload.variance_summary;
    const orders = Array.isArray(payload && payload.costing_orders) ? payload.costing_orders : [];
    if (!vs || !orders.length) {
      body.appendChild(el(doc, 'p', 'kmc-finance-review-empty', 'Aucune commande à comparer sur la période.'));
      return;
    }
    const grid = el(doc, 'div', 'kmc-fin-classes');
    VARIANCE_ORDER.forEach(key => {
      const entry = vs[key];
      const card = el(doc, 'div', `kmc-fin-class is-${key}`);
      card.appendChild(el(doc, 'strong', 'kmc-fin-class-title', CLASS_LABELS[key]));
      card.appendChild(el(doc, 'span', 'kmc-fin-class-value', `${base.formatNumber(entry.orders, 0)} commande(s)`));
      if (entry.orders > 0 && entry.amount_kmf != null && key !== 'none') {
        card.appendChild(el(doc, 'span', 'kmc-fin-class-amount', `${base.formatSignedKmf(entry.amount_kmf)} d’écart de coût`));
      }
      card.appendChild(el(doc, 'span', 'kmc-fin-class-help', CLASS_HELP[key]));
      grid.appendChild(card);
    });
    body.appendChild(grid);
    body.appendChild(el(doc, 'p', 'kmc-fin-note', `Écart de coût = réel − estimé figé à la commande, sur le périmètre achat/transport/douane/Hub/relais + frais de paiement (${base.formatNumber(vs.orders_considered, 0)} commande(s) récentes). Écart de marge variable = −écart de coût. Les écarts provisoires et non comparables ne sont pas additionnés aux écarts confirmés.`));
    orders.forEach(row => {
      const v = row.variance;
      if (!v) return;
      const details = el(doc, 'details', `kmc-fin-order is-${v.class}`);
      details.setAttribute('data-order-ref', row.reference || '');
      const summary = el(doc, 'summary', 'kmc-fin-order-summary');
      summary.appendChild(el(doc, 'strong', 'kmc-fin-ref', row.reference || 'Commande'));
      summary.appendChild(el(doc, 'span', 'kmc-fin-meta', `${row.market_code || 'marché —'} · ${STATUS_LABELS[row.status] || row.status || '—'}`));
      summary.appendChild(el(doc, 'span', `kmc-fin-badge is-${v.class}`, CLASS_LABELS[v.class]));
      summary.appendChild(el(doc, 'span', 'kmc-fin-count', v.cost_variance_kmf == null ? (REASON_LABELS[v.reason] || '—') : `${base.formatSignedKmf(v.cost_variance_kmf)}${v.class === 'provisional' ? ' (provisoire)' : ''}`));
      details.appendChild(summary);
      const content = el(doc, 'div', 'kmc-fin-order-body');
      const facts = [
        ['Prévision (snapshot figé)', base.formatKmf(v.estimated_variable_kmf)],
        ['Constaté', base.formatKmf(v.real_variable_kmf)],
        ['Écart de coût', v.cost_variance_kmf == null ? '—' : base.formatSignedKmf(v.cost_variance_kmf)],
        ['Écart de marge variable', v.margin_variance_kmf == null ? '—' : base.formatSignedKmf(v.margin_variance_kmf)],
        ['Complétude', v.class === 'overrun' || v.class === 'saving' || v.class === 'none' ? 'Comparaison finale' : (v.class === 'provisional' ? 'Comparaison provisoire : coûts réels incomplets' : (REASON_LABELS[v.reason] || 'Non comparable'))],
        ['Explication', 'À analyser — aucune cause documentée dans les données'],
      ];
      content.appendChild(simpleTable(doc, ['Information', 'Valeur'], facts));
      content.appendChild(simpleTable(doc, ['Composante', 'État', 'Prévu', 'Constaté', 'Écart', 'Responsable'], (v.components || []).map(c => [
        c.label,
        STATE_LABELS[c.state] || c.state,
        base.formatKmf(c.estimated_kmf),
        c.real_kmf == null ? '—' : base.formatKmf(c.real_kmf),
        c.delta_kmf == null ? '—' : base.formatSignedKmf(c.delta_kmf),
        c.owner ? (actionLink(doc, ownerHref(base, c.owner), `${c.owner.label} →`) || c.owner.label) : '—',
      ]), 2));
      const link = actionLink(doc, orderHref(base, row.reference), 'Ouvrir la commande 360 →');
      if (link) content.appendChild(link);
      details.appendChild(content);
      body.appendChild(details);
    });
  }

  function decisionItems(payload, base) {
    const items = [];
    const pendingPayments = kpi(payload, 'paiements_en_attente');
    const incompleteCosts = kpi(payload, 'cmds_cout_incomplet');
    const refunds = kpi(payload, 'remboursements');
    const supplierReview = payload && payload.supplier_payment_review;

    if (pendingPayments && Number(pendingPayments.value) > 0) {
      items.push({
        key: 'payments-pending',
        label: 'Paiements en attente',
        helper: 'Éléments d’encaissement non finalisés',
        value: displayMetric(base, pendingPayments),
        tone: 'warning',
        icon: '¤',
        href: pendingPayments.drill_to || '#finance-kpis',
        actionLabel: 'Voir les commandes →',
      });
    }
    if (incompleteCosts && Number(incompleteCosts.value) > 0) {
      items.push({
        key: 'incomplete-costs',
        label: 'Coûts restant à établir',
        helper: 'Commandes où un coût attendu à ce stade n’est pas encore enregistré — inconnu, pas zéro',
        value: displayMetric(base, incompleteCosts),
        tone: 'warning',
        icon: '!',
        href: '#finance-incomplete-costs',
        actionLabel: 'Voir les commandes →',
      });
    }
    const vs = payload && payload.variance_summary;
    if (vs && vs.orders_considered > 0 && (vs.overrun.orders + vs.saving.orders + vs.provisional.orders + vs.none.orders) > 0) {
      items.push({
        key: 'observed-variances',
        label: 'Écarts entre coûts prévus et constatés',
        helper: varianceHelper(vs),
        value: base.formatNumber(vs.overrun.orders + vs.saving.orders, 0),
        tone: vs.overrun.orders > 0 ? 'warning' : 'info',
        icon: '↔',
        href: '#finance-variances',
        actionLabel: 'Voir les écarts →',
      });
    }
    if (supplierReview && Number(supplierReview.count) > 0) {
      items.push({
        key: 'supplier-payments-review',
        label: 'Paiements fournisseur à revoir',
        helper: 'État courant : ambigu, rejeté ou écart de rapprochement — hors filtre période',
        value: base.formatNumber(supplierReview.count, 0),
        tone: 'warning',
        icon: '!',
        href: '#finance-supplier-payments',
        actionLabel: 'Voir la file →',
      });
    }
    if (refunds && Number(refunds.value) > 0) {
      const refundCount = payload && payload.refunds && Number.isFinite(Number(payload.refunds.count))
        ? Number(payload.refunds.count) : null;
      items.push({
        key: 'refunds-period',
        label: 'Remboursements période',
        helper: refundCount == null ? 'Montant remboursé sur la période' : `${base.formatNumber(refundCount, 0)} remboursement(s) finalisé(s)`,
        value: displayMetric(base, refunds),
        tone: 'warning',
        icon: '↩',
        href: '#finance-refunds',
        actionLabel: 'Voir les remboursements →',
      });
    }
    return items.slice(0, 5);
  }

  function metricItems(payload, base) {
    const labels = {
      'ca-encaisse': 'Commandes payées — part hors avoir',
      'cout-reel': 'Coût réel',
      marge: 'Marge consolidée',
      completude: 'Complétude coûts',
      'cout-incomplet': 'Coûts restant à établir',
      'paiement-attente': 'Paiements en attente',
      remboursements: 'Remboursements',
    };
    return Object.entries(base.projectMetrics(payload)).map(([key, item]) => ({
      key,
      label: labels[key] || key,
      ...item,
    }));
  }

  function headlineMetrics(payload, base) {
    const keep = new Set(['ca-encaisse', 'cout-reel', 'marge']);
    return metricItems(payload, base).filter(item => keep.has(item.key));
  }

  function pair(payload, base, key, label) {
    const item = kpi(payload, key);
    return item ? { label, value: displayMetric(base, item) } : null;
  }

  function overviewCards(payload, base) {
    const definitions = [
      {
        key: 'revenue', title: 'Encaissements', tone: 'info',
        metrics: [pair(payload, base, 'ca_encaisse', 'Commandes payées — part hors avoir'), pair(payload, base, 'paiements_en_attente', 'Paiements en attente')],
      },
      {
        key: 'costing', title: 'Vérité des coûts', tone: 'warning',
        metrics: [pair(payload, base, 'cout_reel', 'Coût réel'), pair(payload, base, 'taux_completude_couts', 'Complétude'), pair(payload, base, 'cmds_cout_incomplet', 'Coûts restant à établir')],
      },
      {
        key: 'margin', title: 'Marge', tone: 'positive',
        // Rang 1 : consolidée (réelle) ; rang 2 : estimée, explicitement non définitive.
        metrics: [pair(payload, base, 'marge_consolidee', 'Marge consolidée (réelle)'), pair(payload, base, 'marge_estimee', 'Marge estimée — non définitive')],
      },
      {
        key: 'refunds', title: 'Remboursements', tone: 'violet',
        metrics: [pair(payload, base, 'remboursements', 'Montant période')],
      },
    ];
    return definitions
      .map(card => ({ ...card, metrics: card.metrics.filter(Boolean) }))
      .filter(card => card.metrics.length > 0);
  }

  function completenessProgress(payload, base) {
    const item = kpi(payload, 'taux_completude_couts');
    if (!item || item.value == null) return [];
    return [{
      label: 'Complétude des coûts',
      value: displayMetric(base, item),
      percent: Number(item.value),
      tone: Number(item.value) < 100 ? 'warning' : 'positive',
      helper: item.data_quality && item.data_quality.warning ? String(item.data_quality.warning) : undefined,
    }];
  }

  function trendItems(payload, base) {
    return (Array.isArray(payload && payload.trend) ? payload.trend : []).map(row => ({
      title: base.formatDate(row.bucket),
      helper: `CA ${base.formatKmf(row.revenue_kmf)} · coût ${base.formatKmf(row.real_cost_kmf)} · marge ${base.formatKmf(row.consolidated_margin_kmf)}`,
      value: row.cost_coverage_pct == null ? '—' : `${base.formatNumber(row.cost_coverage_pct, 1)} %`,
      tone: row.consolidated_margin_kmf != null && Number(row.consolidated_margin_kmf) < 0 ? 'critical' : 'neutral',
    }));
  }

  function costingItems(payload, base) {
    return (Array.isArray(payload && payload.costing_kpis) ? payload.costing_kpis : []).map(metric => {
      const quality = metric && metric.data_quality ? metric.data_quality : {};
      const coverage = quality.items_total == null || quality.items_with_data == null
        ? 'données non précisées'
        : `${base.formatNumber(quality.items_with_data, 0)}/${base.formatNumber(quality.items_total, 0)} données`;
      const incomplete = quality.warning || (quality.completeness && quality.completeness !== 'complete');
      return {
        title: metric.label || metric.key || 'Indicateur costing',
        helper: [coverage, quality.warning || quality.completeness].filter(Boolean).join(' · '),
        value: displayMetric(base, metric),
        tone: incomplete ? 'warning' : 'neutral',
      };
    });
  }

  function varianceItems(payload, base) {
    // Mêmes classes que le bandeau : surcoût/économie confirmés, provisoires. Un écart non nul n'est pas une anomalie.
    return (Array.isArray(payload && payload.costing_orders) ? payload.costing_orders : [])
      .filter(row => row && row.variance && ['overrun', 'saving', 'provisional'].includes(row.variance.class))
      .map(row => {
        const v = row.variance;
        return {
          title: row.reference || 'Commande',
          helper: `${CLASS_LABELS[v.class]} · vente ${base.formatKmf(row.sale_total_kmf)} · réel ${base.formatKmf(row.real_cost_kmf)} · marge ${base.formatKmf(row.consolidated_margin_kmf)}`,
          value: base.formatSignedKmf(v.cost_variance_kmf),
          tone: v.class === 'overrun' ? 'warning' : 'neutral',
        };
      });
  }

  // Détail de "Coûts incomplets" (bandeau de décision) — jusqu'ici cette
  // carte pointait vers #finance-costing, qui montre en réalité 5 métriques
  // de qualité coût/marge agrégées (coût estimé, coût réel, marge estimée…)
  // sans aucun rapport avec le NOMBRE de commandes à coût incomplet compté
  // sur la carte. incomplete_cost_orders existe déjà dans le payload
  // (services/dashboard-finance-canonical.js, même clause WHERE que le
  // compte cmds_cout_incomplet) mais n'était affiché nulle part.
  // D1 — ce qui manque précisément, ce qui n'est pas encore attendu à ce stade.
  // Un coût sans mécanisme de collecte reste un manque fonctionnel (jamais « non applicable »).
  function costExplanationText(row) {
    const e = row && row.cost_explanation;
    if (!e) return '';
    const parts = [];
    if (e.missing_estimate) parts.push('Estimation absente');
    if (Array.isArray(e.missing) && e.missing.length) {
      parts.push('Manque : ' + e.missing.map(m => (m.label || m.type) + (m.collection_mechanism === false ? ' (mécanisme de collecte absent)' : (m.mechanism === 'manual_entry' ? ' (saisie manuelle requise)' : ''))).join(', '));
    }
    if (Array.isArray(e.not_yet_expected) && e.not_yet_expected.length) {
      parts.push('Pas encore attendu : ' + e.not_yet_expected.map(m => m.label || m.type).join(', '));
    }
    if (e.margin && e.margin.label) parts.push(e.margin.label);
    return parts.length ? ' · ' + parts.join(' · ') : '';
  }

  function incompleteCostOrderItems(payload, base) {
    return (Array.isArray(payload && payload.incomplete_cost_orders) ? payload.incomplete_cost_orders : []).map(row => ({
      title: row.reference || 'Commande',
      helper: `${row.status || '—'} · paiement ${row.payment_status || '—'} · ${base.formatDate(row.created_at)}${costExplanationText(row)}`,
      value: base.formatKmf(row.total_kmf),
      tone: 'warning',
    }));
  }

  function paymentItems(payload, base) {
    return (Array.isArray(payload && payload.payment_mix) ? payload.payment_mix : []).map(row => ({
      title: row.payment_mode || 'Mode de paiement',
      helper: `${base.formatNumber(row.orders, 0)} commande(s)`,
      value: base.formatKmf(row.total_kmf),
      tone: 'info',
    }));
  }

  function relayItems(payload, base) {
    return (Array.isArray(payload && payload.relay_profitability) ? payload.relay_profitability : []).map(row => {
      const coverage = row.cost_coverage_pct;
      const realMargin = row.consolidated_margin_kmf;
      const incomplete = realMargin == null || (coverage != null && Number(coverage) < 100);
      return {
        title: row.relais_name || 'Relais',
        helper: `${base.formatNumber(row.orders, 0)} commande(s) · CA ${base.formatKmf(row.revenue_kmf)} · marge réelle ${base.formatKmf(realMargin)} · couverture ${coverage == null ? '—' : `${base.formatNumber(coverage, 1)} %`}`,
        value: base.formatKmf(row.estimated_margin_kmf),
        tone: realMargin != null && Number(realMargin) < 0 ? 'critical' : (incomplete ? 'warning' : 'neutral'),
      };
    });
  }

  function refundItems(payload, base) {
    const rows = payload && payload.refunds && Array.isArray(payload.refunds.recent) ? payload.refunds.recent : [];
    return rows.map(row => ({
      title: row.order_reference || 'Commande remboursée',
      helper: `${row.refund_method || 'Méthode inconnue'} · ${base.formatDate(row.completed_at)}`,
      value: base.formatKmf(row.amount_kmf),
      tone: 'violet',
    }));
  }

  // L'absence de la file n'est jamais muette : vide (vue globale) ≠ non fournie (vue marché).
  function supplierReviewState(payload) {
    const review = payload && payload.supplier_payment_review;
    if (review === undefined || review === null) {
      return {
        state: 'not-provided',
        message: 'Non disponible dans cette vue : la file de revue fournisseur est centrale (vue globale uniquement), faute de ventilation canonique multi-marché.',
      };
    }
    const rows = Array.isArray(review.items) ? review.items : [];
    return rows.length
      ? { state: 'rows', message: null }
      : { state: 'empty', message: 'Aucun paiement fournisseur ambigu, rejeté ou en écart de rapprochement.' };
  }

  const PAYMENT_STATUS_LABELS = { ambiguous: 'ambigu', rejected: 'rejeté', pending: 'en attente', failed: 'échoué', succeeded: 'réussi' };
  const RECONCILIATION_LABELS = { unverified: 'non vérifié', mismatched: 'écart constaté', matched: 'rapproché', pending: 'en cours' };
  const REVIEW_REASON_LABELS = {
    PAYMENT_AMBIGUOUS_RECONCILIATION_REQUIRED: 'rapprochement à confirmer',
    PAYMENT_REJECTED_REVIEW_REQUIRED: 'rejet à examiner',
    PAYMENT_RECONCILIATION_MISMATCH: 'écart de rapprochement',
  };
  const frenchLabel = (labels, value) => labels[value] || (/^[A-Z0-9_]+$/.test(String(value)) ? 'motif à examiner' : value);

  function supplierPaymentReviewItems(payload, base) {
    const review = payload && payload.supplier_payment_review;
    const rows = review && Array.isArray(review.items) ? review.items : [];
    return rows.map(row => ({
      title: `${row.provider || 'Fournisseur'} · PO ${base.shortId(row.purchase_order_id)}`,
      helper: [
        row.status ? frenchLabel(PAYMENT_STATUS_LABELS, row.status) : 'statut inconnu',
        `rapprochement ${row.reconciliation_status ? frenchLabel(RECONCILIATION_LABELS, row.reconciliation_status) : 'inconnu'}`,
        row.review_reason ? frenchLabel(REVIEW_REASON_LABELS, row.review_reason) : null,
        `débit réel prouvé ${row.real_debit_verified === true ? 'oui' : 'non'}`,
        base.formatDate(row.updated_at),
      ].filter(Boolean).join(' · '),
      value: row.observed_amount == null
        ? `attendu ${base.formatExactAmount(row.expected_amount, row.currency)} · observé —`
        : `attendu ${base.formatExactAmount(row.expected_amount, row.currency)} · observé ${base.formatExactAmount(row.observed_amount, row.currency)}`,
      tone: row.reconciliation_status === 'mismatched' ? 'critical' : 'warning',
      href: row.drill_to
        ? base.contextualHref(row.drill_to, '/admin/finance', 'Retour à Finance')
        : undefined,
      actionLabel: row.drill_to ? 'Ouvrir dans Achats →' : undefined,
    }));
  }

  function drillCards(base, user) {
    const schema = base.visibleDrillSchema(base.FINANCE_SCHEMA, user);
    return (Array.isArray(schema.drill) ? schema.drill : []).map(item => ({
      key: item.id,
      title: item.label,
      subtitle: 'Approfondir dans le workspace autorisé',
      href: item.href,
      tone: item.id === 'pricing-workspace' ? 'violet' : 'info',
    }));
  }

  function trust(payload, base) {
    const quality = payload && payload.data_quality && typeof payload.data_quality === 'object' ? payload.data_quality : {};
    const scope = payload && payload.scope;
    let generatedAt;
    if (quality.generated_at) {
      const date = new Date(quality.generated_at);
      if (!Number.isNaN(date.getTime())) generatedAt = date.toLocaleString('fr-FR');
    }
    return {
      // L3 — périmètre de recette : faits simulés, jamais présentés comme activité réelle.
      stateLabel: payload && payload.simulation
        ? `Recette ${payload.simulation.scope} — faits simulés`
        : (quality.scope_enforced === false ? 'Scope à vérifier' : 'Source canonique'),
      ...(payload && payload.simulation ? { simulationLabel: payload.simulation.label } : {}),
      scopeLabel: scope && scope.mode === 'market' && scope.market ? `${scope.market.code} · ${scope.market.name || ''}`.trim() : 'Vue autorisée',
      generatedAt,
      qualityLabel: payload && payload.period != null ? `Période : ${base.formatNumber(payload.period, 0)} jours` : undefined,
      ...(Array.isArray(quality.warnings) && quality.warnings.length ? { warningLabel: `${quality.warnings.length} warning(s)` } : {}),
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

  function periodControl(doc, period, onPeriodChange) {
    const toolbar = doc.createElement('div');
    toolbar.className = 'kmc-decision-toolbar';
    const copy = doc.createElement('div');
    copy.className = 'kmc-decision-toolbar-copy';
    copy.appendChild(text(doc, 'span', 'kmc-decision-toolbar-label', 'Période observée'));
    copy.appendChild(text(doc, 'strong', 'kmc-decision-toolbar-value', `${period} jours`));
    toolbar.appendChild(copy);
    const select = doc.createElement('select');
    select.className = 'kmc-decision-toolbar-select';
    select.setAttribute('aria-label', 'Période Finance');
    ['7', '30', '90'].forEach(value => {
      const option = doc.createElement('option');
      option.value = value;
      option.textContent = `${value} jours`;
      if (String(period) === value) option.selected = true;
      select.appendChild(option);
    });
    if (typeof onPeriodChange === 'function') {
      select.addEventListener('change', event => {
        Promise.resolve(onPeriodChange(event.target.value)).catch(() => {});
      });
    }
    toolbar.appendChild(select);
    return toolbar;
  }

  // ── FIN-03 : composition du mock Finance validé (KPI, fiabilité, bandeaux, panneaux). Présentation seule. ──
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const ICON_PATHS = Object.freeze({
    bars: 'M5 20V11M12 20V4M19 20v-6',
    coins: 'M12 4c4.4 0 8 1.1 8 2.5S16.4 9 12 9 4 7.9 4 6.5 7.6 4 12 4zM4 6.5v4C4 11.9 7.6 13 12 13s8-1.1 8-2.5v-4M4 10.5v4c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5v-4',
    trend: 'M4 17l5-5 4 4 7-8M15 8h5v5',
    doc: 'M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6',
    swap: 'M7 8h12m0 0l-3-3m3 3l-3 3M17 16H5m0 0l3-3m-3 3l3 3',
    up: 'M12 19V5m0 0l-6 6m6-6l6 6',
    down: 'M12 5v14m0 0l-6-6m6 6l6-6',
    clock: 'M12 7v5l3 2M12 3a9 9 0 100 18 9 9 0 000-18z',
    equals: 'M6 9h12M6 15h12',
    minus: 'M7 12h10',
    arrow: 'M5 12h14m0 0l-6-6m6 6l-6 6',
    info: 'M12 11v5M12 8h.01M12 3a9 9 0 100 18 9 9 0 000-18z',
    book: 'M4 5h6a2 2 0 012 2v12a2 2 0 00-2-2H4zM20 5h-6a2 2 0 00-2 2v12a2 2 0 012-2h6z',
    chevron: 'M6 9l6 6 6-6',
  });

  function icon(doc, name, className) {
    const wrap = el(doc, 'span', `kmc-fin3-icon${className ? ` ${className}` : ''}`);
    wrap.setAttribute('aria-hidden', 'true');
    if (typeof doc.createElementNS === 'function') {
      const svg = doc.createElementNS(SVG_NS, 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('fill', 'none');
      svg.setAttribute('stroke', 'currentColor');
      svg.setAttribute('stroke-width', '1.8');
      svg.setAttribute('stroke-linecap', 'round');
      svg.setAttribute('stroke-linejoin', 'round');
      const path = doc.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', ICON_PATHS[name] || ICON_PATHS.info);
      svg.appendChild(path);
      wrap.appendChild(svg);
    }
    return wrap;
  }

  function plural(base, n, one, many) {
    return `${base.formatNumber(n, 0)} ${Number(n) > 1 ? many : one}`;
  }

  function setWidth(node, percent) {
    const bounded = Math.max(0, Math.min(100, Number(percent) || 0));
    node.setAttribute('data-percent', String(bounded));
    if (node.style) node.style.width = `${bounded}%`;
  }

  // Trois KPI de synthèse validés (2026-10-21). Valeurs et aides = projection canonique existante ; seule la marge reçoit son périmètre
  // (commandes finalisées / commandes encaissées) fourni par le serveur — jamais recalculé ici.
  function kpiCards(payload, base) {
    const projected = base.projectMetrics(payload);
    const scope = payload && payload.margin_scope ? payload.margin_scope : null;
    let marginHelper = projected.marge && projected.marge.helper;
    if (scope && scope.eligible_margin_pct != null) {
      marginHelper = `${base.formatNumber(scope.eligible_margin_pct, 1)} % sur ${base.formatNumber(scope.eligible_orders, 0)}/${base.formatNumber(scope.paid_orders, 0)} commandes payées finalisées`;
    }
    const cards = [
      { key: 'ca-encaisse', label: 'Commandes payées — part hors avoir', icon: 'bars', tone: 'info', helper: 'Somme des commandes payées créées sur la période, hors part réglée par avoir. Ni chiffre d’affaires comptable, ni encaissement attesté.', note: 'ca-encaisse' },
      { key: 'cout-reel', label: 'Coûts constatés', icon: 'coins', tone: 'warning', helper: 'Coûts directement imputés aux commandes, selon les justificatifs disponibles ; engagements non constatés exclus.', note: 'cout-reel' },
      {
        key: 'marge', label: 'Marge réelle finalisée', icon: 'trend', tone: 'positive', helper: marginHelper, note: 'marge',
        badge: scope && scope.eligible_orders > 0 ? 'Finalisée' : null,
      },
    ];
    return cards
      .filter(card => projected[card.key])
      .map(card => {
        const value = projected[card.key].value;
        // Aucune commande finalisée : la marge réelle est INCONNUE, jamais « 0 KMF » (ni ton positif).
        if (card.key === 'marge' && scope && Number(scope.eligible_orders) === 0) {
          return { ...card, value: '—', tone: 'neutral', badge: null, helper: `Aucune commande finalisée (0/${base.formatNumber(scope.paid_orders, 0)} payées)`, unknown: true };
        }
        return { ...card, value };
      });
  }

  function renderKpiCard(doc, card, openHelp) {
    const node = el(doc, 'div', `kmc-fin3-kpi is-${card.key} tone-${card.tone}`);
    node.setAttribute('data-kpi', card.key);
    if (card.badge) node.classList.add('has-badge');
    if (card.unknown) node.classList.add('is-unknown');
    if (card.ring != null) {
      const ring = el(doc, 'span', 'kmc-fin3-ring');
      ring.setAttribute('aria-hidden', 'true');
      if (ring.style && ring.style.setProperty) ring.style.setProperty('--kmc-fin3-ring', `${Math.max(0, Math.min(100, card.ring))}%`);
      node.appendChild(ring);
    } else {
      node.appendChild(icon(doc, card.icon, 'kmc-fin3-kpi-icon'));
    }
    const body = el(doc, 'div', 'kmc-fin3-kpi-body');
    const label = el(doc, 'div', 'kmc-fin3-kpi-label');
    label.appendChild(el(doc, 'span', '', card.label));
    const info = el(doc, 'button', 'kmc-fin3-info');
    info.setAttribute('type', 'button');
    info.setAttribute('aria-label', `Comprendre : ${card.label}`);
    info.appendChild(icon(doc, 'info'));
    info.addEventListener('click', () => openHelp(card.note));
    label.appendChild(info);
    body.appendChild(label);
    body.appendChild(el(doc, 'strong', 'kmc-fin3-kpi-value', card.value));
    if (card.helper) body.appendChild(el(doc, 'span', 'kmc-fin3-kpi-helper', card.helper));
    node.appendChild(body);
    if (card.badge) node.appendChild(el(doc, 'span', 'kmc-fin3-badge', card.badge));
    return node;
  }

  function renderReliability(doc, payload, base, notes) {
    const row = el(doc, 'div', 'kmc-fin3-reliability');
    const item = completenessProgress(payload, base)[0] || null;
    const card = el(doc, 'div', 'kmc-fin3-reliability-card');
    card.appendChild(el(doc, 'strong', 'kmc-fin3-reliability-title', 'Fiabilité des coûts'));
    const track = el(doc, 'div', 'kmc-fin3-bar');
    track.setAttribute('role', 'progressbar');
    track.setAttribute('aria-label', 'Fiabilité des coûts');
    track.setAttribute('aria-valuemin', '0');
    track.setAttribute('aria-valuemax', '100');
    const fill = el(doc, 'span', 'kmc-fin3-bar-fill');
    if (item) { setWidth(fill, item.percent); track.setAttribute('aria-valuenow', String(Math.round(item.percent))); }
    track.appendChild(fill);
    card.appendChild(track);
    card.appendChild(el(doc, 'span', 'kmc-fin3-reliability-meta', item ? (item.helper || item.value) : 'Non évaluée'));
    row.appendChild(card);

    const panel = el(doc, 'div', 'kmc-fin3-help');
    panel.setAttribute('id', 'finance-indicator-help');
    panel.hidden = true;
    const notesHost = el(doc, 'div', 'kmc-fin-notes');
    notes.forEach(note => {
      const block = el(doc, 'div', 'kmc-fin-notes-item');
      block.setAttribute('data-indicator-note', note.key);
      block.appendChild(el(doc, 'strong', 'kmc-fin-notes-title', note.title));
      block.appendChild(el(doc, 'span', 'kmc-fin-notes-text', note.text));
      notesHost.appendChild(block);
    });
    panel.appendChild(notesHost);

    const toggle = el(doc, 'button', 'kmc-fin3-help-toggle');
    toggle.setAttribute('type', 'button');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', 'finance-indicator-help');
    toggle.appendChild(icon(doc, 'book'));
    toggle.appendChild(el(doc, 'span', '', 'Comprendre les indicateurs'));
    toggle.appendChild(icon(doc, 'chevron', 'kmc-fin3-chevron'));
    const setOpen = open => {
      panel.hidden = !open;
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    };
    toggle.addEventListener('click', () => setOpen(panel.hidden));
    row.appendChild(toggle);
    const openHelp = key => {
      setOpen(true);
      const target = key && panel.querySelector ? panel.querySelector(`[data-indicator-note="${key}"]`) : null;
      if (target && typeof target.scrollIntoView === 'function') target.scrollIntoView({ block: 'nearest' });
    };
    return { row, panel, openHelp, toggle };
  }

  function bannerNode(doc, spec) {
    const node = el(doc, 'div', `kmc-fin3-banner tone-${spec.tone}`);
    node.setAttribute('data-banner', spec.key);
    node.appendChild(icon(doc, spec.icon, 'kmc-fin3-banner-icon'));
    const body = el(doc, 'div', 'kmc-fin3-banner-body');
    body.appendChild(el(doc, 'strong', 'kmc-fin3-banner-title', spec.title));
    body.appendChild(el(doc, 'span', 'kmc-fin3-banner-value', spec.value));
    if (spec.helper) body.appendChild(el(doc, 'span', 'kmc-fin3-banner-helper', spec.helper));
    node.appendChild(body);
    const link = el(doc, 'a', 'kmc-fin3-banner-action', spec.actionLabel);
    link.setAttribute('href', spec.href);
    link.appendChild(icon(doc, 'arrow'));
    node.appendChild(link);
    return node;
  }

  function varianceBannerValue(vs, base) {
    const over = vs.overrun.orders;
    const save = vs.saving.orders;
    if (over && !save) return plural(base, over, 'surcoût confirmé', 'surcoûts confirmés');
    if (save && !over) return plural(base, save, 'économie confirmée', 'économies confirmées');
    if (over && save) return plural(base, over + save, 'écart confirmé', 'écarts confirmés');
    return 'Aucun écart confirmé';
  }

  function varianceBannerHelper(vs) {
    const parts = [];
    if (vs.provisional.orders) parts.push(`${vs.provisional.orders} provisoire(s)`);
    if (vs.not_comparable.orders) parts.push(`${vs.not_comparable.orders} non comparable(s)`);
    if (vs.none.orders) parts.push(`${vs.none.orders} sans écart`);
    return parts.join(' · ');
  }

  function banners(payload, base) {
    const list = [];
    const incomplete = kpi(payload, 'cmds_cout_incomplet');
    if (incomplete && incomplete.value != null) {
      const n = Number(incomplete.value);
      list.push({
        key: 'incomplete-costs', tone: n > 0 ? 'warning' : 'positive', icon: 'doc', title: 'Coûts restant à établir',
        value: plural(base, n, 'commande', 'commandes'),
        helper: n > 0 ? 'En attente d’un coût justifié à leur stade' : 'Aucun coût attendu non enregistré à ce stade',
        href: '#finance-incomplete-costs', actionLabel: 'Voir les commandes',
      });
    }
    const vs = payload && payload.variance_summary;
    if (vs && vs.orders_considered > 0) {
      list.push({
        key: 'observed-variances', tone: vs.overrun.orders > 0 ? 'warning' : 'info', icon: 'swap', title: 'Écarts entre coûts prévus et constatés',
        value: varianceBannerValue(vs, base), helper: varianceBannerHelper(vs),
        href: '#finance-variances', actionLabel: 'Analyser les écarts',
      });
    }
    return list;
  }

  function flagNode(doc, code) {
    const wrap = el(doc, 'span', 'kmc-fin3-market');
    if (code) {
      const img = el(doc, 'img', 'kmc-fin3-flag');
      img.setAttribute('src', `/dashboards/canonical/assets/flags/${encodeURIComponent(code)}.svg`);
      img.setAttribute('alt', '');
      img.setAttribute('width', '20');
      img.setAttribute('height', '20');
      img.addEventListener('error', () => { img.hidden = true; });
      wrap.appendChild(img);
    }
    wrap.appendChild(el(doc, 'span', '', code || '—'));
    return wrap;
  }

  const PANEL_ROWS = 5;

  function renderFollowUpPanel(doc, payload, base) {
    const rows = Array.isArray(payload && payload.incomplete_cost_orders) ? payload.incomplete_cost_orders : [];
    const { section, body } = cardSection(doc, 'Coûts restant à établir', 'Commandes en attente d’un coût justifié à leur stade.', 'finance-incomplete-costs');
    section.classList.add('kmc-fin3-panel');
    section.setAttribute('data-dashboard-role', 'secondary');
    const head = section.querySelector ? section.querySelector('h2') : null;
    if (head) head.appendChild(el(doc, 'span', 'kmc-fin3-pill', plural(base, rows.length, 'commande', 'commandes')));
    if (!rows.length) {
      body.appendChild(el(doc, 'p', 'kmc-finance-review-empty', 'Aucune commande n’a de coût attendu non enregistré à ce stade.'));
      return section;
    }
    const wrap = el(doc, 'div', 'kmc-fin3-table-wrap');
    const table = el(doc, 'table', 'kmc-fin3-table');
    const thead = doc.createElement('thead');
    const hr = doc.createElement('tr');
    ['Commande', 'Marché', 'Statut', 'Étape', 'Action'].forEach(h => hr.appendChild(el(doc, 'th', h === 'Action' ? 'is-action' : '', h)));
    thead.appendChild(hr);
    table.appendChild(thead);
    const tbody = doc.createElement('tbody');
    rows.slice(0, PANEL_ROWS).forEach(row => {
      const items = followUpRows(row);
      const due = items.filter(i => i.group === 'to_establish').length;
      const later = items.length - due;
      const tr = doc.createElement('tr');
      tr.setAttribute('data-order-ref', row.reference || '');
      const cell = (label, node, className) => {
        const td = el(doc, 'td', className || '');
        td.setAttribute('data-label', label);
        td.appendChild(node);
        tr.appendChild(td);
      };
      cell('Commande', el(doc, 'strong', 'kmc-fin3-ref', row.reference || 'Commande'));
      cell('Marché', flagNode(doc, row.market_code));
      cell('Statut', el(doc, 'span', `kmc-fin3-status status-${row.status || 'unknown'}`, STATUS_LABELS[row.status] || row.status || '—'));
      cell('Étape', el(doc, 'span', 'kmc-fin3-step', `${due} à établir · ${later} pas encore dû(s)`));
      const go = actionLink(doc, orderHref(base, row.reference), '');
      if (go) {
        go.className = 'kmc-fin3-go';
        go.setAttribute('aria-label', `Ouvrir la commande ${row.reference} (360)`);
        go.appendChild(icon(doc, 'arrow'));
      }
      cell('Action', go || el(doc, 'span', '', '—'), 'is-action');
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    body.appendChild(wrap);
    const foot = el(doc, 'a', 'kmc-fin3-footlink', 'Voir toutes les commandes');
    foot.setAttribute('href', '#finance-incomplete-detail');
    foot.setAttribute('data-open-detail', 'finance-incomplete-detail');
    foot.appendChild(icon(doc, 'arrow'));
    body.appendChild(foot);
    return section;
  }

  const VARIANCE_ICONS = Object.freeze({ overrun: 'up', saving: 'down', provisional: 'clock', not_comparable: 'equals', none: 'minus' });

  function renderVariancePanel(doc, payload, base) {
    const vs = payload && payload.variance_summary;
    const { section, body } = cardSection(doc, 'Écarts entre coûts prévus et constatés', 'Écarts confirmés et comparaisons encore provisoires.', 'finance-variances');
    section.classList.add('kmc-fin3-panel');
    section.setAttribute('data-dashboard-role', 'secondary');
    if (!vs) {
      body.appendChild(el(doc, 'p', 'kmc-finance-review-empty', 'Aucune commande à comparer sur la période.'));
      return section;
    }
    const head = section.querySelector ? section.querySelector('h2') : null;
    if (head) head.appendChild(el(doc, 'span', 'kmc-fin3-pill', `${base.formatNumber(vs.orders_considered, 0)} commandes analysées`));
    const list = el(doc, 'ul', 'kmc-fin3-variance-list');
    VARIANCE_ORDER.forEach(key => {
      const entry = vs[key] || { orders: 0 };
      const li = el(doc, 'li', `kmc-fin3-variance is-${key}`);
      li.setAttribute('data-variance-class', key);
      li.appendChild(icon(doc, VARIANCE_ICONS[key], 'kmc-fin3-variance-icon'));
      const text = el(doc, 'div', 'kmc-fin3-variance-text');
      text.appendChild(el(doc, 'strong', '', CLASS_TITLES[key]));
      text.appendChild(el(doc, 'span', '', CLASS_SHORT_HELP[key]));
      li.appendChild(text);
      li.appendChild(el(doc, 'span', 'kmc-fin3-variance-count', plural(base, entry.orders, 'commande', 'commandes')));
      const go = el(doc, 'a', 'kmc-fin3-go');
      go.setAttribute('href', '#finance-variance-detail');
      go.setAttribute('data-open-detail', 'finance-variance-detail');
      go.setAttribute('data-variance-filter', key);
      go.setAttribute('aria-label', `Voir les écarts : ${CLASS_TITLES[key]}`);
      go.appendChild(icon(doc, 'arrow'));
      li.appendChild(go);
      list.appendChild(li);
    });
    body.appendChild(list);
    const foot = el(doc, 'a', 'kmc-fin3-footlink', 'Voir l’analyse complète des écarts');
    foot.setAttribute('href', '#finance-variance-detail');
    foot.setAttribute('data-open-detail', 'finance-variance-detail');
    foot.appendChild(icon(doc, 'arrow'));
    body.appendChild(foot);
    return section;
  }

  function detailBlock(doc, id, title) {
    const details = el(doc, 'details', 'kmc-fin3-detail');
    details.setAttribute('id', id);
    details.appendChild(el(doc, 'summary', 'kmc-fin3-detail-summary', title));
    const body = el(doc, 'div', 'kmc-fin3-detail-body');
    details.appendChild(body);
    return { details, body };
  }

  // Les liens « Voir … » ouvrent le détail canonique (composantes, responsables, commande 360) ; un filtre de classe
  // masque simplement les commandes des autres classes (aucun recalcul).
  function wireDetailLinks(root) {
    if (!root || typeof root.querySelectorAll !== 'function') return;
    root.querySelectorAll('[data-open-detail]').forEach(link => {
      link.addEventListener('click', event => {
        const target = root.querySelector(`#${link.getAttribute('data-open-detail')}`);
        if (!target) return;
        event.preventDefault();
        target.open = true;
        const filter = link.getAttribute('data-variance-filter');
        target.querySelectorAll('details[data-order-ref]').forEach(order => {
          order.hidden = !!filter && !order.classList.contains(`is-${filter}`);
        });
        if (typeof target.scrollIntoView === 'function') target.scrollIntoView({ block: 'start', behavior: 'smooth' });
      });
    });
  }

  function scopeLabel(payload) {
    const sim = payload && payload.simulation;
    return sim && sim.scope ? ` · ${sim.scope}` : '';
  }


  // Liens utiles (P1 léger) : aucun nouveau KPI, aucune nouvelle logique — passages vers les lieux qui portent déjà la suite.
  function renderUsefulLinks(doc, payload, base, user) {
    const nav = el(doc, 'nav', 'kmc-fin3-links');
    nav.setAttribute('data-finance-links', '');
    nav.setAttribute('aria-label', 'Accès utiles Finance');
    const loc = typeof globalThis !== 'undefined' && globalThis.location ? globalThis.location : null;
    const returnTo = loc ? `${loc.pathname || '/admin/finance'}${loc.search || ''}` : '/admin/finance';
    const known = Array.isArray(payload && payload.incomplete_cost_orders);
    const rows = known ? payload.incomplete_cost_orders : [];
    const first = rows.length ? rows[0].reference : null;
    const toFinalize = first
      ? actionLink(doc, orderHref(base, first), `Commandes aux coûts à établir (${payload.incomplete_cost_orders_total != null ? payload.incomplete_cost_orders_total : rows.length}) →`)
      : el(doc, 'span', 'kmc-fin3-links-muted', known ? 'Aucune commande à finaliser' : 'Commandes à finaliser : non disponible');
    if (first) toFinalize.setAttribute('data-finance-link', 'orders-to-finalize');
    nav.appendChild(toFinalize);
    const role = user && user.role;
    if (!role || ['admin', 'market_operator'].includes(role)) {
      const analysis = actionLink(doc, base.contextualHref('/admin/workspaces/pricing', returnTo, 'Retour à Finance'), 'Analyse économique par produit →');
      analysis.setAttribute('data-finance-link', 'economic-analysis');
      nav.appendChild(analysis);
    }
    return nav;
  }

  function render(rootNode, payload, options, base, decisionUi) {
    const doc = options.document;
    rootNode.replaceChildren();
    rootNode.className = '';

    const dashboard = doc.createElement('article');
    dashboard.className = 'kmc-dashboard kmc-decision-dashboard kmc-domain-cockpit kmc-fin3';
    // Pas de bandeau « À quoi sert cet écran » : le mock validé n'en comporte pas (l'aide vit dans « Comprendre les indicateurs »).
    dashboard.setAttribute('data-dashboard-id', 'finance');
    dashboard.setAttribute('data-dashboard-visual', 'finance-mock-v1');

    const period = options.period || payload.period || '30';
    const header = doc.createElement('header');
    header.className = 'kmc-dashboard-header';
    header.setAttribute('data-dashboard-role', 'hero');
    header.appendChild(text(doc, 'p', 'canonical-eyebrow', 'FINANCE'));
    header.appendChild(text(doc, 'h1', 'kmc-dashboard-title', 'Performance financière'));
    header.appendChild(text(doc, 'p', 'kmc-dashboard-description', `Vue consolidée des commandes · ${period} jours${scopeLabel(payload)}`));
    header.appendChild(periodControl(doc, period, options.onPeriodChange));
    dashboard.appendChild(header);

    const notes = indicatorNotes(payload, base);
    const reliability = renderReliability(doc, payload, base, notes);

    const kpis = el(doc, 'section', 'kmc-fin3-kpis');
    kpis.setAttribute('id', 'finance-situation');
    kpis.setAttribute('data-dashboard-role', 'primary');
    kpiCards(payload, base).forEach(card => kpis.appendChild(renderKpiCard(doc, card, reliability.openHelp)));
    dashboard.appendChild(kpis);
    dashboard.appendChild(renderUsefulLinks(doc, payload, base, options.user));

    // Fiabilité et rapprochements restent dans les dossiers métier, non sur la synthèse Finance.
    dashboard.appendChild(reliability.panel);

    const bannerSpecs = []; // Les coûts à établir et écarts sont traités dans les espaces opérationnels.
    if (bannerSpecs.length) {
      const host = el(doc, 'div', 'kmc-fin3-banners');
      host.setAttribute('data-dashboard-role', 'attention');
      bannerSpecs.forEach(spec => host.appendChild(bannerNode(doc, spec)));
      dashboard.appendChild(host);
    }

    // Autres alertes réelles (paiements en attente, paiements fournisseur à revoir, remboursements) : visibles seulement si présentes.
    const extra = decisionItems(payload, base).filter(item => !['incomplete-costs', 'observed-variances'].includes(item.key));
    if (extra.length) {
      const host = el(doc, 'div', 'kmc-cockpit-decisions kmc-dashboard-attention-band kmc-fin3-extra');
      decisionUi.DecisionStrip.render(host, { items: extra });
      dashboard.appendChild(host);
    }

    // Pas de tableaux de rapprochement sur la page principale Finance.

    const incompleteDetail = detailBlock(doc, 'finance-incomplete-detail', 'Détail des commandes à suivre');
    renderIncompleteOrders(doc, incompleteDetail.body, payload, base);
    const varianceDetail = detailBlock(doc, 'finance-variance-detail', 'Détail des écarts par commande');
    renderVariances(doc, varianceDetail.body, payload, base);
    const details = el(doc, 'div', 'kmc-fin3-details');
    // Les composants détaillés sont conservés côté code pour migration vers leurs ateliers propriétaires.

    // Une file centrale absente de la projection marché n'est jamais assimilée à zéro.
    const supplierState = supplierReviewState(payload);
    const supplierPayments = supplierPaymentReviewItems(payload, base);
    const review = cardSection(doc, 'Paiements fournisseurs à revoir',
      'File de rapprochement centrale, hors filtre de période.', 'finance-supplier-payments');
    review.section.setAttribute('data-dashboard-role', 'secondary');
    review.section.setAttribute('data-review-state', supplierState.state);
    if (supplierState.state === 'rows') {
      const reviewHost = el(doc, 'div', 'kmc-finance-essential-review');
      decisionUi.RankedList.render(reviewHost, { items: supplierPayments });
      review.body.appendChild(reviewHost);
    } else {
      review.body.appendChild(el(doc, 'p', 'kmc-finance-review-empty', supplierState.message));
    }
    dashboard.appendChild(review.section);

    rootNode.appendChild(dashboard);
    wireDetailLinks(dashboard);
    return { element: dashboard, visual: 'finance-mock-v1' };
  }

  function enhance(base, decisionUi) {
    if (!base || typeof base.mount !== 'function') throw new Error('finance_decision_base_missing');
    const baseMount = base.mount;
    const enhanced = {
      ...base,
      mount(options) {
        return baseMount(options).then(result => {
          const rerender = nextPeriod => enhanced.mount({ ...options, period: nextPeriod });
          return {
            ...result,
            result: render(options.root, result.payload, { ...options, period: result.period, onPeriodChange: rerender }, base, decisionUi),
            decisionFirst: true,
          };
        });
      },
      projectDecisionItems: payload => decisionItems(payload, base),
      projectMetricItems: payload => metricItems(payload, base),
      projectHeadlineMetrics: payload => headlineMetrics(payload, base),
      projectOverviewCards: payload => overviewCards(payload, base),
      projectCompletenessProgress: payload => completenessProgress(payload, base),
      projectTrendItems: payload => trendItems(payload, base),
      projectCostingItems: payload => costingItems(payload, base),
      projectIncompleteCostOrderItems: payload => incompleteCostOrderItems(payload, base),
      projectVarianceItems: payload => varianceItems(payload, base),
      projectPaymentItems: payload => paymentItems(payload, base),
      projectRelayItems: payload => relayItems(payload, base),
      projectRefundItems: payload => refundItems(payload, base),
      projectSupplierPaymentReviewItems: payload => supplierPaymentReviewItems(payload, base),
      projectDrillCards: user => drillCards(base, user),
      projectTrust: payload => trust(payload, base),
    };
    return Object.freeze(enhanced);
  }

  return Object.freeze({
    kpi,
    displayMetric,
    decisionItems,
    metricItems,
    headlineMetrics,
    overviewCards,
    completenessProgress,
    trendItems,
    costingItems,
    incompleteCostOrderItems,
    varianceItems,
    indicatorNotes,
    varianceHelper,
    kpiCards,
    banners,
    paymentItems,
    relayItems,
    refundItems,
    supplierPaymentReviewItems,
    supplierReviewState,
    drillCards,
    trust,
    render,
    enhance,
  });
});

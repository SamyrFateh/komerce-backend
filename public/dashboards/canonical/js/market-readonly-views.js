/**
 * @komerce-arch
 * @role          market-autonomy-readonly-views-ui
 * @domain        market-autonomy
 * @layer         ui-workspace
 * @criticality   medium
 * @inputs        authenticated user, server admin context, market-delegation read projections (performance, cost-statement, customs-shipments, payment-accounts)
 * @outputs       four read-only sections: performance, coûts, douane et expéditions, comptes de paiement
 * @depends       /api/admin/dashboard/context, /api/market-delegation/markets/:marketCode/{performance,cost-statement,customs-shipments,payment-accounts}
 * @used-by       /dashboards/canonical/market-autonomy.html
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      ui_never_grants_more_than_server_actor_capabilities, server_scope_is_authority, read_only_projection_never_a_new_truth
 * @impact-areas  admin-dashboard, market-autonomy, market-delegation, finance
 * @version       2026-10
 */
'use strict';

/**
 * Même patron que market-settlement.js : une section par projection, ajoutée sous
 * « Mon Market » après le rendu du workspace. Aucune écriture, aucun calcul métier :
 * chaque valeur affichée est un champ de la réponse serveur. Une capacité absente (403)
 * retire la section, elle ne la grise pas. Les montants `_kmf` sont libellés « KMF » :
 * c'est l'unité comptable de la plateforme, pas la devise locale du Market.
 */
(function bootMarketReadonlyViews(global) {
  const root = global.document && global.document.getElementById('market-autonomy-root');
  if (!root) return;

  const mounting = new Set();
  const denied = new Set();

  const ORIGIN_LABEL = Object.freeze({
    MARKET_DIRECT: 'Charge directe du Market',
    GROUP_ATTRIBUTED: 'Part attribuée par le siège',
  });
  const ACCOUNT_STATUS_LABEL = Object.freeze({
    DRAFT: 'Brouillon', ACTIVE: 'Actif', SUSPENDED: 'Suspendu', CLOSED: 'Fermé',
  });

  function el(tag, className, value) {
    const node = global.document.createElement(tag);
    if (className) node.className = className;
    if (value != null) node.textContent = String(value);
    return node;
  }

  async function request(url) {
    const response = await global.fetch(url, { method: 'GET', credentials: 'include', headers: { Accept: 'application/json' } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body.error || `HTTP ${response.status}`);
      error.status = response.status;
      error.code = body.code || null;
      throw error;
    }
    return body;
  }

  function marketFromContext(context) {
    const access = context && context.access || {};
    const allowed = Array.isArray(access.allowedMarkets) ? access.allowedMarkets : [];
    const requested = new URL(global.location.href).searchParams.get('market');
    if (requested && allowed.includes(requested.toUpperCase())) return requested.toUpperCase();
    if (access.defaultMarket && allowed.includes(access.defaultMarket)) return access.defaultMarket;
    return allowed[0] || null;
  }

  function pill(value, active = false) {
    return el('span', `kmc-team-pill${active ? ' is-active' : ''}`, value);
  }

  const dash = value => (value == null || value === '' ? '—' : String(value));
  const day = value => (value ? String(value).slice(0, 10) : '—');
  const kmf = value => {
    if (value == null || value === '') return '—';
    const n = Number(value);
    return Number.isFinite(n) ? `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(n)} KMF` : '—';
  };

  function row(label, value) {
    const node = el('div', 'kmc-team-help');
    node.appendChild(el('strong', '', `${label} : `));
    node.appendChild(global.document.createTextNode(value));
    return node;
  }

  function item(title, subtitle, statePill) {
    const card = el('article', 'kmc-team-member');
    const head = el('div', 'kmc-team-member-head');
    const copy = el('div', 'kmc-team-member-copy');
    copy.appendChild(el('strong', '', title));
    if (subtitle) copy.appendChild(el('small', '', subtitle));
    head.appendChild(copy);
    if (statePill) head.appendChild(statePill);
    card.appendChild(head);
    return card;
  }

  // ── Rendu de chaque projection : uniquement des champs fournis par le serveur ──────────────

  function renderPerformance(section, data) {
    const market = data.market || {};
    section.appendChild(el('p', 'kmc-workspace-note', `Ce que le Market produit, pas ce que le partenaire touche. Période ${data.period && data.period.from ? `${day(data.period.from)} → ${day(data.period.to)}` : 'non précisée'}.`));
    if (data.status !== 'AVAILABLE') {
      const card = item('Performance non décisionnelle', data.reason ? `Motif serveur : ${data.reason}` : null, pill('Non décisionnel'));
      section.appendChild(card);
    }
    const a = data.activity;
    const c = data.contribution;
    const s = data.structure_costs;
    const cov = data.coverage;
    const card = item(`${market.name || market.code || ''}`, `Devise locale ${dash(market.currency)} · montants en KMF (unité comptable plateforme)`, pill(data.status === 'AVAILABLE' ? 'Disponible' : 'Partiel', data.status === 'AVAILABLE'));
    if (a) {
      card.appendChild(row('Commandes matures', dash(a.mature_order_count)));
      card.appendChild(row('Chiffre d’affaires', kmf(a.revenue_kmf)));
      card.appendChild(row('Coûts variables de transaction', kmf(a.transaction_variable_cost_kmf)));
    }
    if (c) {
      card.appendChild(row('Contribution avant risque', kmf(c.before_risk_kmf)));
      card.appendChild(row('Contribution réconciliée', kmf(c.reconciled_kmf)));
      card.appendChild(row('Coût du risque constaté', kmf(c.actual_risk_cost_kmf)));
    }
    if (s) {
      card.appendChild(row('Charges de structure du Market', `${kmf(s.market_n3_total_kmf)}${s.decisional ? '' : ' (non décisionnel)'}`));
    }
    if (cov) {
      card.appendChild(row('Couverture des charges', `${dash(cov.ratio)} · ${dash(cov.status)}`));
    }
    if (!a && !c && !s && !cov) card.appendChild(el('div', 'kmc-team-empty', 'Aucune donnée de performance exposée pour cette période.'));
    section.appendChild(card);
    if (data.settlement_basis && data.settlement_basis.note) section.appendChild(el('div', 'kmc-team-help', data.settlement_basis.note));
    if (data.evaluated_at) section.appendChild(el('div', 'kmc-team-help', `Évalué le ${day(data.evaluated_at)}`));
  }

  function renderCostStatement(section, data) {
    const totals = data.totals || {};
    section.appendChild(el('p', 'kmc-workspace-note', `Relevé des charges du Market (base ${dash(data.currency_basis)}). Lecture seule : les corrections restent au siège.`));
    const summary = el('div', 'kmc-team-summary');
    summary.appendChild(pill(`Direct ${kmf(totals.direct_kmf)}`));
    summary.appendChild(pill(`Attribué siège ${kmf(totals.group_attributed_kmf)}`));
    summary.appendChild(pill(`Total ${kmf(totals.total_kmf)}`, true));
    section.appendChild(summary);
    if (Array.isArray(data.not_covered) && data.not_covered.length) {
      section.appendChild(el('div', 'kmc-team-help', `Hors périmètre de ce relevé : ${data.not_covered.map(k => (k === 'purchase_rebilling' ? 'refacturation des achats' : k)).join(', ')}.`));
    }
    const list = el('div', 'kmc-team-list');
    const lines = Array.isArray(data.lines) ? data.lines : [];
    if (!lines.length) list.appendChild(el('div', 'kmc-team-empty', 'Aucune charge sur cette période.'));
    lines.forEach(line => {
      const card = item(`${dash(line.charge_name)} · ${kmf(line.amount_kmf)}`,
        `${day(line.economic_from)} → ${day(line.economic_to)} · ${dash(line.charge_family)}`,
        pill(ORIGIN_LABEL[line.origin] || dash(line.origin), line.origin === 'MARKET_DIRECT'));
      list.appendChild(card);
    });
    section.appendChild(list);
    if (data.truncated) section.appendChild(el('div', 'kmc-team-help', 'Liste tronquée par le serveur : affinez la période pour tout voir.'));
  }

  function renderCustoms(section, data) {
    section.appendChild(el('p', 'kmc-workspace-note', 'Coûts de douane et de fret de vos envois. Lecture seule : la gestion des envois reste au siège.'));
    const list = el('div', 'kmc-team-list');
    const shipments = Array.isArray(data.shipments) ? data.shipments : [];
    if (!shipments.length) list.appendChild(el('div', 'kmc-team-empty', 'Aucun envoi sur cette période.'));
    shipments.forEach(s => {
      const card = item(`${dash(s.reference)} · ${day(s.shipment_date)}`,
        `${dash(s.transitaire_name)} · ${dash(s.transport_mode)}`,
        pill(dash(s.status), s.is_active === true));
      card.appendChild(row('Valeur CIF', kmf(s.cif_value_kmf)));
      card.appendChild(row('Douane payée', kmf(s.customs_paid_kmf)));
      card.appendChild(row('Fret', kmf(s.freight_kmf)));
      card.appendChild(row('Poids', s.total_weight_kg == null ? '—' : `${s.total_weight_kg} kg`));
      card.appendChild(row('Taux effectif', s.effective_rate_pct == null ? '—' : `${s.effective_rate_pct} %`));
      card.appendChild(row('Colis rattachés', dash(s.parcels_linked)));
      list.appendChild(card);
    });
    section.appendChild(list);
    if (data.truncated) section.appendChild(el('div', 'kmc-team-help', 'Liste tronquée par le serveur : affinez la période pour tout voir.'));
  }

  function renderPaymentAccounts(section, data) {
    section.appendChild(el('p', 'kmc-workspace-note', 'Comptes marchands déclarés pour ce Market. Lecture seule : création, vérification et activation restent au siège. Aucune clé ni référence de coffre n’est exposée.'));
    const list = el('div', 'kmc-team-list');
    const accounts = Array.isArray(data.accounts) ? data.accounts : [];
    if (!accounts.length) list.appendChild(el('div', 'kmc-team-empty', 'Aucun compte de paiement déclaré pour ce Market.'));
    accounts.forEach(a => {
      const card = item(`${dash(a.provider)}${a.adapter ? ` (${a.adapter})` : ''} · ${dash(a.currency)}`,
        a.external_account_id ? `Compte ${a.external_account_id}` : null,
        pill(ACCOUNT_STATUS_LABEL[a.status] || dash(a.status), a.status === 'ACTIVE'));
      card.appendChild(row('Titulaire du compte', dash(a.account_holder)));
      card.appendChild(row('Vendeur juridique', dash(a.legal_seller)));
      card.appendChild(row('Opérateur du Market', dash(a.market_operator_entity)));
      card.appendChild(row('Remboursements portés par', a.refund_bearer === 'MARKET' ? 'Le Market' : a.refund_bearer === 'PLATFORM' ? 'La plateforme' : dash(a.refund_bearer)));
      card.appendChild(row('Base juridique', dash(a.legal_basis_ref)));
      card.appendChild(row('Vérifié le', day(a.verified_at)));
      list.appendChild(card);
    });
    section.appendChild(list);
  }

  const VIEWS = Object.freeze([
    { key: 'performance', title: 'Performance économique', path: 'performance', render: renderPerformance },
    { key: 'cost-statement', title: 'Relevé de coûts', path: 'cost-statement', render: renderCostStatement },
    { key: 'customs', title: 'Douane et expéditions', path: 'customs-shipments', render: renderCustoms },
    { key: 'payment-accounts', title: 'Comptes de paiement', path: 'payment-accounts', render: renderPaymentAccounts },
  ]);

  async function mountView(view) {
    if (mounting.has(view.key) || denied.has(view.key) || root.querySelector(`[data-market-readonly="${view.key}"]`) || !root.classList.contains('kmc-workspace')) return;
    mounting.add(view.key);
    try {
      const context = await request('/api/admin/dashboard/context');
      const marketCode = marketFromContext(context);
      if (!marketCode) return;
      const section = el('section', 'kmc-section kmc-team-section');
      section.dataset.marketReadonly = view.key;
      section.appendChild(el('h2', 'kmc-section-title', view.title));
      try {
        const data = await request(`/api/market-delegation/markets/${encodeURIComponent(marketCode)}/${view.path}`);
        view.render(section, data);
      } catch (error) {
        if (error.status === 403) { denied.add(view.key); return; } // capacité absente : section absente, jamais grisée
        section.appendChild(el('div', 'kmc-team-empty', `${error.message}${error.code ? ` · ${error.code}` : ''}`));
      }
      root.appendChild(section);
    } finally {
      mounting.delete(view.key);
    }
  }

  function mountAll() { VIEWS.forEach(view => { void mountView(view); }); }

  const observer = new MutationObserver(mountAll);
  observer.observe(root, { childList: true, attributes: true, attributeFilter: ['class'] });
  mountAll();
})(window);

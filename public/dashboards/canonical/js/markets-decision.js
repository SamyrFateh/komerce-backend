/**
 * @komerce-arch
 * @role          canonical-markets-decision-view
 * @domain        admin-dashboard
 * @layer         ui-orchestration
 * @criticality   medium
 * @inputs        server_market_scopes, country_pricing_workspace, local_price_decisions
 * @outputs       decision_first_markets_dom
 * @depends       primitives, decision-primitives
 * @used-by       canonical admin Marches surfaces
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      server_market_scope_is_authority, dashboard_no_business_recompute, country_manager_owns_local_strategy
 * @impact-areas  admin-dashboard, market-authorization, market-autonomy
 * @version       2026-09
 */
'use strict';

(function initMarketsDecision(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.KomerceMarketsDecision = api;
})(typeof globalThis !== 'undefined' ? globalThis : null, function createMarketsDecision() {
  'use strict';

  function text(doc, tag, className, value) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (value != null) node.textContent = String(value);
    return node;
  }

  function operatorUsers(users) {
    return (Array.isArray(users) ? users : []).filter(user => user && user.role === 'market_operator');
  }

  function operatorScopes(users) {
    return operatorUsers(users).flatMap(user => {
      const scopes = Array.isArray(user.market_scopes) ? user.market_scopes : [];
      return scopes.map(scope => ({ ...scope, operator_id: user.id, operator_name: user.full_name || user.email || user.id }));
    });
  }

  function adminProjection(markets, users) {
    const marketRows = Array.isArray(markets) ? markets : [];
    const operators = operatorUsers(users);
    const scopes = operatorScopes(users);
    const managerScopes = scopes.filter(scope => scope.scope_role === 'manager');
    const viewerScopes = scopes.filter(scope => scope.scope_role === 'viewer');
    const managerMarkets = new Set(managerScopes.map(scope => String(scope.market_code || '').toUpperCase()).filter(Boolean));
    const uncovered = marketRows
      .map(market => String(market && market.code || '').toUpperCase())
      .filter(code => code && !managerMarkets.has(code));
    const unscoped = operators.filter(user => !Array.isArray(user.market_scopes) || user.market_scopes.length === 0);

    return Object.freeze({
      markets: marketRows,
      operators,
      scopes,
      managerScopes,
      viewerScopes,
      uncoveredMarkets: uncovered,
      unscopedOperators: unscoped,
    });
  }

  function adminDecisionItems(markets, users) {
    const projection = adminProjection(markets, users);
    const items = [];
    if (projection.uncoveredMarkets.length) {
      items.push({
        key: 'markets-without-manager',
        label: 'Marchés sans manager',
        helper: `Scope manager absent : ${projection.uncoveredMarkets.join(', ')}`,
        value: String(projection.uncoveredMarkets.length),
        tone: 'warning',
        icon: '!',
        href: '#market-access-management',
        actionLabel: 'Attribuer un responsable →',
      });
    }
    if (projection.unscopedOperators.length) {
      items.push({
        key: 'operators-without-scope',
        label: 'Responsables sans scope',
        helper: 'Compte market_operator present mais aucun marche actif',
        value: String(projection.unscopedOperators.length),
        tone: 'critical',
        icon: '!',
        href: '#market-access-management',
        actionLabel: 'Corriger les accès →',
      });
    }
    return items.slice(0, 4);
  }

  function adminMetricItems(markets, users) {
    const projection = adminProjection(markets, users);
    return [
      { key: 'markets', label: 'Marchés visibles', value: String(projection.markets.length), tone: 'neutral' },
      { key: 'operators', label: 'Responsables pays', value: String(projection.operators.length), tone: 'neutral' },
      { key: 'scopes', label: 'Scopes actifs', value: String(projection.scopes.length), tone: 'neutral' },
      { key: 'managers', label: 'Scopes manager', value: String(projection.managerScopes.length), tone: projection.uncoveredMarkets.length ? 'warning' : 'positive' },
      { key: 'viewers', label: 'Scopes viewer', value: String(projection.viewerScopes.length), tone: 'neutral' },
    ];
  }

  function adminMarketItems(markets, users) {
    const scopes = operatorScopes(users);
    return (Array.isArray(markets) ? markets : []).map(market => {
      const code = String(market && market.code || '').toUpperCase();
      const rows = scopes.filter(scope => String(scope.market_code || '').toUpperCase() === code);
      const managers = rows.filter(scope => scope.scope_role === 'manager');
      const viewers = rows.filter(scope => scope.scope_role === 'viewer');
      return {
        title: `${code}${market && market.name && market.name !== code ? ` · ${market.name}` : ''}`,
        helper: `${managers.length} manager(s) · ${viewers.length} viewer(s)`,
        value: managers.length ? 'Manager attribué' : 'Sans manager',
        tone: managers.length ? 'positive' : 'warning',
      };
    });
  }

  function adminTrust() {
    return {
      stateLabel: 'Autorité serveur',
      scopeLabel: 'Scopes Market ID résolus côté serveur',
      qualityLabel: 'Le navigateur ne crée aucune autorité market_id',
    };
  }

  function centralMatrixRows(matrix) {
    return Array.isArray(matrix && matrix.markets) ? matrix.markets : [];
  }

  function centralProjection(matrix) {
    const rows = centralMatrixRows(matrix);
    const members = rows.flatMap(row => Array.isArray(row && row.members) ? row.members : []);
    const leads = members.filter(member => member && member.is_operating_lead === true);
    const marketsWithoutLead = rows.filter(row => !(Array.isArray(row && row.members) ? row.members : [])
      .some(member => member && member.is_operating_lead === true));
    const capabilityGrants = members.reduce((total, member) => total + (Array.isArray(member && member.capabilities) ? member.capabilities.length : 0), 0);
    const suspended = rows.filter(row => row && row.market && row.market.lifecycle_status === 'SUSPENDED');
    return Object.freeze({ rows, members, leads, marketsWithoutLead, capabilityGrants, suspended });
  }

  function centralDecisionItems(matrix) {
    const projection = centralProjection(matrix);
    const items = [];
    if (projection.marketsWithoutLead.length) {
      items.push({
        key: 'markets-without-operating-lead',
        label: 'Marchés sans responsable opérationnel',
        helper: projection.marketsWithoutLead.map(row => row && row.market && row.market.code).filter(Boolean).join(', '),
        value: String(projection.marketsWithoutLead.length),
        tone: 'warning',
        icon: '!',
        href: '#market-access-management',
        actionLabel: 'Gérer les équipes →',
      });
    }
    if (projection.suspended.length) {
      items.push({
        key: 'suspended-markets',
        label: 'Marchés suspendus',
        helper: projection.suspended.map(row => row && row.market && row.market.code).filter(Boolean).join(', '),
        value: String(projection.suspended.length),
        tone: 'warning',
        icon: '•',
        href: '#market-access-management',
        actionLabel: 'Voir les marchés →',
      });
    }
    return items.slice(0, 4);
  }

  function centralMetricItems(matrix) {
    const projection = centralProjection(matrix);
    return [
      { key: 'markets', label: 'Marchés gouvernés', value: String(projection.rows.length), tone: 'neutral' },
      { key: 'members', label: 'Membres actifs', value: String(projection.members.length), tone: 'neutral' },
      { key: 'leads', label: 'Responsables opérationnels', value: String(projection.leads.length), tone: projection.marketsWithoutLead.length ? 'warning' : 'positive' },
      { key: 'capabilities', label: 'Capabilities accordées', value: String(projection.capabilityGrants), tone: 'neutral' },
    ];
  }

  function centralMarketItems(matrix) {
    return centralMatrixRows(matrix).map(row => {
      const market = row && row.market || {};
      const members = Array.isArray(row && row.members) ? row.members : [];
      const lead = members.find(member => member && member.is_operating_lead === true);
      const capabilityCount = members.reduce((total, member) => total + (Array.isArray(member && member.capabilities) ? member.capabilities.length : 0), 0);
      const lastMutation = row && row.last_mutation;
      const mutationLabel = lastMutation && lastMutation.action ? `Dernière mutation : ${lastMutation.action}` : 'Aucune mutation auditée';
      return {
        title: `${market.code || '—'}${market.name && market.name !== market.code ? ` · ${market.name}` : ''}`,
        helper: [lead ? `Lead : ${lead.full_name || lead.email || lead.user_id}` : 'Aucun lead', `${members.length} membre(s)`, `${capabilityCount} capability(s)`, mutationLabel].join(' · '),
        value: lead ? 'Pilotage attribué' : 'Lead manquant',
        tone: lead ? (market.lifecycle_status === 'SUSPENDED' ? 'warning' : 'positive') : 'warning',
      };
    });
  }

  function centralTrust(matrix) {
    return {
      stateLabel: 'Autorité canonique',
      scopeLabel: matrix && matrix.authority === 'dashboard_global_access_grants'
        ? 'Lecture centrale explicitement autorisée'
        : 'Lecture centrale',
      qualityLabel: 'Assignments, memberships et capabilities — read-only',
    };
  }

  function localProducts(prices) {
    return Array.isArray(prices && prices.products) ? prices.products : [];
  }

  function countryProjection(workspace, prices) {
    const products = localProducts(prices);
    const local = products.filter(row => row && row.local_price != null);
    const active = local.filter(row => row.decision_status === 'LOCAL_ACTIVE');
    const pending = local.filter(row => row.decision_status !== 'LOCAL_ACTIVE');
    const caps = workspace && workspace.capabilities ? workspace.capabilities : {};
    return Object.freeze({ products, local, active, pending, capabilities: caps });
  }

  function countryDecisionItems(workspace, prices) {
    const projection = countryProjection(workspace, prices);
    const items = [];
    if (projection.pending.length) {
      items.push({
        key: 'local-prices-pending',
        label: 'Prix locaux à finaliser',
        helper: 'Décision locale présente mais pas encore LOCAL_ACTIVE',
        value: String(projection.pending.length),
        tone: 'warning',
        icon: '!',
        href: '#market-local-prices',
        actionLabel: 'Voir les décisions →',
      });
    }
    if (projection.pending.length && projection.capabilities.local_price_buyer_activation === false) {
      items.push({
        key: 'buyer-activation-unavailable',
        label: 'Activation acheteur indisponible',
        helper: 'Des décisions locales existent mais le cutover acheteur est fermé',
        value: String(projection.pending.length),
        tone: 'critical',
        icon: '×',
      });
    }
    return items.slice(0, 4);
  }

  function countryMetricItems(workspace, prices) {
    const projection = countryProjection(workspace, prices);
    const scope = workspace && workspace.scope ? workspace.scope : {};
    return [
      { key: 'products', label: 'Références observées', value: String(projection.products.length), tone: 'neutral' },
      { key: 'local-decisions', label: 'Décisions locales', value: String(projection.local.length), tone: 'neutral' },
      { key: 'active', label: 'LOCAL_ACTIVE', value: String(projection.active.length), tone: projection.active.length ? 'positive' : 'neutral' },
      { key: 'pending', label: 'À finaliser', value: String(projection.pending.length), tone: projection.pending.length ? 'warning' : 'neutral' },
      { key: 'currency', label: 'Devise pays', value: scope.market_currency || (prices && prices.market && prices.market.currency) || '—', tone: 'neutral' },
    ];
  }

  function countryPriceItems(prices) {
    return localProducts(prices)
      .filter(row => row && row.local_price != null)
      .slice(0, 12)
      .map(row => ({
        title: row.name || row.product_ref || 'Produit',
        helper: [row.product_ref, row.category].filter(Boolean).join(' · '),
        value: row.decision_status || 'Décision locale',
        tone: row.decision_status === 'LOCAL_ACTIVE' ? 'positive' : 'warning',
      }));
  }

  function countryTrust(marketCode, workspace) {
    const scope = workspace && workspace.scope ? workspace.scope : {};
    const access = workspace && workspace.access ? workspace.access : {};
    return {
      stateLabel: 'Scope serveur',
      scopeLabel: `${scope.market_name || marketCode || 'Marché'} · ${scope.market_code || marketCode || '—'}`,
      qualityLabel: access.read_only ? 'Lecture / simulation' : 'Gestion pays',
    };
  }

  function cardSection(doc, title, description) {
    const section = doc.createElement('section');
    section.className = 'kmc-decision-surface-card';
    section.appendChild(text(doc, 'h2', 'kmc-decision-dashboard-section-title', title));
    if (description) section.appendChild(text(doc, 'p', 'kmc-decision-dashboard-section-copy', description));
    const body = doc.createElement('div');
    section.appendChild(body);
    return { section, body };
  }

  function renderOverview(host, config) {
    const doc = config.document;
    const ui = config.ui;
    const decisionUi = config.decisionUi;
    if (!host || !doc || !ui || !decisionUi) return null;
    host.replaceChildren();

    const dashboard = doc.createElement('article');
    dashboard.className = 'kmc-dashboard kmc-decision-dashboard kmc-markets-decision-overview';
    dashboard.setAttribute('data-dashboard-id', 'markets');
    dashboard.setAttribute('data-dashboard-visual', 'decision-first-v1');
    dashboard.setAttribute('data-dashboard-hierarchy', 'hero-attention-primary-secondary');

    const header = doc.createElement('header');
    header.className = 'kmc-dashboard-header';
    header.setAttribute('data-dashboard-role', 'hero');
    header.appendChild(text(doc, 'p', 'canonical-eyebrow', config.eyebrow));
    header.appendChild(text(doc, 'h1', 'kmc-dashboard-title', config.title));
    header.appendChild(text(doc, 'p', 'kmc-dashboard-description', config.description));
    dashboard.appendChild(header);

    if (config.decisions.length) {
      const decisions = doc.createElement('div');
      decisions.className = 'kmc-cockpit-decisions kmc-dashboard-attention-band';
      decisions.setAttribute('data-dashboard-role', 'attention');
      decisionUi.DecisionStrip.render(decisions, { items: config.decisions });
      dashboard.appendChild(decisions);
    }

    const metrics = cardSection(doc, config.metricTitle, config.metricDescription);
    metrics.section.className += ' is-cockpit-truth';
    metrics.section.setAttribute('data-dashboard-role', 'primary');
    const metricsHost = doc.createElement('div');
    metricsHost.className = 'kmc-markets-essential-metrics';
    ui.MetricStrip.render(metricsHost, { items: config.metrics });
    metrics.body.appendChild(metricsHost);

    if (config.rankedItems.length) {
      metrics.body.appendChild(text(doc, 'h3', 'kmc-markets-list-title', config.rankedTitle));
      if (config.rankedDescription) {
        metrics.body.appendChild(text(doc, 'p', 'kmc-markets-list-copy', config.rankedDescription));
      }
      const rankedHost = doc.createElement('div');
      rankedHost.className = 'kmc-markets-essential-list';
      decisionUi.RankedList.render(rankedHost, { items: config.rankedItems });
      metrics.body.appendChild(rankedHost);
    }

    dashboard.appendChild(metrics.section);
    host.appendChild(dashboard);
    return dashboard;
  }

  function renderAdminOverview(host, data, options = {}) {
    const root = typeof window !== 'undefined' ? window : globalThis;
    const matrix = data && data.matrix;
    if (matrix) {
      return renderOverview(host, {
        document: options.document || (root && root.document),
        ui: options.ui || (root && root.KomerceCanonicalUI),
        decisionUi: options.decisionUi || (root && root.KomerceDecisionUI),
        eyebrow: 'MARCHÉS',
        title: 'Pilotage des marchés',
        description: 'Voir qui pilote chaque marché et ce qui demande une décision.',
        decisions: centralDecisionItems(matrix),
        metrics: centralMetricItems(matrix),
        metricTitle: 'Responsabilité des marchés',
        metricDescription: 'Responsables actifs et couverture des marchés.',
        rankedItems: centralMarketItems(matrix),
        rankedTitle: 'Responsabilité par marché',
        rankedDescription: 'Le responsable et l’état de chaque marché.',
        trust: centralTrust(matrix),
      });
    }
    const markets = data && data.markets;
    const users = data && data.users;
    return renderOverview(host, {
      document: options.document || (root && root.document),
      ui: options.ui || (root && root.KomerceCanonicalUI),
      decisionUi: options.decisionUi || (root && root.KomerceDecisionUI),
      eyebrow: 'MARCHÉS · GOUVERNANCE',
      title: 'Responsables des marchés',
      description: 'Voir les marchés couverts et ceux qui demandent une décision.',
      decisions: adminDecisionItems(markets, users),
      metrics: adminMetricItems(markets, users),
      metricTitle: 'Responsabilité des marchés',
      metricDescription: 'Responsables actifs et couverture des marchés.',
      rankedItems: adminMarketItems(markets, users),
      rankedTitle: 'Couverture par marché',
      rankedDescription: 'Le responsable associé à chaque marché.',
      trust: adminTrust(),
    });
  }

  function renderCountryOverview(host, data, options = {}) {
    const root = typeof window !== 'undefined' ? window : globalThis;
    const workspace = data && data.workspace;
    const prices = data && data.prices;
    const marketCode = data && data.marketCode;
    return renderOverview(host, {
      document: options.document || (root && root.document),
      ui: options.ui || (root && root.KomerceCanonicalUI),
      decisionUi: options.decisionUi || (root && root.KomerceDecisionUI),
      eyebrow: 'MARCHÉ',
      title: `${workspace && workspace.scope && workspace.scope.market_name || marketCode || 'Marché'} · pilotage`,
      description: 'Voir les décisions locales et ce qui demande une action.',
      decisions: countryDecisionItems(workspace, prices),
      metrics: countryMetricItems(workspace, prices),
      metricTitle: 'État du marché',
      metricDescription: 'Les décisions locales utiles au pilotage du marché.',
      rankedItems: countryPriceItems(prices),
      rankedTitle: 'Décisions de prix locales',
      rankedDescription: 'Les références avec une décision locale.',
      trust: countryTrust(marketCode, workspace),
    });
  }

  return Object.freeze({
    operatorUsers,
    operatorScopes,
    adminProjection,
    adminDecisionItems,
    adminMetricItems,
    adminMarketItems,
    adminTrust,
    centralMatrixRows,
    centralProjection,
    centralDecisionItems,
    centralMetricItems,
    centralMarketItems,
    centralTrust,
    countryProjection,
    countryDecisionItems,
    countryMetricItems,
    countryPriceItems,
    countryTrust,
    renderAdminOverview,
    renderCountryOverview,
  });
});

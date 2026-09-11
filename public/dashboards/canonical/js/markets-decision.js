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

    const header = doc.createElement('header');
    header.className = 'kmc-dashboard-header';
    header.appendChild(text(doc, 'p', 'canonical-eyebrow', config.eyebrow));
    header.appendChild(text(doc, 'h1', 'kmc-dashboard-title', config.title));
    header.appendChild(text(doc, 'p', 'kmc-dashboard-description', config.description));
    dashboard.appendChild(header);

    if (config.decisions.length) {
      const decisions = doc.createElement('div');
      decisionUi.DecisionStrip.render(decisions, { items: config.decisions });
      dashboard.appendChild(decisions);
    }

    const metrics = cardSection(doc, config.metricTitle, config.metricDescription);
    ui.MetricStrip.render(metrics.body, { items: config.metrics });
    dashboard.appendChild(metrics.section);

    if (config.rankedItems.length) {
      const ranked = cardSection(doc, config.rankedTitle, config.rankedDescription);
      decisionUi.RankedList.render(ranked.body, { items: config.rankedItems });
      dashboard.appendChild(ranked.section);
    }

    const footer = doc.createElement('div');
    decisionUi.TrustFooter.render(footer, config.trust);
    dashboard.appendChild(footer);
    host.appendChild(dashboard);
    return dashboard;
  }

  function renderAdminOverview(host, data, options = {}) {
    const root = typeof window !== 'undefined' ? window : globalThis;
    const markets = data && data.markets;
    const users = data && data.users;
    return renderOverview(host, {
      document: options.document || (root && root.document),
      ui: options.ui || (root && root.KomerceCanonicalUI),
      decisionUi: options.decisionUi || (root && root.KomerceDecisionUI),
      eyebrow: 'MARCHÉS · GOUVERNANCE',
      title: 'Couverture des responsables pays',
      description: 'Voir immédiatement quels marchés sont réellement couverts avant d’administrer les comptes et leurs scopes.',
      decisions: adminDecisionItems(markets, users),
      metrics: adminMetricItems(markets, users),
      metricTitle: 'Couverture des accès',
      metricDescription: 'Comptage pur des marchés, responsables et scopes déjà résolus côté serveur.',
      rankedItems: adminMarketItems(markets, users),
      rankedTitle: 'Couverture par marché',
      rankedDescription: 'Manager et viewer sont distingués sans transformer le navigateur en autorité.',
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
      eyebrow: 'MARCHÉ · PILOTAGE LOCAL',
      title: `${workspace && workspace.scope && workspace.scope.market_name || marketCode || 'Marché'} · autonomie`,
      description: 'Voir l’état des décisions commerciales locales avant d’entrer dans les outils d’exécution pays.',
      decisions: countryDecisionItems(workspace, prices),
      metrics: countryMetricItems(workspace, prices),
      metricTitle: 'État des décisions locales',
      metricDescription: 'Aucun prix ni statut n’est recalculé : la projection reprend les décisions du workspace pays.',
      rankedItems: countryPriceItems(prices),
      rankedTitle: 'Décisions de prix locales',
      rankedDescription: 'Les références ayant déjà une décision locale, avec leur statut canonique.',
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
    countryProjection,
    countryDecisionItems,
    countryMetricItems,
    countryPriceItems,
    countryTrust,
    renderAdminOverview,
    renderCountryOverview,
  });
});

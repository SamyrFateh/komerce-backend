/**
 * @komerce-arch
 * @role          market-country-catalog-decision-view
 * @domain        admin-dashboard
 * @layer         ui-projection
 * @criticality   medium
 * @inputs        market_catalog_exposure_read_model
 * @outputs       decision_first_market_catalog_projection
 * @depends       none
 * @used-by       public/dashboards/canonical/js/market-catalog.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      dashboard_no_business_recompute, missing_exposure_is_disabled, market_catalog_summary_is_server_truth
 * @impact-areas  admin-dashboard, catalog, market-delegation
 * @version       2026-09
 */
'use strict';

(function initMarketCatalogDecision(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.KomerceMarketCatalogDecision = api;
})(typeof globalThis !== 'undefined' ? globalThis : null, function createMarketCatalogDecision() {
  'use strict';

  function formatNumber(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '—';
    return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(number);
  }

  function formatPercent(value) {
    const number = Number(value);
    return Number.isFinite(number) ? `${formatNumber(number)} %` : '—';
  }

  function decisionItems(payload = {}) {
    const summary = payload.summary || {};
    const items = [];

    if (Number(summary.undecided_products) > 0) {
      items.push({
        key: 'undecided',
        label: 'Sans décision pays',
        helper: 'Masqués par défaut jusqu’à une décision explicite du marché',
        value: formatNumber(summary.undecided_products),
        tone: 'warning',
        icon: '?',
        href: '#market-catalog-exposure',
        actionLabel: 'Décider →',
      });
    }

    if (Number(summary.exposed_needs_review) > 0) {
      items.push({
        key: 'exposed-review',
        label: 'Exposés à relire',
        helper: 'Produits visibles dans ce marché mais signalés à relire par le catalogue global',
        value: formatNumber(summary.exposed_needs_review),
        tone: 'warning',
        icon: '!',
        href: '#market-catalog-exposure',
        actionLabel: 'Voir les références →',
      });
    }

    return items;
  }

  function metricItems(payload = {}) {
    const summary = payload.summary || {};
    const decided = Number.isFinite(Number(summary.catalog_products)) && Number.isFinite(Number(summary.undecided_products))
      ? Math.max(0, Number(summary.catalog_products) - Number(summary.undecided_products))
      : null;

    return [
      {
        key: 'catalog',
        label: 'Catalogue actif',
        value: formatNumber(summary.catalog_products),
        tone: 'neutral',
        helper: 'Produits actifs du catalogue global éligibles à une décision pays',
      },
      {
        key: 'enabled',
        label: 'Exposés',
        value: formatNumber(summary.exposed_products),
        tone: 'positive',
      },
      {
        key: 'hidden',
        label: 'Masqués',
        value: formatNumber(summary.hidden_products),
        tone: Number(summary.undecided_products) > 0 ? 'warning' : 'neutral',
        helper: Number(summary.undecided_products) > 0
          ? `${formatNumber(summary.undecided_products)} sans décision explicite`
          : 'Décisions explicites du marché',
      },
      {
        key: 'coverage',
        label: 'Taux d’exposition',
        value: formatPercent(summary.exposure_pct),
        tone: 'neutral',
      },
      {
        key: 'decided',
        label: 'Décisions enregistrées',
        value: decided == null ? '—' : formatNumber(decided),
        tone: Number(summary.undecided_products) > 0 ? 'warning' : 'positive',
      },
    ];
  }

  function exposureStatus(row = {}) {
    if (row.decision_recorded !== true) {
      return Object.freeze({ label: 'Sans décision · masqué', tone: 'warning' });
    }
    if (row.commercial_exposure === 'ENABLED') {
      return Object.freeze({ label: 'Exposé', tone: row.needs_review === true ? 'warning' : 'positive' });
    }
    return Object.freeze({ label: 'Masqué', tone: 'neutral' });
  }

  function qualityStatus(row = {}) {
    return row.needs_review === true
      ? Object.freeze({ label: 'À relire', tone: 'warning' })
      : Object.freeze({ label: 'OK', tone: 'positive' });
  }

  function priorityRows(payload = {}) {
    return (Array.isArray(payload.exposure) ? payload.exposure : [])
      .filter(row => row && (row.decision_recorded !== true || (row.commercial_exposure === 'ENABLED' && row.needs_review === true)))
      .sort((a, b) => {
        const aReview = a.commercial_exposure === 'ENABLED' && a.needs_review === true ? 0 : 1;
        const bReview = b.commercial_exposure === 'ENABLED' && b.needs_review === true ? 0 : 1;
        if (aReview !== bReview) return aReview - bReview;
        return String(a.product_name || '').localeCompare(String(b.product_name || ''), 'fr');
      })
      .slice(0, 5)
      .map(row => ({
        title: row.product_name || row.product_ref || row.product_id || 'Produit',
        helper: row.commercial_exposure === 'ENABLED' && row.needs_review === true
          ? 'Visible dans le marché · fiche globale à relire'
          : 'Aucune décision d’exposition enregistrée pour ce marché',
        priority: row.commercial_exposure === 'ENABLED' && row.needs_review === true ? 'À relire' : 'À décider',
        tone: 'warning',
        href: '#market-catalog-exposure',
        actionLabel: 'Ouvrir →',
      }));
  }

  return Object.freeze({
    formatNumber,
    formatPercent,
    decisionItems,
    metricItems,
    exposureStatus,
    qualityStatus,
    priorityRows,
  });
});

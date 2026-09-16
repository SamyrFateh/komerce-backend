/**
 * @komerce-arch
 * @role          canonical-catalog-business-truth-ui
 * @domain        admin-dashboard
 * @layer         ui-orchestration
 * @criticality   medium
 * @inputs        catalog_workspace_projection, catalog_business_truth
 * @outputs       compact_catalog_business_truth_dom
 * @depends       public/dashboards/canonical/js/catalog-workspace.js
 * @used-by       canonical admin catalog workspace
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      one_shell_one_truth_no_duplicate_dashboard, visible_means_sellable
 * @impact-areas  admin-dashboard, catalog, boutique
 * @version       2026-09-business-truth
 */
'use strict';

(function initCatalogBusinessTruth(root, factory) {
  const base = root && root.KomerceCanonicalCatalogWorkspace;
  const api = factory(root, base);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.KomerceCanonicalCatalogWorkspace = api;
})(typeof globalThis !== 'undefined' ? globalThis : null, function createCatalogBusinessTruth(root, baseModule) {
  const ENDPOINT = baseModule?.ENDPOINT || '/api/admin/workspaces/catalog';

  function node(doc, tag, className, value) {
    const el = doc.createElement(tag);
    if (className) el.className = className;
    if (value != null) el.textContent = String(value);
    return el;
  }

  function link(doc, className, value, href) {
    const el = node(doc, 'a', className, value);
    el.href = href;
    return el;
  }

  function number(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  function formatNumber(value) {
    return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(number(value));
  }

  function stageLabel(stage) {
    return ({
      captured: 'Capturé',
      normalized: 'Normalisé',
      qualified: 'Qualifié',
      fr_ready: 'FR prêt',
      curation: 'Curation',
      catalog: 'Catalogue',
      boutique: 'Boutique',
    })[stage] || String(stage || '—');
  }

  function metricItems(payload = {}) {
    const stages = payload.business?.stages || {};
    return [
      { key: 'sourced', label: 'Sourcés', value: formatNumber(stages.sourced) },
      { key: 'ready', label: 'Prêts à publier', value: formatNumber(stages.ready_to_publish) },
      { key: 'published', label: 'Publiés', value: formatNumber(stages.published) },
    ];
  }

  async function jsonRequest(fetchFn, url) {
    const response = await fetchFn(url, {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `Erreur HTTP ${response.status}`);
    return body;
  }

  function renderHero(doc) {
    const hero = node(doc, 'header', 'kmc-cbt-hero');
    const copy = node(doc, 'div');
    copy.appendChild(node(doc, 'p', 'kmc-cbt-eyebrow', 'CATALOGUE'));
    copy.appendChild(node(doc, 'h1', 'kmc-cbt-title', 'Du sourcing à la boutique'));
    copy.appendChild(node(doc, 'p', 'kmc-cbt-subtitle', 'Une seule lecture métier. La complexité technique reste derrière les gates Komerce.'));
    hero.appendChild(copy);

    const actions = node(doc, 'div', 'kmc-cbt-actions');
    actions.appendChild(link(doc, 'kmc-cbt-button is-primary', 'Voir les produits', '/admin/workspaces/catalog?view=advanced'));
    actions.appendChild(link(doc, 'kmc-cbt-button', 'Gérer les sources', '/admin/workspaces/sourcing'));
    hero.appendChild(actions);
    return hero;
  }

  function statusCard(doc, label, value, help, tone) {
    const card = node(doc, `article`, `kmc-cbt-status is-${tone || 'neutral'}`);
    card.appendChild(node(doc, 'span', 'kmc-cbt-status-label', label));
    card.appendChild(node(doc, 'strong', 'kmc-cbt-status-value', value));
    card.appendChild(node(doc, 'small', 'kmc-cbt-status-help', help));
    return card;
  }

  function visibleSummary(markets) {
    if (!markets.length) return '—';
    return markets.map(row => `${row.market_code} ${formatNumber(row.visible)}`).join(' · ');
  }

  function renderTruthFlow(doc, payload) {
    const business = payload.business || {};
    const stages = business.stages || {};
    const markets = business.markets || [];
    const section = node(doc, 'section', 'kmc-cbt-panel');
    section.appendChild(node(doc, 'h2', 'kmc-cbt-panel-title', 'État réel du catalogue'));
    section.appendChild(node(doc, 'p', 'kmc-cbt-panel-copy', 'Chaque étape correspond à une condition vérifiable. Aucun compteur ne reconstruit une autre vérité que celle utilisée par la boutique.'));

    const flow = node(doc, 'div', 'kmc-cbt-flow');
    flow.appendChild(statusCard(doc, 'Sourcés', formatNumber(stages.sourced), 'Komerce connaît le produit ou son candidat source.', 'source'));
    flow.appendChild(statusCard(doc, 'Prêts à publier', formatNumber(stages.ready_to_publish), 'Le vrai guard de publication accepte la fiche.', 'ready'));
    flow.appendChild(statusCard(doc, 'Publiés', formatNumber(stages.published), 'Le produit appartient au catalogue global Komerce.', 'published'));
    flow.appendChild(statusCard(doc, 'Visibles', visibleSummary(markets), 'Visible = montrable et vendable sur ce marché.', 'visible'));
    section.appendChild(flow);
    return section;
  }

  function renderMarkets(doc, payload) {
    const business = payload.business || {};
    const markets = business.markets || [];
    const published = number(business.stages?.published);
    const section = node(doc, 'section', 'kmc-cbt-panel');
    section.appendChild(node(doc, 'h2', 'kmc-cbt-panel-title', 'Visible par marché'));
    section.appendChild(node(doc, 'p', 'kmc-cbt-panel-copy', 'Le chiffre Visible est calculé avec exactement le même gate que la boutique publique du marché.'));

    if (!markets.length) {
      section.appendChild(node(doc, 'div', 'kmc-cbt-empty', 'Aucun marché actif.'));
      return section;
    }

    const table = node(doc, 'table', 'kmc-cbt-table kmc-workspace-table');
    const thead = node(doc, 'thead');
    const hr = node(doc, 'tr');
    ['Marché', 'Publié global', 'Visible', 'Écart'].forEach(label => hr.appendChild(node(doc, 'th', '', label)));
    thead.appendChild(hr);
    table.appendChild(thead);
    const tbody = node(doc, 'tbody');

    markets.forEach(market => {
      const visible = number(market.visible);
      const tr = node(doc, 'tr', 'kmc-cbt-market-row');
      const marketCell = node(doc, 'td');
      marketCell.appendChild(node(doc, 'strong', '', market.market_code || '—'));
      marketCell.appendChild(node(doc, 'small', '', market.market_name || ''));
      tr.appendChild(marketCell);
      tr.appendChild(node(doc, 'td', '', formatNumber(published)));
      const visibleCell = node(doc, 'td');
      visibleCell.appendChild(node(doc, 'strong', visible > 0 ? 'is-positive' : 'is-zero', formatNumber(visible)));
      tr.appendChild(visibleCell);
      tr.appendChild(node(doc, 'td', '', formatNumber(Math.max(0, published - visible))));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    section.appendChild(table);
    return section;
  }

  function actionRow(doc, title, detail, href, tone = 'neutral') {
    const row = node(doc, `div`, `kmc-cbt-action-row is-${tone}`);
    const copy = node(doc, 'div');
    copy.appendChild(node(doc, 'strong', '', title));
    copy.appendChild(node(doc, 'span', '', detail));
    row.appendChild(copy);
    if (href) row.appendChild(link(doc, 'kmc-cbt-action-link', 'Ouvrir →', href));
    return row;
  }

  function renderActions(doc, payload) {
    const business = payload.business || {};
    const stages = business.stages || {};
    const markets = business.markets || [];
    const section = node(doc, 'section', 'kmc-cbt-panel');
    section.appendChild(node(doc, 'h2', 'kmc-cbt-panel-title', 'À traiter'));
    section.appendChild(node(doc, 'p', 'kmc-cbt-panel-copy', 'Uniquement les écarts qui demandent une décision métier.'));
    const list = node(doc, 'div', 'kmc-cbt-action-list');

    if (number(stages.ready_to_publish) > 0) {
      list.appendChild(actionRow(
        doc,
        `${formatNumber(stages.ready_to_publish)} produit(s) prêt(s) à publier`,
        'La fiche passe déjà les contrôles de publication ; il reste la décision de publication.',
        '/admin/workspaces/catalog?view=advanced',
        'attention'
      ));
    }

    const zeroMarkets = markets.filter(row => number(row.visible) === 0 && number(stages.published) > 0);
    zeroMarkets.forEach(market => {
      list.appendChild(actionRow(
        doc,
        `${market.market_code} · aucun produit visible`,
        'Des produits sont publiés globalement, mais aucun ne passe aujourd’hui le gate boutique de ce marché.',
        '/dashboards/canonical/market-catalog.html',
        'critical'
      ));
    });

    if (!list.children.length) {
      list.appendChild(actionRow(doc, 'Aucun écart prioritaire', 'Le catalogue ne remonte pas de blocage métier immédiat.', null, 'positive'));
    }
    section.appendChild(list);
    return section;
  }

  function renderSemantics(doc) {
    const section = node(doc, 'section', 'kmc-cbt-panel is-compact');
    section.appendChild(node(doc, 'h2', 'kmc-cbt-panel-title', 'Sens des statuts'));
    const defs = node(doc, 'dl', 'kmc-cbt-defs');
    [
      ['Sourcé', 'La source est connue de Komerce.'],
      ['Prêt à publier', 'La fiche passe le vrai contrôle de première publication.'],
      ['Publié', 'Le produit est dans le catalogue global Komerce.'],
      ['Visible', 'Le produit passe le gate de la boutique du marché et possède une unité vendable.'],
    ].forEach(([term, description]) => {
      defs.appendChild(node(doc, 'dt', '', term));
      defs.appendChild(node(doc, 'dd', '', description));
    });
    section.appendChild(defs);
    const note = node(doc, 'p', 'kmc-cbt-note', 'Au paiement, Komerce revalide encore le stock, le prix, le fret et le fournisseur : ce contrôle dynamique reste une sécurité de checkout, pas un statut supplémentaire du dashboard.');
    section.appendChild(note);
    return section;
  }

  function renderPayload(rootNode, doc, payload) {
    rootNode.className = 'kmc-catalog-business-truth';
    rootNode.replaceChildren();
    doc.body?.classList?.add('kmc-catalog-business-mode');

    const content = node(doc, 'div', 'kmc-cbt-content');
    content.appendChild(renderHero(doc));
    content.appendChild(renderTruthFlow(doc, payload));
    content.appendChild(renderMarkets(doc, payload));
    content.appendChild(renderActions(doc, payload));
    content.appendChild(renderSemantics(doc));
    rootNode.appendChild(content);
  }

  function advancedRequested() {
    try {
      return new URLSearchParams(root?.location?.search || '').get('view') === 'advanced';
    } catch (_) {
      return false;
    }
  }

  async function mount(options = {}) {
    if (advancedRequested() && baseModule?.mount) {
      options.document?.body?.classList?.remove('kmc-catalog-business-mode');
      return baseModule.mount(options);
    }

    const rootNode = options.root;
    const doc = options.document;
    const fetchFn = options.fetch;
    if (!rootNode || !doc || typeof fetchFn !== 'function') {
      throw new Error('canonical_catalog_business_truth_dependencies_missing');
    }

    const reload = async () => {
      const payload = await jsonRequest(fetchFn, ENDPOINT);
      renderPayload(rootNode, doc, payload);
      return payload;
    };

    try {
      const initial = await reload();
      const refreshSeconds = Math.max(10, Math.min(number(initial?.live?.refresh_hint_seconds) || 15, 60));
      const timer = setInterval(() => {
        if (!doc.contains?.(rootNode)) {
          clearInterval(timer);
          return;
        }
        reload().catch(() => {});
      }, refreshSeconds * 1000);
      return initial;
    } catch (error) {
      rootNode.className = 'kmc-catalog-business-truth';
      rootNode.replaceChildren();
      const fail = node(doc, 'section', 'kmc-cbt-failure');
      fail.appendChild(node(doc, 'h1', '', 'Catalogue indisponible'));
      fail.appendChild(node(doc, 'p', '', error.message));
      fail.appendChild(link(doc, 'kmc-cbt-button', 'Retour au Dashboard', '/admin/pilotage'));
      rootNode.appendChild(fail);
      throw error;
    }
  }

  return Object.freeze({
    ENDPOINT,
    metricItems,
    stageLabel,
    mount,
    _base: baseModule,
  });
});

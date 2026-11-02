/**
 * @komerce-arch
 * @role          canonical-hub-workstation
 * @domain        admin-dashboard
 * @layer         ui-orchestration
 * @criticality   high
 * @inputs        authenticated_user, canonical_admin_context, purchasing_and_hub_read_models
 * @outputs       hub_two_branch_integrated_workstation
 * @depends       purchasing-workspace, operations-workspace, canonical shell, hub dossier
 * @used-by       public/dashboards/canonical/js/app.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      two_branches_one_hub_no_parallel_business_truth, server_permissions_authoritative
 * @impact-areas  admin-dashboard, hub, purchasing
 * @version       2026-11-hub-workstation-v2
 */
'use strict';

(function initHubWorkstation(global) {
  // Poste de travail : les deux panneaux sont des LECTURES. Les mutations
  // restent exclusivement dans Purchasing et OperationsWorkspace.
  const HUB_PATH = '/admin/hub';
  const BRANCHES = Object.freeze({
    administrative: { label: 'Administration', hint: 'Achats, fournisseurs et engagements' },
    operations: { label: 'Opérations', hint: 'Réception, contrôle et expéditions' },
  });
  const PO_STAGE = Object.freeze({
    draft: 'À préparer', notified: 'En cours', confirmed: 'En cours',
    shipped: 'Fournisseur expédié', hub_received: 'Réceptionnée', cancelled: 'Annulée',
    issued_not_sent: 'À envoyer', sent: 'Envoyée', partially_received: 'Partiellement reçue',
    received: 'Reçue',
  });
  const safe = value => String(value == null ? '' : value);
  const parseBranch = search => {
    const value = new URLSearchParams(safe(search)).get('branch');
    return Object.prototype.hasOwnProperty.call(BRANCHES, value) ? value : 'operations';
  };
  const href = (branch, search) => {
    const params = new URLSearchParams(safe(search));
    params.set('branch', branch);
    if (branch !== 'administrative') params.delete('po');
    return HUB_PATH + '?' + params.toString();
  };
  const make = (doc, tag, css, textContent) => {
    const node = doc.createElement(tag);
    if (css) node.className = css;
    if (textContent !== undefined) node.textContent = safe(textContent);
    return node;
  };
  const smallRef = value => safe(value).slice(0, 8);
  const getPO = location => new URLSearchParams(safe(location && location.search)).get('po') || '';
  const selectedMarket = location => new URLSearchParams(safe(location && location.search)).get('market') || '';

  function requestJSON(fetchFn, url) {
    return Promise.resolve(fetchFn(url, {
      method: 'GET', credentials: 'include', headers: { Accept: 'application/json' },
    })).then(async response => {
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(body.error || 'Données indisponibles');
        error.status = response.status;
        throw error;
      }
      return body;
    });
  }

  function mount(options = {}) {
    const {root, user, document:doc, location, history, fetch:fetchFn, adminContext,
      renderAdministrative, renderOperations} = options;
    if (!root || !doc || !user) throw new Error('hub_workstation_context_missing');
    if (typeof renderAdministrative !== 'function' || typeof renderOperations !== 'function') {
      throw new Error('hub_workstation_renderers_missing');
    }
    const role = safe(user.role);
    if (role !== 'admin' && role !== 'agent_hub') throw new Error('hub_workstation_role_not_allowed');
    const administrativeAllowed = role === 'admin';
    const search = safe(location && location.search);
    const requested = parseBranch(search);
    const branch = requested === 'administrative' && !administrativeAllowed ? 'operations' : requested;
    const active = { orderId: '', poId: branch === 'administrative' ? getPO(location) : '' };

    root.replaceChildren();
    root.className = 'kmc-hub-app';
    const header = make(doc, 'header', 'kmc-hub-app-header');
    const title = make(doc, 'div', 'kmc-hub-app-title');
    title.appendChild(make(doc, 'span', 'kmc-hub-app-eyebrow', 'KOMERCE · HUB'));
    title.appendChild(make(doc, 'h1', '', 'Poste de travail Hub'));
    title.appendChild(make(doc, 'p', '', 'Deux branches · un seul dossier de traçabilité'));
    header.appendChild(title);
    root.appendChild(header);

    // Branches compactes en haut : la vraie colonne gauche sert aux dossiers.
    const branchNav = make(doc, 'nav', 'kmc-hub-app-branches');
    branchNav.setAttribute('aria-label', 'Branches du Hub');
    for (const id of ['administrative', 'operations']) {
      if (id === 'administrative' && !administrativeAllowed) continue;
      const definition = BRANCHES[id];
      const link = make(doc, 'a', 'kmc-hub-app-branch');
      link.setAttribute('href', href(id, search));
      link.setAttribute('data-hub-branch', id);
      if (id === branch) {
        link.classList.add('is-active');
        link.setAttribute('aria-current', 'page');
      }
      const label = make(doc, 'span', 'kmc-hub-app-branch-copy');
      label.appendChild(make(doc, 'strong', '', definition.label));
      label.appendChild(make(doc, 'small', '', definition.hint));
      link.appendChild(label);
      branchNav.appendChild(link);
    }
    root.appendChild(branchNav);

    const layout = make(doc, 'div', 'kmc-hub-app-layout');
    const rail = make(doc, 'aside', 'kmc-hub-app-rail');
    rail.setAttribute('aria-label', branch === 'administrative' ? 'Ordres d’achat' : 'Dossiers Hub');
    const railHeading = make(doc, 'div', 'kmc-hub-app-rail-heading');
    railHeading.appendChild(make(doc, 'strong', '',
      branch === 'administrative' ? 'Achats fournisseurs' : 'Commandes à suivre'));
    railHeading.appendChild(make(doc, 'small', '', 'Données réelles · lecture seule'));
    rail.appendChild(railHeading);

    const searchInput = make(doc, 'input', 'kmc-hub-app-search');
    searchInput.type = 'search';
    searchInput.placeholder = branch === 'administrative' ? 'Chercher une PO / fournisseur' : 'Chercher une commande';
    searchInput.setAttribute('aria-label', searchInput.placeholder);
    rail.appendChild(searchInput);
    const actions = make(doc, 'div', 'kmc-hub-app-rail-actions');
    const resetButton = make(doc, 'button', 'kmc-hub-app-light-button',
      branch === 'administrative' ? 'Besoins à constituer' : 'Tous les dossiers');
    resetButton.type = 'button';
    actions.appendChild(resetButton);
    const refresh = make(doc, 'button', 'kmc-hub-app-light-button', 'Actualiser');
    refresh.type = 'button';
    actions.appendChild(refresh);
    rail.appendChild(actions);
    const list = make(doc, 'div', 'kmc-hub-app-case-list');
    list.setAttribute('data-hub-case-list', branch);
    rail.appendChild(list);
    const railNote = make(doc, 'p', 'kmc-hub-app-rail-note', 'Un dossier relie commandes, articles, PO, réception et expédition.');
    rail.appendChild(railNote);
    layout.appendChild(rail);

    const content = make(doc, 'section', 'kmc-hub-app-content');
    content.setAttribute('aria-label', BRANCHES[branch].label);
    content.setAttribute('data-hub-active-branch', branch);
    content.appendChild(make(doc, 'div', 'kmc-hub-app-pane-label',
      branch === 'administrative' ? 'ACHETER · JUSTIFIER · RAPPROCHER' : 'RÉCEPTIONNER · PRÉPARER · EXPÉDIER'));
    const host = make(doc, 'div', 'kmc-hub-app-workspace');
    host.setAttribute('data-hub-branch-workspace', branch);
    content.appendChild(host);
    layout.appendChild(content);
    root.appendChild(layout);

    const activeItems = { rows: [], seq: 0 };
    let pendingMount = null;
    const updateUrl = poId => {
      if (!history || typeof history.pushState !== 'function' || !location) return;
      const params = new URLSearchParams(safe(location.search));
      if (poId) params.set('po', poId); else params.delete('po');
      // Préserver branch/market et les autres paramètres non métiers.
      const query = params.toString();
      history.pushState(null, '', HUB_PATH + (query ? '?' + query : ''));
    };
    const showSelected = () => {
      list.querySelectorAll?.('[data-hub-case]').forEach(node => {
        const chosen = node.getAttribute('data-hub-case') ===
          (branch === 'administrative' ? active.poId : active.orderId);
        node.classList.toggle('is-selected', chosen);
        node.setAttribute('aria-current', chosen ? 'true' : 'false');
      });
    };
    const selectPO = poId => {
      if (branch !== 'administrative') return;
      const next = safe(poId);
      if (next === active.poId) return;
      active.poId = next;
      updateUrl(next);
      showSelected();
      host.replaceChildren();
      pendingMount = Promise.resolve(renderAdministrative(host));
      pendingMount.catch(() => {}); // Les erreurs sont déjà affichées par la surface métier.
    };

    const selectOrder = orderId => {
      if (branch !== 'operations') return;
      active.orderId = safe(orderId);
      showSelected();
      const tab = host.querySelector?.('[data-workspace-view="supply"]');
      if (tab && tab.getAttribute('aria-selected') !== 'true') tab.click();
      const cards = host.querySelectorAll?.('[data-hub-order]') || [];
      let selected = null;
      cards.forEach(card => {
        const matches = card.getAttribute('data-hub-order') === active.orderId;
        card.open = matches;
        if (matches) selected = card;
      });
      if (selected?.scrollIntoView) selected.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    };

    const itemButton = (id, name, line2, line3) => {
      const button = make(doc, 'button', 'kmc-hub-app-case');
      button.type = 'button';
      button.setAttribute('data-hub-case', safe(id));
      button.appendChild(make(doc, 'strong', '', name));
      if (line2) button.appendChild(make(doc, 'span', '', line2));
      if (line3) button.appendChild(make(doc, 'small', '', line3));
      button.addEventListener('click', () => branch === 'administrative' ? selectPO(id) : selectOrder(id));
      return button;
    };

    const renderCaseList = () => {
      list.replaceChildren();
      const term = safe(searchInput.value).trim().toLocaleLowerCase('fr');
      const matching = activeItems.rows.filter(row => [row.title, row.secondary, row.tertiary]
        .some(value => safe(value).toLocaleLowerCase('fr').includes(term)));
      if (!matching.length) {
        list.appendChild(make(doc, 'p', 'kmc-hub-app-list-empty', term
          ? 'Aucun dossier correspondant.' : 'Aucun dossier pour ce périmètre.'));
      }
      matching.forEach(row => list.appendChild(itemButton(row.id, row.title, row.secondary, row.tertiary)));
      showSelected();
    };

    // Les listes reprennent les projections serveur sans en déduire de nouveau
    // état métier. Aucun paiement validé n'est simulé.
    const loadCases = async (marketOverride = '') => {
      const seq = ++activeItems.seq;
      if (typeof fetchFn !== 'function') return;
      list.replaceChildren(make(doc, 'p', 'kmc-hub-app-list-empty', 'Chargement des dossiers…'));
      try {
        let rows;
        if (branch === 'administrative') {
          // Marché explicite : même projection PO mono-marché que le dossier Hub.
          // Sans marché : liste administrative existante, à portée globale.
          const market = marketOverride || selectedMarket(location);
          const payload = await requestJSON(fetchFn, market
            ? '/api/hub/dossier?market=' + encodeURIComponent(market)
            : '/api/purchasing');
          rows = (Array.isArray(payload.purchase_orders) ? payload.purchase_orders : []).map(po => ({
            id: po.id, title: 'PO ' + smallRef(po.id),
            secondary: po.supplier_name || 'Fournisseur non renseigné',
            tertiary: (PO_STAGE[po.stage || po.status] || po.stage || po.status || 'Statut inconnu') +
              (po.order_ref ? ' · ' + po.order_ref : ''),
          }));
        } else {
          // Le dossier Hub exclut déjà LOCAL_STOCK. Jamais d'agrégation client
          // ou de quantité physique recalculée dans le navigateur.
          const markets = adminContext?.access?.allowedMarkets;
          const market = marketOverride || selectedMarket(location) ||
            (Array.isArray(markets) && markets.length === 1 ? markets[0] : '');
          if (!market) {
            if (seq === activeItems.seq) {
              activeItems.rows = [];
              list.replaceChildren(make(doc, 'p', 'kmc-hub-app-list-empty',
                'Choisissez un marché dans l’espace de travail.'));
            }
            return;
          }
          const dossier = await requestJSON(fetchFn, '/api/hub/dossier?market=' + encodeURIComponent(market));
          rows = (Array.isArray(dossier.orders) ? dossier.orders : []).map(order => ({
            id: order.id, title: order.reference || smallRef(order.id),
            secondary: String((order.items || []).length) + ' article(s) import',
            tertiary: order.status || 'Commande à suivre',
          }));
        }
        if (seq !== activeItems.seq) return;
        activeItems.rows = rows;
        renderCaseList();
      } catch (error) {
        if (seq !== activeItems.seq) return;
        activeItems.rows = [];
        list.replaceChildren(make(doc, 'p', 'kmc-hub-app-list-error',
          'Liste indisponible : ' + error.message));
      }
    };

    searchInput.addEventListener('input', renderCaseList);
    resetButton.addEventListener('click', () => {
      if (branch === 'administrative') selectPO('');
      else {
        active.orderId = '';
        showSelected();
        const cards = host.querySelectorAll?.('[data-hub-order]') || [];
        cards.forEach((card, index) => { card.open = index === 0; });
      }
    });
    refresh.addEventListener('click', () => { loadCases().catch(() => {}); });
    // Le sélecteur de marché se trouve dans la surface Canonical à droite.
    // Son changement met à jour le contexte via la navigation native.
    host.addEventListener('change', event => {
      if (!event.target?.matches?.('.kmc-market-context-select')) return;
      // Sa validation asynchrone appartient au module Canonical.
      loadCases(event.target.value).catch(() => {});
    });

    const mainRender = branch === 'administrative'
      ? renderAdministrative(host) : renderOperations(host);
    pendingMount = Promise.resolve(mainRender);
    pendingMount.catch(() => {});
    loadCases().catch(() => {});

    return Object.freeze({ branch, reloadCases: loadCases, selectPO, selectOrder });
  }

  global.KomerceCanonicalHubWorkstation = Object.freeze({
    mount, parseBranch, href, BRANCHES, PO_STAGE,
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);

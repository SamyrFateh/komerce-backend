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
    params.delete('market'); // Hub global : jamais de contexte marché sur la vue centrale.
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


  // Le Hub est une entité centrale : ce tableau agrège TOUS les marchés
  // sans sélecteur de marché. Les opérations utilisent ensuite, si besoin,
  // le marché d'une commande pour cibler leur writer canonique.
  async function renderGlobalBoard(root, { document:doc, fetch:fetchFn, user } = {}) {
    if (!root || !doc || typeof fetchFn !== 'function') {
      throw new Error('hub_global_board_context_missing');
    }
    root.replaceChildren();
    const header = make(doc, 'div', 'kmc-hub-global-toolbar');
    header.appendChild(make(doc, 'strong', '', 'Toutes les commandes import · Tous les marchés'));
    header.appendChild(make(doc, 'span', 'kmc-hub-global-count', 'Chargement…'));
    root.appendChild(header);
    const search = make(doc, 'input', 'kmc-hub-app-search');
    search.type = 'search';
    search.placeholder = 'Rechercher une commande ou un marché';
    search.setAttribute('aria-label', search.placeholder);
    root.appendChild(search);
    const scroll = make(doc, 'div', 'kmc-hub-board-scroll');
    const table = make(doc, 'table', 'kmc-hub-board');
    table.setAttribute('aria-label', 'Tableau central Hub, tous les marchés');
    const head = make(doc, 'thead');
    const titleRow = make(doc, 'tr');
    for (const label of ['Commande / Marché', 'PO', 'Fournisseur', 'Réception', 'Cartons', 'Départ', 'Reste à solder']) {
      titleRow.appendChild(make(doc, 'th', '', label));
    }
    head.appendChild(titleRow);
    table.appendChild(head);
    const body = make(doc, 'tbody');
    table.appendChild(body);
    scroll.appendChild(table);
    root.appendChild(scroll);

    const menu = make(doc, 'div', 'kmc-hub-board-menu');
    menu.setAttribute('role', 'dialog');
    menu.setAttribute('aria-label', 'Actions et preuves du Hub');
    menu.setAttribute('data-hub-global-menu', '');
    menu.hidden = true;
    root.appendChild(menu);

    const canOperate = ['admin', 'agent_hub'].includes(user && user.role);
    const closeMenu = () => { menu.hidden = true; };
    const openMenu = (order, label, value, event) => {
      menu.replaceChildren();
      menu.appendChild(make(doc, 'strong', 'kmc-hub-board-menu-title', order.reference + ' · ' + label));
      menu.appendChild(make(doc, 'p', 'kmc-hub-board-menu-summary', value));
      menu.appendChild(make(doc, 'p', 'kmc-hub-board-menu-summary',
        'Marché ' + order.market + ' · Vue centrale sans filtre de marché.'));
      if (canOperate) {
        // L'exécution utilise uniquement le marché DÉRIVÉ du dossier serveur.
        // Ce n'est pas le périmètre de la consultation centrale.
        const target = make(doc, 'a', 'kmc-hub-board-menu-action', 'Ouvrir les opérations de cette commande');
        target.href = '/admin/hub-live?view=execute&market=' + encodeURIComponent(order.market);
        menu.appendChild(target);
        if (user.role === 'admin' && ['PO', 'Fournisseur'].includes(label)) {
          const purchase = make(doc, 'a', 'kmc-hub-board-menu-action', 'Ouvrir les achats fournisseurs');
          purchase.href = '/admin/workspaces/purchasing?market=' + encodeURIComponent(order.market);
          menu.appendChild(purchase);
        }
      } else {
        menu.appendChild(make(doc, 'p', 'kmc-hub-board-menu-summary',
          'Consultation seule. Les validations et mouvements physiques sont réservés à l’équipe Hub.'));
      }
      const close = make(doc, 'button', 'kmc-hub-board-menu-action', 'Fermer');
      close.type = 'button';
      close.addEventListener('click', closeMenu);
      menu.appendChild(close);
      menu.hidden = false;
      const box = event && event.currentTarget && event.currentTarget.getBoundingClientRect?.();
      const width = doc.defaultView?.innerWidth || 1440;
      const height = doc.defaultView?.innerHeight || 900;
      const x = event?.type === 'contextmenu' ? event.clientX : (box ? box.left : 10);
      const y = event?.type === 'contextmenu' ? event.clientY : (box ? box.bottom : 10);
      menu.style.left = Math.max(8, Math.min(x, width - 310)) + 'px';
      menu.style.top = Math.max(8, Math.min(y, height - 240)) + 'px';
      menu.querySelector?.('a,button')?.focus?.();
    };
    root.addEventListener('keydown', event => { if (event.key === 'Escape') closeMenu(); });

    let rows = [];
    const renderRows = () => {
      body.replaceChildren();
      const term = safe(search.value).trim().toLocaleLowerCase('fr');
      const filtered = rows.filter(o => [o.reference, o.market, o.market_name]
        .some(v => safe(v).toLocaleLowerCase('fr').includes(term)));
      header.lastChild.textContent = filtered.length + ' / ' + rows.length + ' commande(s)';
      if (!filtered.length) {
        const tr = make(doc, 'tr');
        const td = make(doc, 'td', '', term ? 'Aucune commande correspondante.' : 'Aucune commande import active.');
        td.colSpan = 7;
        tr.appendChild(td);
        body.appendChild(tr);
        return;
      }
      for (const order of filtered) {
        const tr = make(doc, 'tr');
        tr.setAttribute('data-hub-global-order', order.reference);
        const identity = make(doc, 'td');
        const idBox = make(doc, 'div', 'kmc-hub-board-identity');
        idBox.appendChild(make(doc, 'strong', '', order.reference));
        idBox.appendChild(make(doc, 'small', '', order.market + ' · ' + (order.market_name || order.market)));
        identity.appendChild(idBox);
        tr.appendChild(identity);
        for (const [label, key] of [
          ['PO', 'po'], ['Fournisseur', 'supplier'], ['Réception', 'reception'],
          ['Cartons', 'cartons'], ['Départ', 'departure'], ['Reste à solder', 'remaining'],
        ]) {
          const td = make(doc, 'td');
          const button = make(doc, 'button', 'kmc-hub-board-cell', order[key] || '—');
          button.type = 'button';
          button.setAttribute('data-hub-global-stage', label);
          button.setAttribute('aria-label', order.reference + ' · ' + label + ' · ' + (order[key] || '—'));
          if (key === 'remaining' && order.attention) button.classList.add('is-attention');
          if (key === 'remaining' && order.remaining_detail) {
            button.appendChild(make(doc, 'small', '', order.remaining_detail));
          }
          button.addEventListener('click', event => openMenu(order, label, order[key], event));
          button.addEventListener('contextmenu', event => {
            event.preventDefault();
            openMenu(order, label, order[key], event);
          });
          td.appendChild(button);
          tr.appendChild(td);
        }
        body.appendChild(tr);
      }
    };
    search.addEventListener('input', renderRows);
    try {
      const payload = await requestJSON(fetchFn, '/api/hub/board');
      if (payload.scope !== 'HUB_GLOBAL' || !Array.isArray(payload.orders)) {
        throw new Error('Réponse globale Hub invalide');
      }
      rows = payload.orders;
      renderRows();
      return payload;
    } catch (error) {
      body.replaceChildren();
      header.lastChild.textContent = 'Indisponible';
      const tr = make(doc, 'tr');
      const td = make(doc, 'td', 'kmc-hub-app-list-error',
        'Impossible de charger la vue centrale Hub : ' + error.message);
      td.colSpan = 7;
      tr.appendChild(td);
      body.appendChild(tr);
      return null;
    }
  }

  function mount(options = {}) {
    const {root, user, document:doc, location, history, fetch:fetchFn, adminContext,
      renderAdministrative, renderOperations} = options;
    if (!root || !doc || !user) throw new Error('hub_workstation_context_missing');
    if (typeof renderAdministrative !== 'function' || typeof renderOperations !== 'function') {
      throw new Error('hub_workstation_renderers_missing');
    }
    const role = safe(user.role);
    if (!['admin', 'agent_hub', 'market_operator', 'agent_relais', 'finance', 'sourcing', 'agent_transitaire', 'support'].includes(role)) {
      throw new Error('hub_workstation_role_not_allowed');
    }
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
    if (branch === 'operations') layout.classList.add('is-table');
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
    if (branch === 'administrative') layout.appendChild(rail);

    const content = make(doc, 'section', 'kmc-hub-app-content');
    content.setAttribute('aria-label', BRANCHES[branch].label);
    content.setAttribute('data-hub-active-branch', branch);
    content.appendChild(make(doc, 'div', 'kmc-hub-app-pane-label',
      branch === 'administrative' ? 'PRÉPARER · ENGAGER · SUIVRE' : 'RÉCEPTIONNER · PRÉPARER · EXPÉDIER'));
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
      params.delete('market');
      // Hub sans marché : préserver uniquement la branche et le dossier PO.
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
      const rows = host.querySelectorAll?.('[data-hub-order]') || [];
      let selected = null;
      rows.forEach(row => {
        const matches = row.getAttribute('data-hub-order') === active.orderId;
        row.classList.toggle('is-selected', matches);
        if (matches) selected = row;
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
          // Administration des achats : vue globale indépendante du sélecteur marché.
          const payload = await requestJSON(fetchFn, '/api/purchasing');
          rows = (Array.isArray(payload.purchase_orders) ? payload.purchase_orders : []).map(po => ({
            id: po.id, title: 'PO ' + smallRef(po.id),
            secondary: po.supplier_name || 'Fournisseur non renseigné',
            tertiary: (PO_STAGE[po.stage || po.status] || po.stage || po.status || 'Statut inconnu') +
              (po.order_ref ? ' · ' + po.order_ref : ''),
          }));
        } else {
          // Projection globale de lecture, sans aucun marché à sélectionner.
          const dossier = await requestJSON(fetchFn, '/api/hub/board');
          rows = (Array.isArray(dossier.orders) ? dossier.orders : []).map(order => ({
            id: order.id, title: order.reference,
            secondary: order.market + ' · ' + (order.market_name || order.market),
            tertiary: order.remaining,
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
    // La commande « Retour à la liste » appartient au writer Purchasing.
    // Réconcilier seulement la sélection visuelle du panneau gauche.
    host.addEventListener('click', event => {
      if (branch !== 'administrative' || !event.target?.closest?.('[data-workspace-action="close-po"]')) return;
      active.poId = '';
      showSelected();
    });
    host.addEventListener('change', event => {
      if (!event.target?.matches?.('.kmc-market-context-select')) return;
      // Sa validation asynchrone appartient au module Canonical.
      loadCases(event.target.value).catch(() => {});
    });

    const mainRender = branch === 'administrative'
      ? renderAdministrative(host) : renderOperations(host);
    pendingMount = Promise.resolve(mainRender);
    pendingMount.catch(() => {});
    if (branch === 'administrative') loadCases().catch(() => {});

    return Object.freeze({ branch, reloadCases: loadCases, selectPO, selectOrder });
  }

  global.KomerceCanonicalHubWorkstation = Object.freeze({
    mount, renderGlobalBoard, parseBranch, href, BRANCHES, PO_STAGE,
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);

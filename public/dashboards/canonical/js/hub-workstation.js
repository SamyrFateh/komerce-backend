/**
 * @komerce-arch
 * @role          canonical-hub-workstation
 * @domain        admin-dashboard
 * @layer         ui-orchestration
 * @criticality   high
 * @inputs        authenticated_user, canonical_admin_context, shared_purchasing_and_hub_services
 * @outputs       hub_two_branch_integrated_workstation
 * @depends       purchasing-workspace, operations-workspace, canonical admin market selector
 * @used-by       public/dashboards/canonical/js/app.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      two_branches_one_hub_no_parallel_business_truth, server_permissions_authoritative
 * @impact-areas  admin-dashboard, hub, purchasing
 * @version       2026-11-hub-workstation-shell-v1
 */
'use strict';

(function initHubWorkstation(global) {
  // Composition uniquement : les actions d'achat restent dans Purchasing,
  // les gestes physiques restent dans OperationsWorkspace. Aucun statut inventé.
  const HUB_PATH = '/admin/hub';
  const BRANCHES = Object.freeze({
    administrative: { label: 'Administration', hint: 'Achats fournisseurs, factures et règlements', icon: '▦' },
    operations: { label: 'Opérations', hint: 'Réception, contrôle, KOM-BOX et expédition', icon: '▤' },
  });

  const parseBranch = search => {
    const value = new URLSearchParams(String(search || '')).get('branch');
    return Object.hasOwn(BRANCHES, value) ? value : 'operations';
  };
  const href = (branch, search) => {
    const params = new URLSearchParams(String(search || ''));
    params.set('branch', branch);
    // Le dossier PO n'existe que dans le contexte Achats.
    if (branch !== 'administrative') params.delete('po');
    return HUB_PATH + '?' + params.toString();
  };
  const make = (doc, tag, className, content) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (content !== undefined) node.textContent = content;
    return node;
  };

  function mount(options) {
    const {root, user, document:doc, location, renderAdministrative, renderOperations} = options || {};
    if (!root || !doc || !user) throw new Error('hub_workstation_context_missing');
    if (typeof renderOperations !== 'function' || typeof renderAdministrative !== 'function') {
      throw new Error('hub_workstation_renderers_missing');
    }
    const role = String(user.role || '');
    const administrativeAllowed = role === 'admin';
    if (role !== 'admin' && role !== 'agent_hub') {
      throw new Error('hub_workstation_role_not_allowed');
    }
    const search = String(location?.search || '');
    const requested = parseBranch(search);
    const branch = requested === 'administrative' && !administrativeAllowed ? 'operations' : requested;

    root.replaceChildren();
    root.className = 'kmc-hub-app';

    const hero = make(doc, 'header', 'kmc-hub-app-header');
    const titleBlock = make(doc, 'div', 'kmc-hub-app-title');
    titleBlock.appendChild(make(doc, 'span', 'kmc-hub-app-eyebrow', 'KOMERCE · HUB'));
    titleBlock.appendChild(make(doc, 'h1', '', 'Poste de travail Hub'));
    titleBlock.appendChild(make(doc, 'p', '', 'Deux branches · un dossier métier et une traçabilité continue'));
    hero.appendChild(titleBlock);
    root.appendChild(hero);

    const layout = make(doc, 'div', 'kmc-hub-app-layout');
    const rail = make(doc, 'nav', 'kmc-hub-app-rail');
    rail.setAttribute('aria-label', 'Branches du Hub');
    rail.appendChild(make(doc, 'span', 'kmc-hub-app-rail-label', 'ESPACES DE TRAVAIL'));
    for (const id of ['administrative', 'operations']) {
      if (id === 'administrative' && !administrativeAllowed) continue;
      const b = BRANCHES[id];
      const link = make(doc, 'a', 'kmc-hub-app-branch');
      link.setAttribute('href', href(id, search));
      link.setAttribute('data-hub-branch', id);
      if (id === branch) {
        link.classList.add('is-active');
        link.setAttribute('aria-current', 'page');
      }
      link.appendChild(make(doc, 'span', 'kmc-hub-app-branch-symbol', b.icon));
      const details = make(doc, 'span', 'kmc-hub-app-branch-copy');
      details.appendChild(make(doc, 'strong', '', b.label));
      details.appendChild(make(doc, 'small', '', b.hint));
      link.appendChild(details);
      rail.appendChild(link);
    }
    const help = make(doc, 'div', 'kmc-hub-app-rail-footer');
    help.appendChild(make(doc, 'strong', '', 'Dossier unique'));
    help.appendChild(make(doc, 'span', '', 'Commande → PO → réception → colis → expédition'));
    rail.appendChild(help);
    layout.appendChild(rail);

    const main = make(doc, 'section', 'kmc-hub-app-content');
    main.setAttribute('aria-label', BRANCHES[branch].label);
    main.setAttribute('data-hub-active-branch', branch);
    const eyebrow = make(doc, 'div', 'kmc-hub-app-pane-label',
      branch === 'administrative' ? 'PILOTER · AUTORISER · RAPPROCHER' : 'RÉCEPTIONNER · PRÉPARER · EXPÉDIER');
    main.appendChild(eyebrow);
    const host = make(doc, 'div', 'kmc-hub-app-workspace');
    host.setAttribute('data-hub-branch-workspace', branch);
    main.appendChild(host);
    layout.appendChild(main);
    root.appendChild(layout);

    // Ne pas reconstruire les writers métier ni attribuer un paiement au client.
    // Le rôle "directrice du Hub" attend une capacité serveur explicite.
    return branch === 'administrative'
      ? renderAdministrative(host)
      : renderOperations(host);
  }

  global.KomerceCanonicalHubWorkstation = Object.freeze({ mount, parseBranch, href, BRANCHES });
})(typeof globalThis !== 'undefined' ? globalThis : this);

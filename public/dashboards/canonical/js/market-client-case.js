/**
 * @komerce-arch
 * @role          market-autonomy-client-case-delegation-ui
 * @domain        market-autonomy
 * @layer         ui-workspace
 * @criticality   high
 * @inputs        authenticated user, server admin context, market-delegation dispute read model
 * @outputs       dispute workflow controls (statut + résolution)
 * @depends       /api/admin/dashboard/context, /api/market-delegation/markets/:marketCode/client-cases/disputes
 * @used-by       /dashboards/canonical/market-autonomy.html
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      ui_never_grants_more_than_server_actor_capabilities, server_scope_is_authority, refund_authority_never_delegated
 * @impact-areas  admin-dashboard, market-autonomy, market-delegation, orders
 * @version       2026-09
 */
'use strict';

/**
 * Même patron exact que market-team.js / market-network.js /
 * market-local-offer.js.
 *
 * INVARIANT CRITIQUE vérifié dans le code serveur avant d'écrire cette UI
 * (services/dispute-mutation-service.js, doctrine
 * refund_authority_never_delegated) : le montant du remboursement
 * (refund_kmf/refund_eur) n'est JAMAIS modifiable par cette voie — la
 * route serveur porte même une garde dédiée (rejectFinancialFields) en
 * plus de l'absence de ces colonnes dans le SELECT de listDisputesForMarket.
 * Cette UI n'affiche donc AUCUN champ montant, ne serait-ce qu'en lecture,
 * et ne doit jamais en ajouter un — seul le WORKFLOW (statut + note de
 * résolution) est délégué au market manager.
 *
 * Transitions légales (services/dispute-mutation-service.js,
 * ALLOWED_TRANSITIONS) — l'UI n'offre jamais un saut interdit :
 *   open       -> processing
 *   processing -> resolved | closed | open
 *   resolved   -> closed | processing
 *   closed     -> processing
 *
 * Capacité unique vérifiée : client.case.handle (lecture ET écriture,
 * pas de capacité read séparée — même schéma que local_offer.manage).
 */
(function bootMarketClientCase(global) {
  const root = global.document && global.document.getElementById('market-autonomy-root');
  if (!root) return;

  let mounting = false;

  const STATUS_LABEL = Object.freeze({
    open: 'Ouvert',
    processing: 'En traitement',
    resolved: 'Résolu',
    closed: 'Clôturé',
  });

  const ALLOWED_TRANSITIONS = Object.freeze({
    open: ['processing'],
    processing: ['resolved', 'closed', 'open'],
    resolved: ['closed', 'processing'],
    closed: ['processing'],
  });

  function el(tag, className, value) {
    const node = global.document.createElement(tag);
    if (className) node.className = className;
    if (value != null) node.textContent = String(value);
    return node;
  }

  async function request(url, options = {}) {
    const response = await global.fetch(url, {
      method: options.method || 'GET',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(options.body == null ? {} : { 'Content-Type': 'application/json' }),
      },
      body: options.body == null ? undefined : JSON.stringify(options.body),
    });
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

  async function resolveMarketCode() {
    const context = await request('/api/admin/dashboard/context');
    return marketFromContext(context);
  }

  function renderDisputeItem(dispute, marketCode, canHandle, refresh) {
    const card = el('article', 'kmc-team-member');
    const head = el('div', 'kmc-team-member-head');
    const copy = el('div', 'kmc-team-member-copy');
    copy.appendChild(el('strong', '', `${dispute.type || 'Litige'} · commande ${dispute.order_id}`));
    copy.appendChild(el('small', '', dispute.description || ''));
    head.appendChild(copy);
    head.appendChild(pill(STATUS_LABEL[dispute.status] || dispute.status, dispute.status === 'resolved' || dispute.status === 'closed'));
    card.appendChild(head);

    if (dispute.resolution) {
      const note = el('div', 'kmc-team-help', `Note de résolution actuelle : ${dispute.resolution}`);
      card.appendChild(note);
    }

    if (!canHandle) return card;

    const legalNext = ALLOWED_TRANSITIONS[dispute.status] || [];
    if (!legalNext.length) return card;

    const form = el('div', 'kmc-team-form-row');
    form.style.gridTemplateColumns = '1fr';
    const resolutionInput = global.document.createElement('input');
    resolutionInput.type = 'text';
    resolutionInput.className = 'kmc-team-input';
    resolutionInput.placeholder = 'Note de résolution (optionnelle)';
    resolutionInput.value = dispute.resolution || '';
    form.appendChild(resolutionInput);
    card.appendChild(form);

    const actions = el('div', 'kmc-team-actions');
    legalNext.forEach(nextStatus => {
      const btn = el('button', 'kmc-workspace-action is-secondary', `→ ${STATUS_LABEL[nextStatus] || nextStatus}`);
      btn.type = 'button';
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          await request(`/api/market-delegation/markets/${encodeURIComponent(marketCode)}/client-cases/disputes/${encodeURIComponent(dispute.id)}`, {
            method: 'PUT',
            body: { status: nextStatus, resolution: resolutionInput.value.trim() || undefined },
          });
          await refresh();
        } catch (error) {
          global.alert(`${error.message}${error.code ? ` · ${error.code}` : ''}`);
          btn.disabled = false;
        }
      });
      actions.appendChild(btn);
    });
    card.appendChild(actions);
    return card;
  }

  async function mountClientCase() {
    if (mounting || root.querySelector('[data-market-client-case]') || !root.classList.contains('kmc-workspace')) return;
    mounting = true;
    try {
      const marketCode = await resolveMarketCode();
      if (!marketCode) return;

      let data = null;
      try {
        data = await request(`/api/market-delegation/markets/${encodeURIComponent(marketCode)}/client-cases/disputes`);
      } catch (error) {
        if (error.status === 403) return; // capacité absente : section absente, jamais grisée
        const section = el('section', 'kmc-section kmc-team-section');
        section.dataset.marketClientCase = '';
        section.appendChild(el('h2', 'kmc-section-title', 'Litiges clients'));
        section.appendChild(el('div', 'kmc-team-empty', `${error.message}${error.code ? ` · ${error.code}` : ''}`));
        root.appendChild(section);
        return;
      }

      const canHandle = (data.actor_capabilities || []).includes('client.case.handle');
      const disputes = data.disputes || [];

      const section = el('section', 'kmc-section kmc-team-section');
      section.dataset.marketClientCase = '';
      section.appendChild(el('h2', 'kmc-section-title', 'Litiges clients'));
      section.appendChild(el('p', 'kmc-workspace-note', 'Le workflow du litige (statut, note de résolution) est délégué au market manager. Le montant du remboursement reste exclusivement sous autorité centrale et n’apparaît jamais ici.'));

      const summary = el('div', 'kmc-team-summary');
      summary.appendChild(pill(`${disputes.filter(d => d.status === 'open').length} ouverts`, disputes.some(d => d.status === 'open')));
      summary.appendChild(pill(`${disputes.filter(d => d.status === 'processing').length} en traitement`));
      summary.appendChild(pill(`${disputes.filter(d => d.status === 'resolved' || d.status === 'closed').length} clôturés`));
      section.appendChild(summary);

      const refresh = async () => {
        section.remove();
        await mountClientCase();
      };

      const list = el('div', 'kmc-team-list');
      if (!disputes.length) list.appendChild(el('div', 'kmc-team-empty', 'Aucun litige pour ce Market ID.'));
      disputes.forEach(d => list.appendChild(renderDisputeItem(d, marketCode, canHandle, refresh)));
      section.appendChild(list);

      root.appendChild(section);
    } finally {
      mounting = false;
    }
  }

  const observer = new MutationObserver(() => { void mountClientCase(); });
  observer.observe(root, { childList: true, attributes: true, attributeFilter: ['class'] });
  void mountClientCase();
})(window);

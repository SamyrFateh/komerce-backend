/**
 * @komerce-arch
 * @role          market-autonomy-settlement-delegation-ui
 * @domain        market-autonomy
 * @layer         ui-workspace
 * @criticality   high
 * @inputs        authenticated user, server admin context, market-delegation settlement read model
 * @outputs       settlement lifecycle controls (demander, confirmer réception)
 * @depends       /api/admin/dashboard/context, /api/market-delegation/markets/:marketCode/settlements
 * @used-by       /dashboards/canonical/market-autonomy.html
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      ui_never_grants_more_than_server_actor_capabilities, server_scope_is_authority, monetary_snapshot_immutable
 * @impact-areas  admin-dashboard, market-autonomy, market-delegation, settlement, finance
 * @version       2026-09
 */
'use strict';

/**
 * Même patron exact que market-team.js / market-network.js /
 * market-local-offer.js / market-client-case.js.
 *
 * Machine à états stricte vérifiée dans services/market-settlement-
 * service.js AVANT d'écrire cette UI (doctrine
 * strict_ready_requested_paid_received_machine,
 * ready_is_central_attestation_not_formula,
 * monetary_snapshot_immutable) :
 *
 *   READY --[market_operator: finance.act]--> REQUESTED
 *   REQUESTED --[CENTRAL UNIQUEMENT, aucune route market-delegation]--> PAID
 *   PAID --[market_operator: settlement.receive]--> RECEIVED
 *
 * Le montant (amount/currency) est une attestation centrale immuable —
 * affiché en LECTURE SEULE, jamais un champ éditable. Aucune action
 * "marquer payé" n'est exposée : cette transition n'a pas de route
 * market-delegation, elle appartient exclusivement à la finance
 * centrale (routes/admin-market-settlement.js).
 *
 * Capacités distinctes vérifiées : finance.read (liste),
 * finance.act (demander), settlement.receive (confirmer réception).
 */
(function bootMarketSettlement(global) {
  const root = global.document && global.document.getElementById('market-autonomy-root');
  if (!root) return;

  let mounting = false;

  const STATUS_LABEL = Object.freeze({
    READY: 'Prêt (attestation centrale)',
    REQUESTED: 'Demandé',
    PAID: 'Payé — en attente de confirmation',
    RECEIVED: 'Reçu',
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

  function renderSettlementItem(item, marketCode, capabilities, refresh) {
    const card = el('article', 'kmc-team-member');
    const head = el('div', 'kmc-team-member-head');
    const copy = el('div', 'kmc-team-member-copy');
    copy.appendChild(el('strong', '', `${item.amount} ${item.currency} · ${item.source || 'source inconnue'}`));
    const periodText = item.period_start && item.period_end ? `Période ${item.period_start} → ${item.period_end}` : '';
    copy.appendChild(el('small', '', [periodText, item.attestation_note].filter(Boolean).join(' · ')));
    head.appendChild(copy);
    head.appendChild(pill(STATUS_LABEL[item.status] || item.status, item.status === 'RECEIVED'));
    card.appendChild(head);

    if (item.payment_reference) {
      card.appendChild(el('div', 'kmc-team-help', `Référence de paiement : ${item.payment_reference}`));
    }
    if (item.receipt_note) {
      card.appendChild(el('div', 'kmc-team-help', `Note de réception : ${item.receipt_note}`));
    }

    if (item.status === 'READY' && capabilities.includes('finance.act')) {
      const btn = el('button', 'kmc-workspace-action is-secondary', 'Demander le règlement');
      btn.type = 'button';
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          await request(`/api/market-delegation/markets/${encodeURIComponent(marketCode)}/settlements/${encodeURIComponent(item.id)}/request`, { method: 'POST' });
          await refresh();
        } catch (error) {
          global.alert(`${error.message}${error.code ? ` · ${error.code}` : ''}`);
          btn.disabled = false;
        }
      });
      card.appendChild(btn);
    }

    if (item.status === 'PAID' && capabilities.includes('settlement.receive')) {
      const row = el('div', 'kmc-team-form-row');
      row.style.gridTemplateColumns = '1fr auto';
      const noteInput = global.document.createElement('input');
      noteInput.type = 'text';
      noteInput.className = 'kmc-team-input';
      noteInput.placeholder = 'Note de réception (optionnelle)';
      const btn = el('button', 'kmc-workspace-action', 'Confirmer la réception');
      btn.type = 'button';
      row.appendChild(noteInput);
      row.appendChild(btn);
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          await request(`/api/market-delegation/markets/${encodeURIComponent(marketCode)}/settlements/${encodeURIComponent(item.id)}/receive`, {
            method: 'POST',
            body: { receipt_note: noteInput.value.trim() || undefined },
          });
          await refresh();
        } catch (error) {
          global.alert(`${error.message}${error.code ? ` · ${error.code}` : ''}`);
          btn.disabled = false;
        }
      });
      card.appendChild(row);
    }
    return card;
  }

  async function mountSettlement() {
    if (mounting || root.querySelector('[data-market-settlement]') || !root.classList.contains('kmc-workspace')) return;
    mounting = true;
    try {
      const marketCode = await resolveMarketCode();
      if (!marketCode) return;

      let data = null;
      try {
        data = await request(`/api/market-delegation/markets/${encodeURIComponent(marketCode)}/settlements`);
      } catch (error) {
        if (error.status === 403) return; // capacité absente : section absente, jamais grisée
        const section = el('section', 'kmc-section kmc-team-section');
        section.dataset.marketSettlement = '';
        section.appendChild(el('h2', 'kmc-section-title', 'Règlements'));
        section.appendChild(el('div', 'kmc-team-empty', `${error.message}${error.code ? ` · ${error.code}` : ''}`));
        root.appendChild(section);
        return;
      }

      const capabilities = data.actor_capabilities || [];
      const settlements = data.settlements || [];

      const section = el('section', 'kmc-section kmc-team-section');
      section.dataset.marketSettlement = '';
      section.appendChild(el('h2', 'kmc-section-title', 'Règlements'));
      section.appendChild(el('p', 'kmc-workspace-note', 'Le montant est une attestation centrale, jamais modifiable ici. Le manager peut demander un règlement prêt, puis confirmer sa réception une fois payé — la mise en paiement elle-même reste sous autorité centrale.'));

      const summary = el('div', 'kmc-team-summary');
      summary.appendChild(pill(`${settlements.filter(s => s.status === 'READY').length} prêts`, settlements.some(s => s.status === 'READY')));
      summary.appendChild(pill(`${settlements.filter(s => s.status === 'REQUESTED').length} demandés`));
      summary.appendChild(pill(`${settlements.filter(s => s.status === 'PAID').length} payés — à confirmer`, settlements.some(s => s.status === 'PAID')));
      summary.appendChild(pill(`${settlements.filter(s => s.status === 'RECEIVED').length} reçus`));
      section.appendChild(summary);

      const refresh = async () => {
        section.remove();
        await mountSettlement();
      };

      const list = el('div', 'kmc-team-list');
      if (!settlements.length) list.appendChild(el('div', 'kmc-team-empty', 'Aucun règlement pour ce Market ID.'));
      settlements.forEach(s => list.appendChild(renderSettlementItem(s, marketCode, capabilities, refresh)));
      section.appendChild(list);

      root.appendChild(section);
    } finally {
      mounting = false;
    }
  }

  const observer = new MutationObserver(() => { void mountSettlement(); });
  observer.observe(root, { childList: true, attributes: true, attributeFilter: ['class'] });
  void mountSettlement();
})(window);

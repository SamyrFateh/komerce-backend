/**
 * @komerce-arch
 * @role          market-autonomy-cash-control-ui
 * @domain        market-autonomy
 * @layer         ui-workspace
 * @criticality   medium
 * @inputs        authenticated user, server admin context, market cash-control policy
 * @outputs       partner cash-control policy controls
 * @depends       /api/admin/dashboard/context, /api/market-delegation/markets/:marketCode/cash-control-policy
 * @used-by       /dashboards/canonical/market-autonomy.html
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      partner_owns_cash_control_policy, central_floor_not_business_thresholds, server_scope_is_authority
 * @impact-areas  admin-dashboard, market-autonomy, market-delegation, payments, cash
 * @version       2026-09
 */
'use strict';

(function bootMarketCashControl(global) {
  const root = global.document && global.document.getElementById('market-autonomy-root');
  if (!root) return;

  let mounting = false;

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

  function badge(label, active) {
    return el('span', `kmc-cash-badge${active ? ' is-active' : ''}`, label);
  }

  function modeLabel(mode) {
    return mode === 'DUAL_ALWAYS' ? 'Validation double' : 'Validation simple';
  }

  function fillSummary(summary, payload) {
    const policy = payload.policy || {};
    summary.replaceChildren();
    summary.appendChild(badge(policy.cash_enabled === false ? 'Cash suspendu' : 'Cash actif', policy.cash_enabled !== false));
    summary.appendChild(badge(modeLabel(policy.confirmation_mode), policy.confirmation_mode === 'DUAL_ALWAYS'));
    if (payload.market && payload.market.currency) summary.appendChild(badge(payload.market.currency, false));
  }

  async function resolveMarketCode() {
    const context = await request('/api/admin/dashboard/context');
    return marketFromContext(context);
  }

  function renderPolicy(section, marketCode, payload) {
    const policy = payload.policy || {};
    const canManage = Boolean(payload.can_manage);

    section.appendChild(el('h2', 'kmc-section-title', 'Protection des encaissements'));
    section.appendChild(el(
      'p',
      'kmc-workspace-note',
      'Cette politique appartient au partenaire pays. Komerce impose seulement les invariants non contournables : traçabilité, acteurs distincts en double validation, montant issu de la commande et impossibilité de réécrire silencieusement un encaissement confirmé.'
    ));

    const summary = el('div', 'kmc-cash-summary');
    fillSummary(summary, payload);
    section.appendChild(summary);

    const grid = el('div', 'kmc-cash-grid');

    const enabledCard = el('article', 'kmc-cash-card');
    enabledCard.appendChild(el('strong', '', 'Accepter les paiements cash'));
    enabledCard.appendChild(el('p', 'kmc-cash-help', 'Le partenaire peut couper temporairement le cash dans son marché sans modifier les autres moyens de paiement.'));
    const enabledLabel = el('label', 'kmc-cash-toggle-row');
    const enabled = global.document.createElement('input');
    enabled.type = 'checkbox';
    enabled.checked = policy.cash_enabled !== false;
    enabled.disabled = !canManage;
    enabledLabel.append(enabled, el('span', '', 'Cash autorisé dans ce marché'));
    enabledCard.appendChild(enabledLabel);
    grid.appendChild(enabledCard);

    const modeCard = el('article', 'kmc-cash-card');
    modeCard.appendChild(el('strong', '', 'Niveau de validation'));
    modeCard.appendChild(el('p', 'kmc-cash-help', 'La validation double protège la caisse du partenaire : le premier visa ne déclenche aucun paiement, stock, reçu ou sourcing.'));
    const select = global.document.createElement('select');
    select.className = 'kmc-workspace-input kmc-cash-select';
    select.disabled = !canManage;
    [
      ['SINGLE', 'Validation simple · 1 personne habilitée'],
      ['DUAL_ALWAYS', 'Validation double · 2 personnes distinctes'],
    ].forEach(([value, label]) => {
      const option = global.document.createElement('option');
      option.value = value;
      option.textContent = label;
      option.selected = policy.confirmation_mode === value;
      select.appendChild(option);
    });
    modeCard.appendChild(select);
    grid.appendChild(modeCard);

    section.appendChild(grid);

    const feedback = el('div', 'kmc-cash-feedback');
    feedback.setAttribute('role', 'status');
    section.appendChild(feedback);

    if (!canManage) {
      feedback.textContent = 'Lecture seule · la modification exige cash_control.policy.manage.';
      return;
    }

    const save = el('button', 'kmc-workspace-action', 'Enregistrer la politique');
    save.type = 'button';
    save.addEventListener('click', async () => {
      save.disabled = true;
      save.textContent = 'Enregistrement…';
      feedback.className = 'kmc-cash-feedback';
      feedback.textContent = '';
      try {
        const updated = await request(`/api/market-delegation/markets/${encodeURIComponent(marketCode)}/cash-control-policy`, {
          method: 'PUT',
          body: {
            cash_enabled: enabled.checked,
            confirmation_mode: select.value,
          },
        });
        fillSummary(summary, updated);
        enabled.checked = updated.policy.cash_enabled !== false;
        select.value = updated.policy.confirmation_mode;
        feedback.className = 'kmc-cash-feedback is-positive';
        feedback.textContent = `${updated.market.name || marketCode} · ${updated.policy.cash_enabled ? 'cash actif' : 'cash suspendu'} · ${modeLabel(updated.policy.confirmation_mode)}.`;
      } catch (error) {
        feedback.className = 'kmc-cash-feedback is-critical';
        feedback.textContent = `${error.message}${error.code ? ` · ${error.code}` : ''}`;
      } finally {
        save.disabled = false;
        save.textContent = 'Enregistrer la politique';
      }
    });
    section.appendChild(save);
  }

  async function mountCashControl() {
    if (mounting || root.querySelector('[data-market-cash-control]') || !root.classList.contains('kmc-workspace')) return;
    mounting = true;
    try {
      const marketCode = await resolveMarketCode();
      if (!marketCode) return;

      let payload;
      try {
        payload = await request(`/api/market-delegation/markets/${encodeURIComponent(marketCode)}/cash-control-policy`);
      } catch (error) {
        if (error.status === 403) return;
        const section = el('section', 'kmc-section kmc-cash-section');
        section.dataset.marketCashControl = '';
        section.appendChild(el('h2', 'kmc-section-title', 'Protection des encaissements'));
        section.appendChild(el('div', 'kmc-cash-feedback is-critical', `${error.message}${error.code ? ` · ${error.code}` : ''}`));
        root.appendChild(section);
        return;
      }

      const section = el('section', 'kmc-section kmc-cash-section');
      section.dataset.marketCashControl = '';
      renderPolicy(section, marketCode, payload);

      const teamSection = root.querySelector('[data-market-team]');
      if (teamSection) root.insertBefore(section, teamSection);
      else root.appendChild(section);
    } finally {
      mounting = false;
    }
  }

  const observer = new MutationObserver(() => { void mountCashControl(); });
  observer.observe(root, { childList: true, attributes: true, attributeFilter: ['class'] });
  void mountCashControl();
})(window);

/**
 * @komerce-arch
 * @role          markets-management-ui
 * @domain        admin-dashboard
 * @layer         ui-workspace
 * @criticality   high
 * @inputs        authenticated_admin, /api/admin/markets
 * @outputs       markets_list, readiness_gaps_view, lifecycle_open_suspend_actions, delivery_attestation_form
 * @depends       /api/admin/markets, /api/admin/markets/:marketCode/control-plane, /api/admin/markets/:marketCode/lifecycle, /api/admin/markets/:marketCode/delivery-attestations
 * @used-by       /dashboards/canonical/access.html
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      control_plane_orchestrates_owned_writers, central_by_role_declared, no_new_api, server_readiness_is_authority, merge_is_not_activation
 * @impact-areas  admin-dashboard, market-control-plane
 * @version       2026-10
 */
'use strict';

(function bootMarketsManagement(global) {
  const LABELS = Object.freeze({
    PROVISIONING: 'En préparation',
    ACTIVE: 'Ouvert',
    SUSPENDED: 'Suspendu',
    CLOSED: 'Clôturé',
  });

  // Miroir d'affichage de ALLOWED_TRANSITIONS (services/market-lifecycle-service.js).
  // Le serveur reste l'autorité : une transition refusée remonte son message.
  // CLOSED est volontairement absent de l'UI (irréversible).
  function actionsFor(status) {
    if (status === 'PROVISIONING') return [{ target: 'ACTIVE', label: 'Ouvrir' }];
    if (status === 'ACTIVE') return [{ target: 'SUSPENDED', label: 'Suspendre' }];
    if (status === 'SUSPENDED') return [{ target: 'ACTIVE', label: 'Rouvrir' }];
    return [];
  }

  function statusLabel(status) {
    return LABELS[status] || status || '—';
  }

  function confirmMessage(market, action) {
    const verb = action.target === 'ACTIVE' ? 'ouvrir' : 'suspendre';
    return `Confirmer : ${verb} le marché ${market.code} (${market.name}) ?`;
  }

  async function request(fetchImpl, url, options = {}) {
    const response = await fetchImpl(url, {
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

  function el(doc, tag, className, value) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (value != null) node.textContent = String(value);
    return node;
  }

  const MODES = ['SEA', 'AIR', 'ROAD', 'MIXED'];
  const RATE_UNITS = ['PER_KG', 'PER_PARCEL'];

  function field(doc, form, name, label, type, choices) {
    const wrap = el(doc, 'label', 'kmc-markets-mgmt-field', label);
    const input = choices ? el(doc, 'select') : el(doc, 'input');
    if (!choices) input.type = type || 'text';
    input.name = name;
    input.dataset.field = name;
    if (choices) {
      choices.forEach(choice => {
        const option = el(doc, 'option', '', choice.label);
        option.value = choice.value;
        input.appendChild(option);
      });
    }
    wrap.appendChild(input);
    form.appendChild(wrap);
    form.fields = form.fields || {};
    form.fields[name] = input;
    return input;
  }

  function attestationPayload(fields) {
    const num = key => (fields[key].value === '' ? null : Number(fields[key].value));
    return {
      carrier_id: fields.carrier_id.value,
      mode: fields.mode.value,
      origin_ref: fields.origin_ref.value,
      freight_rate: num('freight_rate'),
      rate_currency: String(fields.rate_currency.value || '').toUpperCase(),
      rate_unit: fields.rate_unit.value,
      transit_days: num('transit_days'),
      evidence_ref: fields.evidence_ref.value,
      valid_until: fields.valid_until.value ? new Date(`${fields.valid_until.value}T23:59:59Z`).toISOString() : null,
    };
  }

  // Preuve de livrabilité (lot B) : lecture de la readiness serveur, écriture via les routes centrales existantes.
  // Le coût attesté n'est jamais un prix de vente ; l'écran ne montre que la preuve, pas un tarif client.
  function renderDeliveryProof(doc, cell, state, market, options) {
    const proof = state.gaps.deliveryProof || null;
    const hasGap = state.gaps.items.some(gap => gap.code === 'NO_DELIVERY_PROOF');
    const box = el(doc, 'div', 'kmc-markets-mgmt-proof');
    box.dataset.deliveryProof = market.code;
    if (proof && proof.proven && proof.attestation) {
      const att = proof.attestation;
      box.appendChild(el(doc, 'p', '',
        `Livrabilité attestée : ${att.carrier_name} · ${att.mode} depuis ${att.origin_ref} · coût ${att.freight_rate} ${att.rate_currency}/${att.rate_unit === 'PER_KG' ? 'kg' : 'colis'} (coût, pas un prix de vente) · ${att.transit_days} j · valable jusqu’au ${String(att.valid_until).slice(0, 10)} · preuve : ${att.evidence_ref}`));
      const revoke = el(doc, 'form', 'kmc-markets-mgmt-form');
      field(doc, revoke, 'reason', 'Motif de révocation', 'text');
      const submit = el(doc, 'button', 'kmc-access-button is-danger', 'Révoquer l’attestation');
      submit.type = 'submit';
      revoke.appendChild(submit);
      revoke.addEventListener('submit', event => {
        if (event && event.preventDefault) event.preventDefault();
        options.onRevoke(market, att.id, revoke.fields.reason.value);
      });
      box.appendChild(revoke);
    } else if (proof && proof.proven && proof.basis === 'HISTORY') {
      box.appendChild(el(doc, 'p', '', `Livrabilité prouvée par l’historique (${proof.collected_orders} commandes remises). Aucune attestation à saisir.`));
    } else if (hasGap) {
      box.appendChild(el(doc, 'p', '', 'Aucune preuve de livrabilité : saisir une attestation centrale (transporteur, mode, coût de fret, validité, référence de la preuve documentaire).'));
      const form = el(doc, 'form', 'kmc-markets-mgmt-form');
      field(doc, form, 'carrier_id', 'Transporteur', null, [{ value: '', label: '—' }].concat(
        (state.carriers || []).map(carrier => ({ value: carrier.id, label: carrier.name }))));
      field(doc, form, 'mode', 'Mode', null, MODES.map(value => ({ value, label: value })));
      field(doc, form, 'origin_ref', 'Origine', 'text');
      field(doc, form, 'freight_rate', 'Coût de fret', 'number');
      field(doc, form, 'rate_currency', 'Devise du coût', 'text');
      field(doc, form, 'rate_unit', 'Unité', null, RATE_UNITS.map(value => ({ value, label: value === 'PER_KG' ? 'par kg' : 'par colis' })));
      field(doc, form, 'transit_days', 'Délai (jours)', 'number');
      field(doc, form, 'evidence_ref', 'Référence de la preuve', 'text');
      field(doc, form, 'valid_until', 'Valable jusqu’au', 'date');
      const submit = el(doc, 'button', 'kmc-access-button is-primary', 'Attester la livrabilité');
      submit.type = 'submit';
      form.appendChild(submit);
      form.addEventListener('submit', event => {
        if (event && event.preventDefault) event.preventDefault();
        options.onAttest(market, attestationPayload(form.fields));
      });
      box.appendChild(form);
    } else {
      return;
    }
    cell.appendChild(box);
  }

  function render(host, state, options) {
    const doc = options.document;
    host.replaceChildren();
    host.appendChild(el(doc, 'h2', '', 'Gestion des marchés'));
    host.appendChild(el(doc, 'p', 'kmc-access-muted',
      'Ouvrir ou suspendre un marché. L’ouverture est refusée par le serveur tant que les écarts de préparation ne sont pas levés. La création guidée d’un marché relève du chantier « Créer un nouveau marché ».'));

    const feedback = el(doc, 'p', `kmc-access-feedback${state.feedbackTone ? ` is-${state.feedbackTone}` : ''}`, state.feedback || '');
    feedback.setAttribute('role', 'status');
    host.appendChild(feedback);

    if (!state.markets.length) {
      host.appendChild(el(doc, 'p', 'kmc-access-muted', 'Aucun marché.'));
      return;
    }

    const table = el(doc, 'table', 'kmc-markets-mgmt-table');
    const head = el(doc, 'tr');
    ['Marché', 'Devise', 'État', 'Équipe active', 'Actions'].forEach(label => head.appendChild(el(doc, 'th', '', label)));
    table.appendChild(el(doc, 'thead')).appendChild(head);
    const body = el(doc, 'tbody');
    state.markets.forEach(market => {
      const row = el(doc, 'tr');
      row.dataset.marketCode = market.code;
      row.appendChild(el(doc, 'td', '', `${market.code} · ${market.name}`));
      row.appendChild(el(doc, 'td', '', market.currency));
      const status = el(doc, 'td');
      status.appendChild(el(doc, 'span', 'kmc-markets-mgmt-status', statusLabel(market.lifecycle_status)));
      row.appendChild(status);
      row.appendChild(el(doc, 'td', '', market.active_members == null ? '—' : market.active_members));
      const actions = el(doc, 'td', 'kmc-markets-mgmt-actions');
      const gapsButton = el(doc, 'button', 'kmc-access-button', 'Voir les écarts');
      gapsButton.type = 'button';
      gapsButton.addEventListener('click', () => options.onGaps(market));
      actions.appendChild(gapsButton);
      actionsFor(market.lifecycle_status).forEach(action => {
        const button = el(doc, 'button', action.target === 'ACTIVE' ? 'kmc-access-button is-primary' : 'kmc-access-button is-danger', action.label);
        button.type = 'button';
        button.dataset.lifecycleTarget = action.target;
        button.addEventListener('click', () => options.onLifecycle(market, action));
        actions.appendChild(button);
      });
      row.appendChild(actions);
      body.appendChild(row);
      if (state.gaps && state.gaps.code === market.code) {
        const detail = el(doc, 'tr', 'kmc-markets-mgmt-gaps');
        const cell = el(doc, 'td');
        cell.colSpan = 5;
        if (!state.gaps.items.length) {
          cell.appendChild(el(doc, 'p', '', 'Aucun écart : le marché est prêt.'));
        } else {
          const list = el(doc, 'ul');
          state.gaps.items.forEach(gap => list.appendChild(el(doc, 'li', '', gap.message || gap.code)));
          cell.appendChild(list);
        }
        renderDeliveryProof(doc, cell, state, market, options);
        detail.appendChild(cell);
        body.appendChild(detail);
      }
    });
    table.appendChild(body);
    host.appendChild(table);
  }

  async function mount(host, options = {}) {
    const fetchImpl = options.fetch || global.fetch.bind(global);
    const confirmImpl = options.confirm || ((message) => global.confirm(message));
    const state = { markets: [], gaps: null, feedback: '', feedbackTone: '' };
    const ctx = { document: options.document || global.document };

    async function load() {
      const payload = await request(fetchImpl, '/api/admin/markets');
      state.markets = Array.isArray(payload.markets) ? payload.markets : [];
    }
    function paint() { render(host, state, ctx); }

    ctx.onGaps = async market => {
      try {
        const control = await request(fetchImpl, `/api/admin/markets/${encodeURIComponent(market.code)}/control-plane`);
        state.gaps = { code: market.code, items: control.gaps || [], deliveryProof: control.deliveryProof || null };
        state.carriers = Array.isArray(control.carriers) ? control.carriers : [];
        state.feedback = '';
      } catch (error) {
        state.feedback = error.message;
        state.feedbackTone = 'critical';
      }
      paint();
    };
    ctx.onLifecycle = async (market, action) => {
      if (!confirmImpl(confirmMessage(market, action))) return;
      try {
        await request(fetchImpl, `/api/admin/markets/${encodeURIComponent(market.code)}/lifecycle`, {
          method: 'POST', body: { status: action.target },
        });
        await load();
        state.feedback = `Marché ${market.code} : ${statusLabel(action.target).toLowerCase()}.`;
        state.feedbackTone = 'positive';
      } catch (error) {
        state.feedback = error.message;
        state.feedbackTone = 'critical';
        if (error.code === 'MARKET_NOT_READY_FOR_ACTIVATION') state.gaps = null;
      }
      paint();
    };

    ctx.onAttest = async (market, payload) => {
      try {
        await request(fetchImpl, `/api/admin/markets/${encodeURIComponent(market.code)}/delivery-attestations`, {
          method: 'POST', body: payload,
        });
        await ctx.onGaps(market);
        state.feedback = `Marché ${market.code} : livrabilité attestée.`;
        state.feedbackTone = 'positive';
        paint();
        return;
      } catch (error) {
        state.feedback = error.message;
        state.feedbackTone = 'critical';
      }
      paint();
    };
    ctx.onRevoke = async (market, attestationId, reason) => {
      if (!confirmImpl(`Confirmer : révoquer l’attestation de livrabilité du marché ${market.code} ? Les nouvelles commandes seront refusées.`)) return;
      try {
        await request(fetchImpl, `/api/admin/markets/${encodeURIComponent(market.code)}/delivery-attestations/${encodeURIComponent(attestationId)}/revoke`, {
          method: 'POST', body: { reason },
        });
        await ctx.onGaps(market);
        state.feedback = `Marché ${market.code} : attestation révoquée.`;
        state.feedbackTone = 'positive';
        paint();
        return;
      } catch (error) {
        state.feedback = error.message;
        state.feedbackTone = 'critical';
      }
      paint();
    };

    try {
      await load();
    } catch (error) {
      state.feedback = error.message;
      state.feedbackTone = 'critical';
    }
    paint();
    return state;
  }

  const api = { actionsFor, statusLabel, confirmMessage, mount };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.KomerceMarketsManagement = api;

  // Montage sur access.html (admin) : section après la vue décision, avant les accès.
  const doc = global.document;
  const root = doc && doc.getElementById && doc.getElementById('canonical-admin-root');
  if (!root || typeof global.fetch !== 'function') return;
  let attempts = 80;
  (function wait() {
    if (root.querySelector('.kmc-access-hero')) {
      const host = doc.createElement('section');
      host.id = 'markets-management';
      host.className = 'kmc-access-panel kmc-markets-mgmt';
      const overview = doc.getElementById('markets-decision-admin-overview');
      if (overview && overview.parentNode) overview.parentNode.insertBefore(host, overview.nextSibling);
      else root.insertBefore(host, root.querySelector('.kmc-access-hero'));
      mount(host, { document: doc });
      return;
    }
    attempts -= 1;
    if (attempts > 0) global.setTimeout(wait, 50);
  }());
}(typeof window !== 'undefined' ? window : globalThis));

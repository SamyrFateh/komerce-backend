/**
 * @komerce-arch
 * @role          canonical-pricing-structure-event-panel-ui
 * @domain        admin-dashboard
 * @layer         ui-orchestration
 * @criticality   medium
 * @inputs        charges_reference, structure_cost_event_history, user_submitted_structure_cost_event
 * @outputs       structure_event_panel_dom, structure_cost_event_write_request
 * @depends       none (fetch direct, credentials cookie httpOnly)
 * @used-by       public/dashboards/canonical/js/pricing-economic-cockpit.js, public/dashboards/canonical/index.html
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      structure_adjustments_are_a_separate_form_not_inline, browser_never_recomputes_economic_truth, server_market_scope_is_authority
 * @impact-areas  admin-dashboard, pricing, economic-engine
 * @version       2026-09
 */

'use strict';

(function initStructureEventPanel(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.KomerceCanonicalStructureEventPanel = api;
})(typeof globalThis !== 'undefined' ? globalThis : null, function createStructureEventPanel() {
  const EVENT_KIND_LABELS = Object.freeze({
    ACCRUAL: 'Accrual (nouvelle charge de période)',
    ADJUSTMENT: 'Ajustement (corrige un fait existant)',
    REVERSAL: 'Reversal (annule un fait existant)',
  });
  const SOURCE_KIND_LABELS = Object.freeze({
    INVOICE: 'Facture',
    CONTRACT: 'Contrat',
    CONNECTOR: 'Connecteur',
    MANUAL: 'Manuel',
    ADJUSTMENT: 'Ajustement',
  });

  function el(doc, tag, className, text) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function formatKmf(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return `${n.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} FCFA`;
  }

  function formatDate(value) {
    if (!value) return '—';
    try { return new Date(value).toLocaleDateString('fr-FR'); } catch (_) { return '—'; }
  }

  async function jsonRequest(fetchFn, url, options = {}) {
    const response = await fetchFn(url, {
      method: options.method || 'GET',
      credentials: 'include',
      headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    let payload = null;
    try { payload = await response.json(); } catch (_) { /* réponse vide */ }
    if (!response.ok) {
      const message = (payload && payload.error) || `Requête échouée (${response.status})`;
      throw new Error(message);
    }
    return payload;
  }

  function close(overlay) {
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    if (overlay && overlay.__doc) overlay.__doc.removeEventListener('keydown', overlay.__onKeydown);
  }

  function renderHistory(doc, container, events) {
    container.replaceChildren();
    if (!events.length) {
      container.appendChild(el(doc, 'div', 'kmc-structure-panel-history-empty', 'Aucun ajustement enregistré pour cette charge.'));
      return;
    }
    events.forEach(event => {
      const row = el(doc, 'div', 'kmc-structure-panel-history-row');
      const left = el(doc, 'div');
      left.appendChild(el(doc, 'div', '', EVENT_KIND_LABELS[event.event_kind] || event.event_kind));
      left.appendChild(el(doc, 'div', 'kmc-structure-panel-history-meta',
        `${formatDate(event.economic_from)} → ${formatDate(event.economic_to)} · ${event.recorded_by_name || 'inconnu'}`));
      row.appendChild(left);
      row.appendChild(el(doc, 'div', 'kmc-structure-panel-history-amount', formatKmf(event.amount_kmf)));
      container.appendChild(row);
    });
  }

  function buildForm(doc, charges) {
    const form = doc.createElement('form');
    form.noValidate = true;

    const errorBox = el(doc, 'div', 'kmc-structure-panel-error');
    errorBox.hidden = true;
    form.appendChild(errorBox);

    function field(label, node, hint) {
      const wrap = el(doc, 'div', 'kmc-structure-panel-field');
      const labelNode = el(doc, 'label', 'kmc-structure-panel-label', label);
      wrap.appendChild(labelNode);
      wrap.appendChild(node);
      if (hint) wrap.appendChild(el(doc, 'div', 'kmc-structure-panel-hint', hint));
      return wrap;
    }

    const chargeSelect = doc.createElement('select');
    chargeSelect.name = 'charge_id';
    chargeSelect.required = true;
    const chargePlaceholder = doc.createElement('option');
    chargePlaceholder.value = '';
    chargePlaceholder.textContent = 'Choisir une charge…';
    chargeSelect.appendChild(chargePlaceholder);
    charges.forEach(charge => {
      const opt = doc.createElement('option');
      opt.value = charge.id;
      opt.textContent = `${charge.name} (${charge.family})`;
      chargeSelect.appendChild(opt);
    });
    form.appendChild(field('Charge', chargeSelect));

    const eventKindSelect = doc.createElement('select');
    eventKindSelect.name = 'event_kind';
    Object.entries(EVENT_KIND_LABELS).forEach(([value, label]) => {
      const opt = doc.createElement('option');
      opt.value = value;
      opt.textContent = label;
      eventKindSelect.appendChild(opt);
    });
    eventKindSelect.value = 'ACCRUAL';
    form.appendChild(field('Type d’événement', eventKindSelect));

    const adjustsWrap = el(doc, 'div', 'kmc-structure-panel-field');
    adjustsWrap.hidden = true;
    const adjustsSelect = doc.createElement('select');
    adjustsSelect.name = 'adjusts_event_id';
    adjustsWrap.appendChild(el(doc, 'label', 'kmc-structure-panel-label', 'Fait à corriger'));
    adjustsWrap.appendChild(adjustsSelect);
    adjustsWrap.appendChild(el(doc, 'div', 'kmc-structure-panel-hint', 'Requis pour un ajustement ou une annulation — sélectionnez le fait d’origine dans l’historique.'));
    form.appendChild(adjustsWrap);

    const periodRow = el(doc, 'div', 'kmc-structure-panel-row');
    const fromInput = doc.createElement('input');
    fromInput.type = 'date';
    fromInput.name = 'economic_from';
    fromInput.required = true;
    const toInput = doc.createElement('input');
    toInput.type = 'date';
    toInput.name = 'economic_to';
    toInput.required = true;
    periodRow.appendChild(field('Période — début', fromInput));
    periodRow.appendChild(field('Période — fin', toInput));
    form.appendChild(periodRow);

    const moneyRow = el(doc, 'div', 'kmc-structure-panel-row');
    const amountInput = doc.createElement('input');
    amountInput.type = 'number';
    amountInput.name = 'amount_original';
    amountInput.step = 'any';
    amountInput.required = true;
    const currencyInput = doc.createElement('input');
    currencyInput.type = 'text';
    currencyInput.name = 'currency';
    currencyInput.value = 'KMF';
    currencyInput.maxLength = 3;
    currencyInput.style.textTransform = 'uppercase';
    currencyInput.required = true;
    moneyRow.appendChild(field('Montant', amountInput, 'Positif pour un accrual, négatif pour une annulation.'));
    moneyRow.appendChild(field('Devise', currencyInput));
    form.appendChild(moneyRow);

    const fxRow = el(doc, 'div', 'kmc-structure-panel-row');
    const fxInput = doc.createElement('input');
    fxInput.type = 'number';
    fxInput.name = 'fx_rate_to_kmf';
    fxInput.step = 'any';
    fxInput.value = '1';
    fxInput.disabled = true;
    const fxSourceInput = doc.createElement('input');
    fxSourceInput.type = 'text';
    fxSourceInput.name = 'fx_source';
    fxSourceInput.value = 'native KMF';
    fxRow.appendChild(field('Taux FX → KMF', fxInput));
    fxRow.appendChild(field('Source du taux', fxSourceInput));
    form.appendChild(fxRow);

    currencyInput.addEventListener('input', () => {
      currencyInput.value = currencyInput.value.toUpperCase();
      const isKmf = currencyInput.value === 'KMF';
      fxInput.disabled = isKmf;
      if (isKmf) { fxInput.value = '1'; fxSourceInput.value = 'native KMF'; }
    });

    const sourceSelect = doc.createElement('select');
    sourceSelect.name = 'source_kind';
    Object.entries(SOURCE_KIND_LABELS).forEach(([value, label]) => {
      const opt = doc.createElement('option');
      opt.value = value;
      opt.textContent = label;
      sourceSelect.appendChild(opt);
    });
    sourceSelect.value = 'INVOICE';
    form.appendChild(field('Type de source', sourceSelect));

    const evidenceInput = doc.createElement('input');
    evidenceInput.type = 'text';
    evidenceInput.name = 'evidence_ref';
    evidenceInput.required = true;
    evidenceInput.placeholder = 'ex. invoice://railway/2026-09';
    form.appendChild(field('Référence de preuve', evidenceInput, 'Traçabilité obligatoire — facture, contrat ou export connecteur.'));

    const notesInput = doc.createElement('textarea');
    notesInput.name = 'notes';
    form.appendChild(field('Notes (optionnel)', notesInput));

    function toggleAdjustsVisibility() {
      const needsAdjusts = eventKindSelect.value !== 'ACCRUAL';
      adjustsWrap.hidden = !needsAdjusts;
      adjustsSelect.required = needsAdjusts;
    }
    eventKindSelect.addEventListener('change', toggleAdjustsVisibility);
    toggleAdjustsVisibility();

    return { form, errorBox, chargeSelect, eventKindSelect, adjustsSelect, adjustsWrap, fromInput, toInput, amountInput, currencyInput, fxInput, fxSourceInput, sourceSelect, evidenceInput, notesInput };
  }

  async function open(config) {
    const doc = config.document || (typeof document !== 'undefined' ? document : null);
    if (!doc) throw new Error('structure_event_panel_document_missing');
    const container = config.container || doc.body;
    const fetchFn = config.fetch;

    const overlay = el(doc, 'div', 'kmc-structure-panel-overlay');
    const panel = el(doc, 'div', 'kmc-structure-panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    overlay.appendChild(panel);

    const header = el(doc, 'div', 'kmc-structure-panel-header');
    const titles = doc.createElement('div');
    titles.appendChild(el(doc, 'h2', 'kmc-structure-panel-title', config.title));
    titles.appendChild(el(doc, 'p', 'kmc-structure-panel-subtitle', config.subtitle || ''));
    header.appendChild(titles);
    const closeBtn = el(doc, 'button', 'kmc-structure-panel-close', '✕');
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Fermer');
    header.appendChild(closeBtn);
    panel.appendChild(header);

    const body = el(doc, 'div', 'kmc-structure-panel-body');
    body.appendChild(el(doc, 'div', 'kmc-structure-panel-loading', 'Chargement…'));
    panel.appendChild(body);

    const footer = el(doc, 'div', 'kmc-structure-panel-footer');
    const cancelBtn = el(doc, 'button', 'kmc-structure-panel-btn kmc-structure-panel-btn-secondary', 'Annuler');
    cancelBtn.type = 'button';
    const saveBtn = el(doc, 'button', 'kmc-structure-panel-btn kmc-structure-panel-btn-primary', 'Enregistrer l’ajustement');
    saveBtn.type = 'submit';
    saveBtn.disabled = true;
    footer.appendChild(cancelBtn);
    footer.appendChild(saveBtn);
    panel.appendChild(footer);

    overlay.__onKeydown = event => { if (event.key === 'Escape') close(overlay); };
    overlay.__doc = doc;
    doc.addEventListener('keydown', overlay.__onKeydown);
    closeBtn.addEventListener('click', () => close(overlay));
    cancelBtn.addEventListener('click', () => close(overlay));
    overlay.addEventListener('click', event => { if (event.target === overlay) close(overlay); });

    container.appendChild(overlay);

    let charges = [];
    try {
      const chargesPayload = await jsonRequest(fetchFn, config.chargesEndpoint);
      charges = chargesPayload.charges || [];
    } catch (error) {
      body.replaceChildren(el(doc, 'div', 'kmc-structure-panel-empty', `Impossible de charger les charges : ${error.message}`));
      return { overlay, close: () => close(overlay) };
    }

    const historyTitle = el(doc, 'div', 'kmc-structure-panel-section-title', 'Historique');
    const historyList = el(doc, 'div', 'kmc-structure-panel-history');
    const formTitle = el(doc, 'div', 'kmc-structure-panel-section-title', 'Nouvel ajustement');
    const built = buildForm(doc, charges);

    body.replaceChildren(historyTitle, historyList, formTitle, built.form);
    saveBtn.disabled = false;

    let historyCache = [];
    async function loadHistory(chargeId) {
      if (!chargeId) { renderHistory(doc, historyList, []); return; }
      historyList.replaceChildren(el(doc, 'div', 'kmc-structure-panel-loading', 'Chargement de l’historique…'));
      try {
        const payload = await jsonRequest(fetchFn, `${config.eventsEndpoint}?charge_id=${encodeURIComponent(chargeId)}`);
        historyCache = payload.events || [];
        renderHistory(doc, historyList, historyCache);
        built.adjustsSelect.replaceChildren();
        historyCache.filter(e => e.event_kind === 'ACCRUAL' || e.event_kind === 'ADJUSTMENT').forEach(e => {
          const opt = doc.createElement('option');
          opt.value = e.id;
          opt.textContent = `${formatDate(e.economic_from)} → ${formatDate(e.economic_to)} · ${formatKmf(e.amount_kmf)}`;
          built.adjustsSelect.appendChild(opt);
        });
      } catch (error) {
        historyList.replaceChildren(el(doc, 'div', 'kmc-structure-panel-history-empty', `Historique indisponible : ${error.message}`));
      }
    }

    built.chargeSelect.addEventListener('change', () => loadHistory(built.chargeSelect.value));

    built.form.addEventListener('submit', async event => {
      event.preventDefault();
      built.errorBox.hidden = true;
      saveBtn.disabled = true;
      saveBtn.textContent = 'Enregistrement…';
      try {
        const amountOriginal = Number(built.amountInput.value);
        const fxRate = Number(built.fxInput.value) || 1;
        const body = {
          charge_id: built.chargeSelect.value,
          event_kind: built.eventKindSelect.value,
          adjusts_event_id: built.adjustsWrap.hidden ? undefined : (built.adjustsSelect.value || undefined),
          economic_from: built.fromInput.value ? new Date(`${built.fromInput.value}T00:00:00.000Z`).toISOString() : undefined,
          economic_to: built.toInput.value ? new Date(`${built.toInput.value}T00:00:00.000Z`).toISOString() : undefined,
          amount_original: amountOriginal,
          currency: built.currencyInput.value,
          fx_rate_to_kmf: fxRate,
          fx_source: built.fxSourceInput.value,
          amount_kmf: Math.round(amountOriginal * fxRate),
          source_kind: built.sourceSelect.value,
          evidence_ref: built.evidenceInput.value,
          notes: built.notesInput.value || undefined,
        };
        await jsonRequest(fetchFn, config.submitEndpoint, { method: 'POST', body });
        if (typeof config.onSaved === 'function') await config.onSaved();
        close(overlay);
      } catch (error) {
        built.errorBox.hidden = false;
        built.errorBox.textContent = error.message;
        saveBtn.disabled = false;
        saveBtn.textContent = 'Enregistrer l’ajustement';
      }
    });

    return { overlay, close: () => close(overlay) };
  }

  return { open };
});

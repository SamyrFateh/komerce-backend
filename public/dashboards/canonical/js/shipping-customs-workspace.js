/**
 * @komerce-arch
 * @role          canonical-shipping-customs-workspace-ui
 * @domain        admin-dashboard
 * @layer         ui-orchestration
 * @criticality   high
 * @inputs        server_resolved_admin_context, explicit_market_code, shipping_customs_work_queue
 * @outputs       canonical_shipping_customs_workspace_dom, authorized_action_requests
 * @depends       canonical primitives, admin-context
 * @used-by       canonical admin entrypoint
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      workspace_acts_dashboard_observes, country_manager_supervises_without_field_agent_escalation, browser_never_supplies_market_id_authority
 * @impact-areas  admin-dashboard, logistics, customs
 * @version       2026-09
 */

'use strict';

(function initShippingCustomsWorkspace(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.KomerceCanonicalShippingCustomsWorkspace = api;
})(typeof globalThis !== 'undefined' ? globalThis : null, function createShippingCustomsWorkspace() {
  const ENDPOINT_PREFIX = '/api/admin/workspaces/shipping-customs/market/';
  const MARKET_CODE = /^[A-Z]{2}$/;
  const TRANSIT_ACTION_ROLES = Object.freeze(['admin', 'agent_hub', 'agent_transitaire']);

  function endpointFor(marketCode, suffix = '') {
    const code = String(marketCode || '').trim().toUpperCase();
    if (!MARKET_CODE.test(code)) throw new Error('canonical_shipping_customs_workspace_market_required');
    const tail = suffix ? '/' + String(suffix).replace(/^\/+/, '') : '';
    return ENDPOINT_PREFIX + encodeURIComponent(code) + tail;
  }

  function canConfirmTransit(user) {
    return Boolean(user && TRANSIT_ACTION_ROLES.includes(user.role));
  }

  function text(doc, tag, className, value) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    node.textContent = value == null ? '' : String(value);
    return node;
  }

  function formatNumber(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '—';
    return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(number);
  }

  function formatKmf(value) {
    return value == null ? '—' : `${formatNumber(value)} KMF`;
  }

  function formatDate(value) {
    const date = value ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' }).format(date);
  }

  async function jsonRequest(fetchFn, url, options = {}) {
    const response = await fetchFn(url, {
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
      const error = new Error(body.error || `Erreur HTTP ${response.status}`);
      error.code = body.code || null;
      error.status = response.status;
      throw error;
    }
    return body;
  }

  function setFeedback(rootNode, message, tone = 'neutral') {
    const target = rootNode.querySelector('[data-workspace-feedback]');
    if (!target) return;
    target.className = `kmc-workspace-feedback is-${tone}`;
    target.textContent = message || '';
  }

  function createHeader(doc, payload, context) {
    const header = doc.createElement('header');
    header.className = 'kmc-workspace-header';
    header.setAttribute('data-dashboard-role', 'hero');
    const copy = doc.createElement('div');
    copy.appendChild(text(doc, 'span', 'kmc-workspace-kicker', 'EXPÉDITIONS & DOUANE'));
    copy.appendChild(text(doc, 'h1', 'kmc-workspace-title', 'Flux international'));
    const supervisionOnly = context.user && context.user.role === 'market_operator';
    copy.appendChild(text(
      doc,
      'p',
      'kmc-workspace-subtitle',
      `${payload.scope.code} · ${payload.scope.name} · ${supervisionOnly ? 'suivre les dossiers à traiter' : 'agir sur les dossiers autorisés'}`
    ));
    header.appendChild(copy);

    const nav = doc.createElement('nav');
    nav.className = 'kmc-workspace-nav';
    const operations = text(doc, 'a', 'kmc-workspace-nav-link', '← Dashboard Opérations');
    operations.setAttribute('href', '/admin/operations');
    nav.appendChild(operations);
    header.appendChild(nav);

    const feedback = text(doc, 'div', 'kmc-workspace-feedback', '');
    feedback.setAttribute('data-workspace-feedback', '');
    feedback.setAttribute('role', 'status');
    header.appendChild(feedback);
    return header;
  }

  function createSection(rootNode, ui, title, description) {
    const section = ui.Section.create({ title, description });
    rootNode.appendChild(section.element);
    return section.slot;
  }

  function makeButton(doc, label, action) {
    const button = text(doc, 'button', 'kmc-workspace-action', label);
    button.type = 'button';
    button.setAttribute('data-workspace-action', action);
    return button;
  }

  function metricItems(summary = {}) {
    return [
      { key: 'transit-ready', label: 'À mettre en transit', value: formatNumber(summary.transit_ready), tone: summary.transit_ready ? 'warning' : 'neutral' },
      { key: 'transit-active', label: 'En transit', value: formatNumber(summary.transit_active), tone: 'neutral' },
      { key: 'customs-candidates', label: 'À rattacher douane', value: formatNumber(summary.customs_candidates), tone: summary.customs_candidates ? 'warning' : 'neutral' },
      { key: 'customs-pending', label: 'Douane à déclarer', value: formatNumber(summary.customs_pending), tone: summary.customs_pending ? 'warning' : 'neutral' },
      { key: 'customs-declared', label: 'Douane déclarée', value: formatNumber(summary.customs_declared), tone: 'neutral' },
    ];
  }

  function signalItems(signals = {}) {
    return [
      { key: 'dossiers-a-traiter', label: 'Dossiers douane à traiter', value: formatNumber(signals.dossiers_a_traiter), tone: signals.dossiers_a_traiter ? 'warning' : 'neutral' },
      { key: 'transit-14j', label: 'Transit > 14 jours', value: formatNumber(signals.transit_plus_14j), tone: signals.transit_plus_14j ? 'critical' : 'neutral' },
      { key: 'colis-sans-dossier', label: 'Colis sans dossier douane', value: formatNumber(signals.colis_sans_dossier), tone: signals.colis_sans_dossier ? 'warning' : 'neutral' },
      { key: 'couts-logistiques', label: 'Coûts logistiques', value: formatKmf(signals.couts_logistiques_kmf), tone: 'neutral' },
      { key: 'delai-moyen', label: 'Délai moyen déclaration', value: signals.delai_moyen_jours != null ? `${signals.delai_moyen_jours} j` : '—', tone: 'neutral' },
    ];
  }

  /**
   * Couche de pilotage additive — au-dessus du flux d'exécution déjà
   * existant (renderTransit/renderCustoms), jamais à leur place.
   * Consomme payload.signals (services/shipping-customs-workspace.js#
   * buildSignals), jamais de recalcul métier côté navigateur.
   *
   * Volontairement absent : aucun signal "documents expirants" ni
   * "conformité documentaire" — customs_shipments ne trace aucun type
   * de document ni date d'expiration (vérifié dans le schéma), cohérent
   * avec la copie déjà présente plus bas sur cette page.
   */
  function renderSignals(rootNode, ui, doc, payload) {
    const signals = payload.signals || {};
    const slot = ui.Section.create({
      id: 'shipping-customs-signals',
      title: 'Signaux international',
      description: 'Ce que le serveur observe déjà sur ce marché — sans délai cible ni conformité documentaire inventés.',
    });
    rootNode.appendChild(slot.element);

    const strip = doc.createElement('div');
    strip.className = 'kmc-metric-strip';
    strip.setAttribute('data-metric-strip', '');
    signalItems(signals).forEach(item => {
      const card = doc.createElement('article');
      card.className = `kmc-metric-card is-${item.tone || 'neutral'}`;
      if (item.key) card.setAttribute('data-metric-key', item.key);
      card.appendChild(text(doc, 'span', 'kmc-metric-label', item.label));
      card.appendChild(text(doc, 'strong', 'kmc-metric-value', item.value != null ? item.value : '—'));
      strip.appendChild(card);
    });
    slot.slot.appendChild(strip);
  }

  async function runAction(context, button, options) {
    const confirmFn = context.confirm || (() => true);
    if (options.confirmMessage && !confirmFn(options.confirmMessage)) return null;
    const previous = button.textContent;
    button.disabled = true;
    button.textContent = 'En cours…';
    setFeedback(context.root, options.runningMessage || 'Action en cours…');
    try {
      const result = await jsonRequest(context.fetch, options.url, { method: 'POST', body: options.body });
      setFeedback(context.root, options.successMessage || 'Action appliquée.', 'positive');
      await context.reload();
      return result;
    } catch (error) {
      setFeedback(context.root, error.message, 'critical');
      button.disabled = false;
      button.textContent = previous;
      return null;
    }
  }

  function renderTransit(rootNode, ui, doc, payload, context) {
    const canAct = canConfirmTransit(context.user);
    const slot = createSection(
      rootNode,
      ui,
      canAct ? 'Transitaire · Confirmer le transit' : 'Expéditions · Supervision transit',
      canAct
        ? 'Colis expédiés prêts à passer en transit.'
        : 'Colis à suivre sur ce marché.'
    );
    const rows = payload.transit.ready || [];
    if (!rows.length) {
      slot.appendChild(text(doc, 'div', 'kmc-workspace-empty', 'Aucun colis à mettre en transit.'));
      return;
    }
    const table = doc.createElement('table');
    table.className = 'kmc-workspace-table';
    table.innerHTML = '<thead><tr><th>Colis</th><th>Commande</th><th>Client</th><th>Destination</th><th>Poids</th><th>Depuis</th><th></th></tr></thead>';
    const tbody = doc.createElement('tbody');
    rows.forEach(row => {
      const tr = doc.createElement('tr');
      [row.reference, row.order_ref, row.client_name, row.relais_name || row.destination_island, row.weight_kg == null ? '—' : `${row.weight_kg} kg`, formatDate(row.shipped_at)].forEach((value, index) => {
        const td = doc.createElement('td');
        const nav = globalThis.KomerceCanonicalNavigation;
        // Colonne Commande : lien direct vers la fiche 360 (retour = cet écran) pour les rôles autorisés par le serveur.
        if (index === 1 && value && nav && typeof nav.canOpenEntity360 === 'function' && nav.canOpenEntity360(context.user)) {
          const link = doc.createElement('a');
          link.setAttribute('href', nav.withEntityReturnTo(`/admin/orders/${encodeURIComponent(value)}`, nav.currentReturnTarget(null), 'Retour aux expéditions'));
          link.textContent = value;
          td.appendChild(link);
        } else {
          td.textContent = value || '—';
        }
        tr.appendChild(td);
      });
      const actionCell = doc.createElement('td');
      if (canAct) {
        const button = makeButton(doc, 'Mettre en transit', 'confirm-transit');
        actionCell.appendChild(button);
        button.addEventListener('click', () => runAction(context, button, {
          url: endpointFor(context.marketCode, `parcels/${encodeURIComponent(row.reference)}/confirm-transit`),
          confirmMessage: `Confirmer le transit de ${row.reference} ?`,
          successMessage: `${row.reference} est maintenant en transit.`,
        }));
      } else {
        actionCell.appendChild(text(doc, 'span', 'kmc-workspace-note', 'Exécution déléguée'));
      }
      tr.appendChild(actionCell);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    const wrap = doc.createElement('div');
    wrap.className = 'kmc-workspace-table-wrap';
    wrap.appendChild(table);
    slot.appendChild(wrap);
  }

  function candidateRefs(payload) {
    return (payload.customs && Array.isArray(payload.customs.candidates) ? payload.customs.candidates : [])
      .map(row => row.reference)
      .filter(Boolean);
  }

  // ── Saisie douane : formulaire intégré (remplace prompt()/confirm() natifs) ──────────────────
  const CURRENCY_LABEL = 'KMF';
  const STATUS_LABELS = Object.freeze({ pending: 'À déclarer', declared: 'Déclarée', confirmed: 'Confirmée' });

  /**
   * Normalise un montant saisi : espaces (dont insécables/fines) de milliers ignorés, virgule ou point
   * décimal (≤ 2 chiffres). Retourne { ok, value } ou { ok:false, error }. 0 est un montant valide
   * (douane confirmée à zéro) ; vide/négatif/texte → refusé, jamais converti silencieusement en 0.
   */
  function parseAmountInput(raw) {
    const cleaned = String(raw == null ? '' : raw).replace(/[\s   ]/g, '');
    if (!cleaned) return { ok: false, error: 'Saisissez le montant de douane payé (0 si aucune douane n’est due).' };
    if (/^-/.test(cleaned)) return { ok: false, error: 'Le montant ne peut pas être négatif.' };
    if (!/^\d+([.,]\d{1,2})?$/.test(cleaned)) return { ok: false, error: 'Montant invalide : chiffres uniquement (ex. 6 000).' };
    const value = Number(cleaned.replace(',', '.'));
    if (!Number.isFinite(value) || value > 9999999999) return { ok: false, error: 'Montant hors limite.' };
    return { ok: true, value };
  }

  function statusLabel(status) {
    return STATUS_LABELS[status] || status || '—';
  }

  function closeCustomsForm(context) {
    if (context.customsForm && context.customsForm.element && context.customsForm.element.parentNode) {
      context.customsForm.element.parentNode.removeChild(context.customsForm.element);
    }
    context.customsForm = null;
  }

  /**
   * Formulaire de déclaration (statut pending) ou de correction (statut declared).
   * - saisie conservée pendant chargement, erreur et échec réseau ;
   * - ne se ferme qu'après réponse serveur OK ; double clic ignoré (verrou) ;
   * - réutilise POST …/declare et …/update (contrôles métier et ventilation A8 inchangés côté serveur).
   */
  function openCustomsForm(context, doc, host, row, mode) {
    if (context.customsForm && context.customsForm.submitting) return null;
    closeCustomsForm(context);
    const correcting = mode === 'correct';
    const form = doc.createElement('form');
    form.className = 'kmc-customs-form';
    form.setAttribute('data-customs-form', mode);
    form.setAttribute('role', 'group');
    form.setAttribute('aria-label', `${correcting ? 'Corriger' : 'Déclarer'} la douane de ${row.reference}`);
    form.noValidate = true;

    form.appendChild(text(doc, 'h3', 'kmc-customs-form-title', `${correcting ? 'Corriger la douane' : 'Déclarer la douane'} · ${row.reference}`));
    const facts = doc.createElement('dl');
    facts.className = 'kmc-customs-form-facts';
    const factRows = [['Référence', row.reference], ['Colis', row.linked_parcels == null ? '—' : String(row.linked_parcels)], ['Valeur CIF', formatKmf(row.cif_value_kmf)]];
    if (correcting) factRows.push(['Douane déclarée', formatKmf(row.customs_paid_kmf)], ['Statut', statusLabel(row.status)]);
    factRows.forEach(([label, value]) => {
      const box = doc.createElement('div');
      box.appendChild(text(doc, 'dt', '', label));
      box.appendChild(text(doc, 'dd', '', value));
      facts.appendChild(box);
    });
    form.appendChild(facts);

    const inputId = `kmc-customs-amount-${String(row.reference).replace(/[^A-Za-z0-9_-]/g, '_')}`;
    const label = text(doc, 'label', 'kmc-customs-form-label', correcting ? 'Nouveau montant de douane payé' : 'Montant de douane payé');
    label.setAttribute('for', inputId);
    form.appendChild(label);
    const group = doc.createElement('div');
    group.className = 'kmc-customs-input-group';
    const input = doc.createElement('input');
    input.type = 'text';
    input.id = inputId;
    input.name = 'customs_paid_kmf';
    input.setAttribute('inputmode', 'decimal');
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('data-customs-amount', '');
    input.setAttribute('aria-describedby', `${inputId}-hint`);
    if (correcting && row.customs_paid_kmf != null) input.value = formatNumber(row.customs_paid_kmf);
    group.appendChild(input);
    group.appendChild(text(doc, 'span', 'kmc-customs-unit', CURRENCY_LABEL));
    form.appendChild(group);
    const hint = text(doc, 'div', 'kmc-customs-form-hint', 'Saisir 0 si aucune douane n’est due (confirmé). Les espaces de milliers sont acceptés.');
    hint.id = `${inputId}-hint`;
    form.appendChild(hint);
    const preview = text(doc, 'div', 'kmc-customs-form-preview', '');
    preview.setAttribute('data-customs-preview', '');
    preview.setAttribute('aria-live', 'polite');
    form.appendChild(preview);

    let reasonInput = null;
    if (correcting) {
      const reasonLabel = text(doc, 'label', 'kmc-customs-form-label', 'Motif de la correction (journalisé, facultatif)');
      reasonLabel.setAttribute('for', `${inputId}-reason`);
      form.appendChild(reasonLabel);
      reasonInput = doc.createElement('input');
      reasonInput.type = 'text';
      reasonInput.id = `${inputId}-reason`;
      reasonInput.setAttribute('data-customs-reason', '');
      reasonInput.setAttribute('maxlength', '300');
      form.appendChild(reasonInput);
    }

    const error = text(doc, 'div', 'kmc-customs-form-error', '');
    error.setAttribute('role', 'alert');
    error.setAttribute('data-customs-error', '');
    form.appendChild(error);

    const buttons = doc.createElement('div');
    buttons.className = 'kmc-customs-form-actions';
    const cancel = text(doc, 'button', 'kmc-workspace-action is-secondary', 'Annuler');
    cancel.type = 'button';
    cancel.setAttribute('data-customs-cancel', '');
    const confirm = text(doc, 'button', 'kmc-workspace-action', correcting ? 'Confirmer la correction' : 'Confirmer la déclaration');
    confirm.type = 'submit';
    confirm.setAttribute('data-customs-confirm', '');
    buttons.appendChild(cancel);
    buttons.appendChild(confirm);
    form.appendChild(buttons);

    const state = { element: form, submitting: false };
    context.customsForm = state;

    const showError = message => { error.textContent = message || ''; input.setAttribute('aria-invalid', message ? 'true' : 'false'); };
    const refreshPreview = () => {
      const parsed = parseAmountInput(input.value);
      preview.textContent = parsed.ok ? `= ${formatNumber(parsed.value)} ${CURRENCY_LABEL}` : '';
    };
    const setBusy = busy => {
      state.submitting = busy;
      input.readOnly = busy;
      if (reasonInput) reasonInput.readOnly = busy;
      cancel.disabled = busy;
      confirm.disabled = busy;
      confirm.textContent = busy ? 'En cours…' : (correcting ? 'Confirmer la correction' : 'Confirmer la déclaration');
    };

    input.addEventListener('input', () => { showError(''); refreshPreview(); });
    cancel.addEventListener('click', () => { if (!state.submitting) closeCustomsForm(context); });
    form.addEventListener('keydown', event => { if (event.key === 'Escape' && !state.submitting) closeCustomsForm(context); });
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (state.submitting) return;
      const parsed = parseAmountInput(input.value);
      if (!parsed.ok) { showError(parsed.error); input.focus(); return; }
      if (correcting && row.customs_paid_kmf != null && Number(row.customs_paid_kmf) === parsed.value) {
        showError('Montant identique à la douane déjà déclarée : rien à corriger.');
        input.focus();
        return;
      }
      showError('');
      setBusy(true);
      setFeedback(context.root, correcting ? 'Correction en cours…' : 'Déclaration en cours…');
      const ref = encodeURIComponent(row.reference);
      const request = correcting
        ? { url: endpointFor(context.marketCode, `customs/shipments/${ref}/update`), body: { customs_paid_kmf: parsed.value, reason: (reasonInput && reasonInput.value.trim()) || undefined } }
        : { url: endpointFor(context.marketCode, `customs/shipments/${ref}/declare`), body: { customs_paid_kmf: parsed.value } };
      try {
        await jsonRequest(context.fetch, request.url, { method: 'POST', body: request.body });
      } catch (err) {
        setBusy(false);
        showError(err.message || 'Échec de l’enregistrement. Votre saisie est conservée : vous pouvez réessayer.');
        setFeedback(context.root, '');
        input.focus();
        return;
      }
      closeCustomsForm(context);
      context.highlightReference = row.reference;
      const okMessage = correcting
        ? `Douane corrigée pour ${row.reference} : ${formatKmf(parsed.value)}.`
        : `Douane déclarée pour ${row.reference} : ${formatKmf(parsed.value)}.`;
      setFeedback(context.root, okMessage, 'positive');
      try {
        await context.reload();
        setFeedback(context.root, okMessage, 'positive');
      } catch (reloadError) {
        setFeedback(context.root, `${okMessage} Actualisation impossible : rechargez la page pour revoir la liste.`, 'warning');
      }
    });

    host.appendChild(form);
    refreshPreview();
    input.focus();
    return form;
  }

  function renderCustoms(rootNode, ui, doc, payload, context) {
    const slot = createSection(
      rootNode,
      ui,
      'Douane · Expéditions',
      context.user && context.user.role === 'market_operator'
        ? 'Dossiers douane à suivre sur ce marché.'
        : 'Créer, déclarer ou mettre à jour les dossiers autorisés.'
    );

    if (context.user && context.user.role === 'admin') {
      const actions = doc.createElement('div');
      actions.className = 'kmc-workspace-section-actions';
      const create = makeButton(doc, 'Nouvelle expédition douane', 'create-customs');
      actions.appendChild(create);
      slot.appendChild(actions);
      create.addEventListener('click', async () => {
        const promptFn = context.prompt || (() => null);
        const reference = promptFn('Référence expédition douane');
        if (!reference) return;
        const shipmentDate = promptFn('Date expédition (YYYY-MM-DD)', new Date().toISOString().slice(0, 10));
        if (!shipmentDate) return;
        const cif = promptFn('Valeur CIF (KMF)');
        if (!cif) return;
        const suggested = candidateRefs(payload).join(',');
        const refsRaw = promptFn('Colis à rattacher (références séparées par des virgules)', suggested) || '';
        const parcelRefs = refsRaw.split(',').map(value => value.trim()).filter(Boolean);
        await runAction(context, create, {
          url: endpointFor(context.marketCode, 'customs/shipments'),
          body: { reference, shipment_date: shipmentDate, cif_value_kmf: Number(cif), parcel_refs: parcelRefs },
          successMessage: `Expédition douane ${reference} créée.`,
        });
      });
    }

    const formHost = doc.createElement('div');
    formHost.className = 'kmc-customs-form-host';
    formHost.setAttribute('data-customs-form-host', '');
    slot.appendChild(formHost);
    context.customsForm = null; // le rendu a remplacé le DOM : toute ancienne instance est caduque

    const rows = payload.customs.shipments || [];
    if (!rows.length) {
      slot.appendChild(text(doc, 'div', 'kmc-workspace-empty', 'Aucune expédition douane pour ce marché.'));
      return;
    }

    const table = doc.createElement('table');
    table.className = 'kmc-workspace-table';
    table.innerHTML = '<thead><tr><th>Référence</th><th>Date</th><th>Statut</th><th>Colis</th><th>CIF</th><th>Douane</th><th>État</th><th></th></tr></thead>';
    const tbody = doc.createElement('tbody');
    rows.forEach(row => {
      const tr = doc.createElement('tr');
      tr.setAttribute('data-shipment-ref', row.reference);
      tr.setAttribute('data-shipment-status', row.status || '');
      if (context.highlightReference && context.highlightReference === row.reference) {
        tr.className = 'is-highlighted';
        tr.setAttribute('aria-current', 'true');
      }
      [row.reference, String(row.shipment_date || '').slice(0, 10), statusLabel(row.status), row.linked_parcels, formatKmf(row.cif_value_kmf), formatKmf(row.customs_paid_kmf), row.is_active ? 'Active' : 'Inactive'].forEach(value => {
        const td = doc.createElement('td');
        td.textContent = value == null || value === '' ? '—' : String(value);
        tr.appendChild(td);
      });
      const td = doc.createElement('td');
      if (context.user && context.user.role === 'admin') {
        if (row.status === 'pending' && row.is_active) {
          const declare = makeButton(doc, 'Déclarer', 'declare-customs');
          declare.addEventListener('click', () => openCustomsForm(context, doc, formHost, row, 'declare'));
          td.appendChild(declare);
        }
        if (row.status === 'declared' && row.is_active) {
          const correct = makeButton(doc, 'Corriger', 'correct-customs');
          correct.classList.add('is-secondary');
          correct.addEventListener('click', () => openCustomsForm(context, doc, formHost, row, 'correct'));
          td.appendChild(correct);
        }
        const toggle = makeButton(doc, row.is_active ? 'Désactiver' : 'Réactiver', row.is_active ? 'deactivate-customs' : 'activate-customs');
        toggle.addEventListener('click', () => {
          const suffix = row.is_active ? 'deactivate' : 'activate';
          let body = {};
          if (!row.is_active) {
            const refsRaw = (context.prompt || (() => ''))('Colis à rattacher lors de la réactivation (références séparées par des virgules)', candidateRefs(payload).join(',')) || '';
            body = { parcel_refs: refsRaw.split(',').map(value => value.trim()).filter(Boolean) };
          }
          runAction(context, toggle, {
            url: endpointFor(context.marketCode, `customs/shipments/${encodeURIComponent(row.reference)}/${suffix}`),
            body,
            confirmMessage: `${row.is_active ? 'Désactiver' : 'Réactiver'} ${row.reference} ?`,
            successMessage: `${row.reference} mis à jour.`,
          });
        });
        td.appendChild(toggle);
      } else if (context.user && context.user.role === 'market_operator') {
        td.appendChild(text(doc, 'span', 'kmc-workspace-note', 'Pilotage pays'));
      }
      tr.appendChild(td);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    const wrap = doc.createElement('div');
    wrap.className = 'kmc-workspace-table-wrap';
    wrap.appendChild(table);
    slot.appendChild(wrap);
  }

  function renderHistory(rootNode, ui, doc, payload) {
    const slot = createSection(rootNode, ui, 'Historique transit', 'Événements transit_confirmed appliqués dans ce marché.');
    const rows = payload.transit.history || [];
    if (!rows.length) {
      slot.appendChild(text(doc, 'div', 'kmc-workspace-empty', 'Aucun transit confirmé récemment.'));
      return;
    }
    ui.DataTable.render(slot, {
      columns: [
        { key: 'created_at', label: 'Date', format: formatDate },
        { key: 'parcel_ref', label: 'Colis' },
        { key: 'order_ref', label: 'Commande' },
        { key: 'actor_name', label: 'Acteur' },
        { key: 'notes', label: 'Note' },
      ],
      rows,
      emptyText: 'Aucun événement.',
    });
  }

  function renderPayload(rootNode, ui, doc, payload, context) {
    rootNode.className = 'kmc-operations-workspace';
    rootNode.setAttribute('data-workspace-kind', 'shipping-customs');
    rootNode.replaceChildren();
    rootNode.appendChild(createHeader(doc, payload, context));
    // The three real-world stages share this ONE workspace and retain the
    // original customs/transit owners. No second technical dashboard.
    const panel = globalThis.KomerceInternationalJourneyPanel;
    if (panel && typeof panel.render === 'function') {
      panel.render(doc, rootNode, context, payload.international || [],
        payload.internationalDetail || null, payload.internationalError || null);
    } else {
      rootNode.appendChild(text(doc, 'p', 'kmc-workspace-empty',
        'Chaîne internationale indisponible : module visuel absent.'));
    }
    // Legacy parcel confirmation and customs declaration remain functional,
    // but only in the relevant stage, not as duplicate independent workspaces.
    if (context.journeyTab === 'transport') renderTransit(rootNode, ui, doc, payload, context);
    if (context.journeyTab === 'arrival') renderCustoms(rootNode, ui, doc, payload, context);
  }

  async function mount(options = {}) {
    const rootNode = options.root;
    const doc = options.document;
    const ui = options.ui;
    const fetchFn = options.fetch;
    if (!rootNode || !doc || !ui || typeof fetchFn !== 'function') {
      throw new Error('canonical_shipping_customs_workspace_dependencies_missing');
    }
    const resolved = options.contextContract.resolveMarketView(options.adminContext, options.requestedMarket);
    if (!resolved.marketCode) throw new Error('canonical_shipping_customs_workspace_market_required');

    const context = {
      root: rootNode,
      user: options.user || {},
      marketCode: resolved.marketCode,
      fetch: fetchFn,
      confirm: options.confirm || (typeof window !== 'undefined' ? window.confirm.bind(window) : () => true),
      prompt: options.prompt || (typeof window !== 'undefined' ? window.prompt.bind(window) : () => null),
      reload: null,
      journeyTab: 'transport',
      journeyRef: null,
    };
    context.reload = async () => {
      const payload = await jsonRequest(fetchFn, endpointFor(context.marketCode));
      // The new chain is additive. If migration is not yet installed, show a
      // visible error in the journey panel without breaking existing customs.
      try {
        const international = await jsonRequest(fetchFn, endpointFor(context.marketCode, 'international'));
        payload.international = Array.isArray(international.shipments) ? international.shipments : [];
        if (context.journeyRef && payload.international.some(r => r.reference === context.journeyRef)) {
          payload.internationalDetail = await jsonRequest(fetchFn,
            endpointFor(context.marketCode, 'international/' + encodeURIComponent(context.journeyRef)));
        } else {
          context.journeyRef = null;
        }
      } catch (err) {
        payload.internationalError = err.message;
        payload.international = [];
      }
      renderPayload(rootNode, ui, doc, payload, context);
      return payload;
    };
    return context.reload();
  }

  return Object.freeze({ endpointFor, metricItems, mount, _test: { candidateRefs, canConfirmTransit, parseAmountInput } });
});

/**
 * @komerce-arch
 * @role          canonical-finance-accounting-workspace-ui
 * @domain        admin-dashboard
 * @layer         ui-orchestration
 * @criticality   high
 * @inputs        server_resolved_admin_context, explicit_market_code, accounting_work_queue
 * @outputs       canonical_accounting_workspace_dom, authorized_cash_deposit_requests
 * @depends       canonical primitives, admin-context
 * @used-by       canonical admin entrypoint
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      workspace_acts_dashboard_observes, canonical_admin_no_legacy_imports, browser_never_supplies_market_id_authority
 * @impact-areas  admin-dashboard, payment, accounting
 * @version       2026-08
 */

'use strict';

(function initFinanceAccountingWorkspace(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.KomerceCanonicalFinanceAccountingWorkspace = api;
})(typeof globalThis !== 'undefined' ? globalThis : null, function createFinanceAccountingWorkspace() {
  const ENDPOINT_PREFIX = '/api/admin/workspaces/accounting/market/';
  const MARKET_CODE = /^[A-Z]{2}$/;

  function contextualHref(path, returnTo, label) {
    const nav = globalThis.KomerceCanonicalNavigation;
    return nav && typeof nav.withReturnTo === 'function'
      ? nav.withReturnTo(path, returnTo, label)
      : path;
  }

  function endpointFor(marketCode, suffix = '', filters = null) {
    const code = String(marketCode || '').trim().toUpperCase();
    if (!MARKET_CODE.test(code)) throw new Error('canonical_accounting_workspace_market_required');
    const tail = suffix ? '/' + String(suffix).replace(/^\/+/, '') : '';
    const query = filters
      ? '?' + new URLSearchParams({ from: filters.from, to: filters.to, hours: String(filters.hours) }).toString()
      : '';
    return ENDPOINT_PREFIX + encodeURIComponent(code) + tail + query;
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
    copy.appendChild(text(doc, 'span', 'kmc-workspace-kicker', 'COMPTABILITÉ'));
    copy.appendChild(text(doc, 'h1', 'kmc-workspace-title', 'Cash & dépôts'));
    copy.appendChild(text(
      doc,
      'p',
      'kmc-workspace-subtitle',
      `${payload.scope.code} · ${payload.scope.name} · voir les écarts et dépôts à traiter`
    ));
    header.appendChild(copy);
    const feedback = text(doc, 'div', 'kmc-workspace-feedback', '');
    feedback.setAttribute('data-workspace-feedback', '');
    feedback.setAttribute('role', 'status');
    header.appendChild(feedback);
    return header;
  }

  function createSection(rootNode, ui, title, description, sectionId = null) {
    const section = ui.Section.create({ title, description });
    if (sectionId) section.element.id = sectionId;
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
      { key: 'expected', label: 'Cash attendu', value: formatKmf(summary.expected_kmf), tone: 'neutral' },
      { key: 'collected', label: 'Cash collecté', value: formatKmf(summary.collected_kmf), tone: 'neutral' },
      { key: 'held', label: 'Détenu (non clôturé)', value: formatKmf(summary.held_kmf), tone: summary.held_kmf ? 'warning' : 'neutral' },
      { key: 'closed', label: 'Clôturé (réception finale contrôlée)', value: formatKmf(summary.closed_kmf), tone: 'positive' },
      { key: 'toact', label: 'Remises à traiter', value: formatNumber(summary.transfers_to_act), tone: summary.transfers_to_act ? 'warning' : 'neutral' },
      { key: 'over-ceiling', label: 'Détenteurs hors plafond', value: formatNumber(summary.holders_over_ceiling), tone: summary.holders_over_ceiling ? 'critical' : 'neutral' },
      { key: 'overdue', label: 'Détenteurs hors délai', value: formatNumber(summary.holders_overdue), tone: summary.holders_overdue ? 'critical' : 'neutral' },
      { key: 'legacy', label: 'Historique à régulariser', value: formatKmf(summary.legacy_to_regularize_kmf), tone: summary.legacy_to_regularize ? 'warning' : 'neutral' },
      { key: 'pending', label: 'Dépôts historiques à vérifier', value: formatNumber(summary.pending_deposits), tone: summary.pending_deposits ? 'warning' : 'neutral' },
      { key: 'missing', label: 'Non encaissé', value: formatKmf(summary.uncollected_kmf), tone: summary.uncollected_kmf ? 'critical' : 'neutral' },
    ];
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

  function filterControls(doc, payload, context) {
    const form = doc.createElement('div');
    form.className = 'kmc-workspace-section-actions kmc-accounting-hero-controls';

    const from = doc.createElement('input');
    from.type = 'date';
    from.value = payload.filters.from;
    from.setAttribute('aria-label', 'Début de période');

    const to = doc.createElement('input');
    to.type = 'date';
    to.value = payload.filters.to;
    to.setAttribute('aria-label', 'Fin de période');

    const hours = doc.createElement('select');
    hours.setAttribute('aria-label', 'Seuil non encaissé');
    [24, 48, 72, 168].forEach(value => {
      const option = doc.createElement('option');
      option.value = String(value);
      option.textContent = value === 168 ? '7 jours' : `${value} h`;
      if (Number(payload.filters.hours) === value) option.selected = true;
      hours.appendChild(option);
    });

    const apply = makeButton(doc, 'Appliquer', 'apply-accounting-filters');
    form.appendChild(from);
    form.appendChild(to);
    form.appendChild(hours);
    form.appendChild(apply);

    apply.addEventListener('click', async () => {
      context.filters = { from: from.value, to: to.value, hours: Number(hours.value) };
      await context.reload();
    });
    return form;
  }

  function renderReconciliation(rootNode, ui, doc, payload) {
    const r = payload.reconciliation || {};
    const slot = createSection(rootNode, ui, 'Rapprochement cash', 'Calculé dans le marché sélectionné, depuis l’autorité unique de garde : seul un transfert accepté décharge, seule une réception finale contrôlée par un acteur indépendant clôt, une perte est une décision centrale distincte.');
    ui.DataTable.render(slot, {
      columns: [
        { key: 'expected', label: 'Attendu' },
        { key: 'collected', label: 'Collecté' },
        { key: 'transferred', label: 'Transféré (accepté)' },
        { key: 'closed', label: 'Clôturé' },
        { key: 'lost', label: 'Perte décidée' },
        { key: 'held', label: 'Détenu maintenant' },
        { key: 'gap_collection', label: 'Écart collecte' },
        { key: 'gap_closure', label: 'Écart (collecté − clôturé − perte)' },
      ],
      rows: [{
        expected: formatKmf(r.expected_kmf),
        collected: formatKmf(r.collected_kmf),
        transferred: formatKmf(r.transferred_kmf),
        closed: formatKmf(r.closed_kmf),
        lost: formatKmf(r.lost_kmf),
        held: formatKmf(r.held_kmf),
        gap_collection: formatKmf(r.gap_collection_kmf),
        gap_closure: formatKmf(r.gap_closure_kmf),
      }],
      emptyText: 'Aucune donnée de rapprochement.',
    });
  }

  function pickOne(context, label, options) {
    if (!options.length) return null;
    const lines = options.map((option, index) => `${index + 1}. ${option.label}`).join('\n');
    const answer = (context.prompt || (() => null))(`${label}\n${lines}`, '1');
    const index = Number(answer) - 1;
    return Number.isInteger(index) && options[index] ? options[index] : null;
  }

  function renderDepositCreation(rootNode, ui, doc, payload, context) {
    const user = context.user || {};
    const custody = payload.custody || {};
    const isHolder = (custody.holders || []).some(row => String(row.holder_id) === String(user.id));
    const isRecipient = (custody.recipients || []).some(row => String(row.user_id) === String(user.id));
    if (user.role !== 'agent_relais' && !isHolder && !isRecipient) return;
    const slot = createSection(rootNode, ui, 'Remettre des espèces', 'Le remettant est la session authentifiée. La déclaration ne décharge personne : la garde ne change qu’à l’acceptation du destinataire ; seule une réception finale prouvée et contrôlée clôt.');
    const button = makeButton(doc, 'Déclarer une remise', 'create-cash-deposit');
    slot.appendChild(button);
    button.addEventListener('click', async () => {
      const recipients = (custody.recipients || []).filter(row => String(row.user_id) !== String(user.id))
        .map(row => ({ label: `${row.full_name} (personne habilitée)`, body: { recipient_user_id: row.user_id } }));
      const destinations = (custody.destinations || []).filter(row => row.status === 'ACTIVE')
        .map(row => ({ label: `${row.label} · ${DESTINATION_KIND_LABELS[row.kind] || row.kind} (destination finale, ${row.currency})`, body: { destination_id: row.id }, currency: row.currency }));
      const target = pickOne(context, 'À qui remettre ? (numéro)', [...recipients, ...destinations]);
      if (!target) return;
      const defaultCurrency = target.currency || 'XAF';
      const currency = (context.prompt('Devise du montant', defaultCurrency) || '').trim().toUpperCase();
      if (!currency) return;
      const amount = context.prompt(`Montant annoncé (${currency})`);
      if (!amount) return;
      const reference = context.prompt('Référence du reçu / de la transaction (optionnel)', '') || '';
      const legacyRef = context.prompt('Remise historique à régulariser (référence, optionnel)', '') || '';
      await runAction(context, button, {
        url: endpointFor(context.marketCode, 'deposits'),
        body: {
          ...target.body,
          declared_amount: Number(amount),
          declared_currency: currency,
          reference: reference || undefined,
          regularizes_deposit_ref: legacyRef || undefined,
        },
        confirmMessage: `Annoncer ${amount} ${currency} ? La garde ne change qu’à l’acceptation.`,
        successMessage: 'Remise annoncée : en attente de la réponse du destinataire.',
      });
    });
  }

  function renderDeposits(rootNode, ui, doc, payload, context) {
    const slot = createSection(rootNode, ui, 'Remises historiques', 'Anciennes remises vérifiées avant la garde canonique : elles ne déchargent pas l’agent et restent à régulariser par un transfert accepté avec preuve.', 'accounting-deposits');
    const rows = payload.deposits || [];
    if (!rows.length) {
      slot.appendChild(text(doc, 'div', 'kmc-workspace-empty', 'Aucun dépôt rattaché à ce marché.'));
      return;
    }
    const table = doc.createElement('table');
    table.className = 'kmc-workspace-table';
    table.innerHTML = '<thead><tr><th>Dépôt</th><th>Relais</th><th>Agent</th><th>Montant</th><th>Méthode</th><th>Période</th><th>Statut</th><th>Déposé</th><th></th></tr></thead>';
    const tbody = doc.createElement('tbody');
    rows.forEach(row => {
      const tr = doc.createElement('tr');
      [
        row.deposit_ref,
        row.relais_name,
        row.agent_name,
        formatKmf(row.amount_kmf),
        row.deposit_method,
        `${String(row.period_start || '').slice(0, 10)} → ${String(row.period_end || '').slice(0, 10)}`,
        row.status,
        formatDate(row.deposited_at),
      ].forEach(value => {
        const td = doc.createElement('td');
        td.textContent = value || '—';
        tr.appendChild(td);
      });
      const actionCell = doc.createElement('td');
      // Le serveur reste l'autorité (finance.act sur le Market) : l'UI n'affiche que les gestes de revue possibles.
      if (context.user && (context.user.role === 'admin' || context.user.role === 'market_operator')) {
        if (row.status !== 'verified') {
          const verify = makeButton(doc, 'Vérifier', 'verify-cash-deposit');
          verify.addEventListener('click', () => runAction(context, verify, {
            url: endpointFor(context.marketCode, `deposits/${encodeURIComponent(row.deposit_ref)}/verify`),
            body: {},
            confirmMessage: `Valider le dépôt ${row.deposit_ref} ?`,
            successMessage: `${row.deposit_ref} vérifié.`,
          }));
          actionCell.appendChild(verify);
        }
        if (row.status === 'pending') {
          const dispute = makeButton(doc, 'Contester', 'dispute-cash-deposit');
          dispute.addEventListener('click', () => {
            const reason = (context.prompt || (() => null))(`Raison de la contestation pour ${row.deposit_ref}`);
            if (!reason) return;
            runAction(context, dispute, {
              url: endpointFor(context.marketCode, `deposits/${encodeURIComponent(row.deposit_ref)}/dispute`),
              body: { reason },
              confirmMessage: `Contester le dépôt ${row.deposit_ref} ?`,
              successMessage: `${row.deposit_ref} contesté.`,
            });
          });
          actionCell.appendChild(dispute);
        }
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

  const DESTINATION_KIND_LABELS = { BANK: 'Banque', MOBILE_MONEY: 'Mobile Money' };
  const DESTINATION_STATUS_LABELS = { PROPOSED: 'À activer (second acteur)', ACTIVE: 'Active', SUSPENDED: 'Suspendue', CLOSED: 'Clôturée' };

  const STATE_LABELS = {
    DECLARED: 'Annoncée — en attente du destinataire',
    ACCEPTED: 'Acceptée (intermédiaire : non clôturée)',
    ACCEPTED_PARTIAL: 'Acceptée partiellement — écart ouvert',
    REFUSED: 'Refusée',
    AWAITING_PROOF: 'Preuve de réception finale manquante',
    TO_CONTROL: 'Réception prouvée — contrôle indépendant à faire',
    CLOSED: 'Clôturée (réception finale contrôlée)',
    CONTROL_REJECTED: 'Contrôle négatif — rien de clôturé',
  };

  function transferActions(doc, context, row) {
    const cell = doc.createElement('td');
    const user = context.user || {};
    const act = (label, action, suffix, body, confirmMessage, successMessage) => {
      const button = makeButton(doc, label, action);
      button.addEventListener('click', () => runAction(context, button, {
        url: endpointFor(context.marketCode, `custody/${encodeURIComponent(row.deposit_ref)}/${suffix}`),
        body, confirmMessage, successMessage,
      }));
      cell.appendChild(button);
    };
    const prompt = context.prompt || (() => null);
    const canReceive = row.state === 'DECLARED' && String(row.recipient_user_id) === String(user.id);
    const canProve = row.state === 'AWAITING_PROOF' && String(row.remitter_id) !== String(user.id);
    if (canReceive || canProve) {
      const receive = makeButton(doc, 'Enregistrer la réception', 'record-custody-receipt');
      receive.addEventListener('click', () => {
        const amount = prompt(`Montant réellement reçu (${row.declared_currency}) — annoncé : ${row.declared_amount}`, row.declared_amount);
        if (!amount) return;
        const proof = row.movement_kind === 'FINAL' ? prompt('Référence de la preuve (relevé, reçu bancaire, transaction)') : (prompt('Référence du reçu (optionnel)', '') || undefined);
        if (row.movement_kind === 'FINAL' && !proof) return;
        runAction(context, receive, {
          url: endpointFor(context.marketCode, `custody/${encodeURIComponent(row.deposit_ref)}/receipt`),
          body: { outcome: 'received', received_amount: Number(amount), proof_ref: proof },
          confirmMessage: `Confirmer avoir reçu ${amount} ${row.declared_currency} ? La responsabilité vous est transférée à hauteur du montant reçu.`,
          successMessage: 'Réception enregistrée.',
        });
      });
      cell.appendChild(receive);
      const refuse = makeButton(doc, 'Refuser', 'refuse-custody-receipt');
      refuse.addEventListener('click', () => {
        const reason = prompt(`Motif du refus pour ${row.deposit_ref}`);
        if (!reason) return;
        runAction(context, refuse, {
          url: endpointFor(context.marketCode, `custody/${encodeURIComponent(row.deposit_ref)}/receipt`),
          body: { outcome: 'refused', reason },
          confirmMessage: `Refuser la remise ${row.deposit_ref} ?`,
          successMessage: 'Remise refusée : la garde reste au remettant.',
        });
      });
      cell.appendChild(refuse);
    }
    if (row.state === 'TO_CONTROL' && (user.role === 'admin' || user.role === 'market_operator')
        && String(row.remitter_id) !== String(user.id) && String(row.received_by) !== String(user.id)) {
      const control = makeButton(doc, 'Contrôler et clôturer', 'control-final-reception');
      control.addEventListener('click', () => {
        const amount = prompt(`Montant contrôlé en KMF (reçu : ${row.received_net_kmf}) — 0 pour rejeter`, row.received_net_kmf);
        if (amount == null || amount === '') return;
        const reason = Number(amount) > 0 ? undefined : prompt('Motif du rejet');
        if (Number(amount) <= 0 && !reason) return;
        runAction(context, control, {
          url: endpointFor(context.marketCode, `custody/${encodeURIComponent(row.deposit_ref)}/control`),
          body: { controlled_kmf: Number(amount), reason },
          confirmMessage: `Clôturer ${amount} KMF pour ${row.deposit_ref} ?`,
          successMessage: Number(amount) > 0 ? 'Réception finale contrôlée : circuit clôturé.' : 'Contrôle négatif enregistré.',
        });
      });
      cell.appendChild(control);
    }
    return cell;
  }

  function renderTransfers(slot, doc, context, rows) {
    if (!rows.length) {
      slot.appendChild(text(doc, 'div', 'kmc-workspace-empty', 'Aucune remise de garde sur ce marché.'));
      return;
    }
    const table = doc.createElement('table');
    table.className = 'kmc-workspace-table';
    table.innerHTML = '<thead><tr><th>Remise</th><th>De</th><th>Vers</th><th>Annoncé</th><th>Reçu</th><th>Écart</th><th>Contrôlé</th><th>Preuve</th><th>État</th><th></th></tr></thead>';
    const tbody = doc.createElement('tbody');
    rows.forEach(row => {
      const tr = doc.createElement('tr');
      [
        row.deposit_ref + (row.regularizes_ref ? ` (régularise ${row.regularizes_ref})` : ''),
        row.remitter_name,
        row.recipient_name || `${row.destination_label} · destination finale`,
        `${formatNumber(row.declared_amount)} ${row.declared_currency} = ${formatKmf(row.amount_kmf)}`,
        row.received_net_kmf == null ? '—' : `${formatKmf(row.received_net_kmf)}${row.received_by_name ? ` (${row.received_by_name})` : ''}`,
        row.discrepancy_kmf ? formatKmf(row.discrepancy_kmf) : '—',
        row.controlled_net_kmf == null ? '—' : `${formatKmf(row.controlled_net_kmf)}${row.controlled_by_name ? ` (${row.controlled_by_name})` : ''}`,
        row.proof_ref || '—',
        STATE_LABELS[row.state] || row.state,
      ].forEach(value => {
        const td = doc.createElement('td');
        td.textContent = value || '—';
        tr.appendChild(td);
      });
      tr.appendChild(transferActions(doc, context, row));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    const wrap = doc.createElement('div');
    wrap.className = 'kmc-workspace-table-wrap';
    wrap.appendChild(table);
    slot.appendChild(wrap);
  }

  function renderCustody(rootNode, ui, doc, payload, context = {}) {
    const custody = payload.custody || {};
    const limits = custody.limits || {};
    // DataTable.render vide son conteneur : un sous-conteneur par tableau, sinon seul le dernier survit.
    const slot = createSection(rootNode, ui, 'Garde des espèces',
      `Qui détient l’argent, depuis quand, à qui le remettre. Délai de garde : ${limits.market_max_days || '—'} jour(s) ; plafond central : ${formatKmf(limits.max_holding_kmf)}. Une déclaration ne transfère rien ; aucun transfert intermédiaire ne clôture.`, 'accounting-custody');
    const part = () => { const node = doc.createElement('div'); slot.appendChild(node); return node; };
    ui.DataTable.render(part(), {
      columns: [
        { key: 'full_name', label: 'Détenteur' },
        { key: 'balance_kmf', label: 'Détient', format: formatKmf },
        { key: 'since', label: 'Depuis', format: formatDate },
        { key: 'held_days', label: 'Jours' },
        { key: 'ceiling_kmf', label: 'Plafond', format: formatKmf },
        { key: 'flags', label: 'Alerte' },
      ],
      rows: (custody.holders || []).map(row => ({
        ...row,
        flags: [row.over_ceiling ? 'Plafond dépassé' : null, row.overdue ? `Délai dépassé (${row.max_days} j)` : null].filter(Boolean).join(' · ') || '—',
      })),
      emptyText: 'Personne ne détient d’espèces non clôturées.',
    });
    renderTransfers(slot, doc, context, custody.transfers || []);
    if (context.user && context.user.role === 'admin' && (custody.holders || []).length) {
      const loss = makeButton(doc, 'Décider une perte (décision centrale)', 'decide-custody-loss');
      loss.addEventListener('click', async () => {
        const holder = pickOne(context, 'Détenteur concerné ? (numéro)', custody.holders.map(row => ({ label: `${row.full_name} — ${formatKmf(row.balance_kmf)}`, id: row.holder_id })));
        if (!holder) return;
        const amount = context.prompt('Montant de la perte (KMF)');
        if (!amount) return;
        const reason = context.prompt('Motif détaillé (10 caractères minimum) — décision tracée');
        if (!reason) return;
        await runAction(context, loss, {
          url: endpointFor(context.marketCode, 'custody/losses'),
          body: { holder_id: holder.id, amount_kmf: Number(amount), reason },
          confirmMessage: `Constater ${amount} KMF de perte pour ${holder.label} ? Décision centrale, distincte des montants reçus.`,
          successMessage: 'Perte décidée et tracée.',
        });
      });
      slot.appendChild(loss);
    }
    ui.DataTable.render(part(), {
      columns: [
        { key: 'deposit_ref', label: 'Remise historique vérifiée' },
        { key: 'agent_name', label: 'Agent' },
        { key: 'remaining_kmf', label: 'Reste à régulariser', format: formatKmf },
        { key: 'verified_at', label: 'Vérifiée le', format: formatDate },
      ],
      rows: custody.legacy_to_regularize || [],
      emptyText: 'Aucune remise historique à régulariser.',
    });
    ui.DataTable.render(part(), {
      columns: [
        { key: 'full_name', label: 'Personne habilitée' },
        { key: 'role', label: 'Rôle' },
        { key: 'holding_limit_kmf', label: 'Plafond de détention', format: formatKmf },
      ],
      rows: custody.recipients || [],
      emptyText: 'Aucune personne habilitée à recevoir des fonds : aucune remise ne peut être acceptée.',
    });
    ui.DataTable.render(part(), {
      columns: [
        { key: 'label', label: 'Destination finale' },
        { key: 'kind', label: 'Type', format: value => DESTINATION_KIND_LABELS[value] || value },
        { key: 'currency', label: 'Devise' },
        { key: 'status', label: 'État', format: value => DESTINATION_STATUS_LABELS[value] || value },
      ],
      rows: custody.destinations || [],
      emptyText: 'Aucune destination finale activée : aucune clôture n\'est possible.',
    });
  }

  function renderUncollected(rootNode, ui, doc, payload) {
    const slot = createSection(rootNode, ui, 'Cash non encaissé', 'Commandes cash qui dépassent le délai sélectionné.', 'accounting-uncollected');
    const rows = payload.uncollected || [];
    if (!rows.length) {
      slot.appendChild(text(doc, 'div', 'kmc-workspace-empty', 'Aucune commande cash en anomalie.'));
      return;
    }
    const table = doc.createElement('table');
    table.className = 'kmc-workspace-table';
    table.innerHTML = '<thead><tr><th>Commande</th><th>Client</th><th>Relais</th><th>Montant</th><th>Statut</th><th>Depuis</th></tr></thead>';
    const tbody = doc.createElement('tbody');
    rows.forEach(row => {
      const tr = doc.createElement('tr');
      const orderCell = doc.createElement('td');
      const link = text(doc, 'a', 'kmc-workspace-link', row.order_ref);
      link.setAttribute('href', contextualHref(`/admin/orders/${encodeURIComponent(row.order_ref)}`, '/admin/workspaces/accounting', 'Retour à la comptabilité'));
      orderCell.appendChild(link);
      tr.appendChild(orderCell);
      [row.client_name, row.relais_name, formatKmf(row.total_kmf), row.status, formatDate(row.created_at)].forEach(value => {
        const td = doc.createElement('td');
        td.textContent = value || '—';
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    const wrap = doc.createElement('div');
    wrap.className = 'kmc-workspace-table-wrap';
    wrap.appendChild(table);
    slot.appendChild(wrap);
  }

  function renderCollections(rootNode, ui, doc, payload) {
    const slot = createSection(rootNode, ui, 'Encaissements récents', 'Traçabilité des cash_collections du marché et de la période.');
    ui.DataTable.render(slot, {
      columns: [
        { key: 'confirmed_at', label: 'Date', format: formatDate },
        { key: 'order_ref', label: 'Commande' },
        { key: 'relais_name', label: 'Relais' },
        { key: 'agent_name', label: 'Agent' },
        { key: 'amount_kmf', label: 'Montant', format: formatKmf },
      ],
      rows: payload.collections || [],
      emptyText: 'Aucun encaissement sur la période.',
    });
  }

  function renderInvoices(rootNode, ui, doc, payload) {
    const slot = createSection(rootNode, ui, 'Factures émises', 'Les factures sont des snapshots immuables : 4D les observe et renvoie vers Order 360, sans les éditer.');
    const rows = payload.invoices || [];
    if (!rows.length) {
      slot.appendChild(text(doc, 'div', 'kmc-workspace-empty', 'Aucune facture pour ce marché.'));
      return;
    }
    const table = doc.createElement('table');
    table.className = 'kmc-workspace-table';
    table.innerHTML = '<thead><tr><th>Facture</th><th>Commande</th><th>Montant</th><th>Paiement</th><th>Statut</th><th>Émise</th><th>PDF</th></tr></thead>';
    const tbody = doc.createElement('tbody');
    rows.forEach(row => {
      const tr = doc.createElement('tr');
      const invoiceCell = doc.createElement('td');
      invoiceCell.textContent = row.invoice_number || '—';
      tr.appendChild(invoiceCell);
      const orderCell = doc.createElement('td');
      const link = text(doc, 'a', 'kmc-workspace-link', row.order_ref);
      link.setAttribute('href', contextualHref(`/admin/orders/${encodeURIComponent(row.order_ref)}`, '/admin/workspaces/accounting', 'Retour à la comptabilité'));
      orderCell.appendChild(link);
      tr.appendChild(orderCell);
      const amount = row.payment_mode === 'stripe_eur' || row.payment_mode === 'paypal_eur'
        ? `${Number(row.total_eur || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €`
        : formatKmf(row.total_kmf);
      [amount, row.payment_mode, row.payment_status, formatDate(row.created_at), row.pdf_generated_at ? 'Disponible' : 'En attente'].forEach(value => {
        const td = doc.createElement('td');
        td.textContent = value || '—';
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    const wrap = doc.createElement('div');
    wrap.className = 'kmc-workspace-table-wrap';
    wrap.appendChild(table);
    slot.appendChild(wrap);
  }

  function renderPayload(rootNode, ui, doc, payload, context) {
    rootNode.className = 'kmc-operations-workspace';
    rootNode.setAttribute('data-workspace-kind', 'accounting');
    rootNode.replaceChildren();
    rootNode.appendChild(createHeader(doc, payload, context));
    // UX-04 : le filtre de période n'est plus dans le Hero, il ouvre la première section.
    createSection(rootNode, ui, 'Période', 'Dates et seuil de cash non encaissé appliqués à toute la page.')
      .appendChild(filterControls(doc, payload, context));
    const metrics = doc.createElement('section');
    metrics.className = 'kmc-workspace-metrics';
    rootNode.appendChild(metrics);
    ui.MetricStrip.render(metrics, { items: metricItems(payload.summary) });
    renderReconciliation(rootNode, ui, doc, payload);
    renderDepositCreation(rootNode, ui, doc, payload, context);
    renderDeposits(rootNode, ui, doc, payload, context);
    renderCustody(rootNode, ui, doc, payload, context);
    renderUncollected(rootNode, ui, doc, payload);
  }

  async function mount(options = {}) {
    const rootNode = options.root;
    const doc = options.document;
    const ui = options.ui;
    const fetchFn = options.fetch;
    if (!rootNode || !doc || !ui || typeof fetchFn !== 'function') {
      throw new Error('canonical_accounting_workspace_dependencies_missing');
    }
    const resolved = options.contextContract.resolveMarketView(options.adminContext, options.requestedMarket);
    if (!resolved.marketCode) throw new Error('canonical_accounting_workspace_market_required');

    const now = new Date();
    const context = {
      root: rootNode,
      user: options.user || {},
      marketCode: resolved.marketCode,
      fetch: fetchFn,
      confirm: options.confirm || (typeof window !== 'undefined' ? window.confirm.bind(window) : () => true),
      prompt: options.prompt || (typeof window !== 'undefined' ? window.prompt.bind(window) : () => null),
      filters: {
        from: new Date(now.getTime() - 7 * 86400000).toISOString().slice(0, 10),
        to: now.toISOString().slice(0, 10),
        hours: 48,
      },
      reload: null,
    };
    context.reload = async () => {
      const payload = await jsonRequest(fetchFn, endpointFor(context.marketCode, '', context.filters));
      context.filters = payload.filters || context.filters;
      renderPayload(rootNode, ui, doc, payload, context);
      return payload;
    };
    return context.reload();
  }

  return Object.freeze({ endpointFor, metricItems, mount });
});

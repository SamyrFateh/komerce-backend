/**
 * @komerce-arch
 * @role          canonical-finance-journal-workspace-ui
 * @domain        admin-dashboard
 * @layer         ui-orchestration
 * @criticality   high
 * @inputs        authenticated_accounting_operator, server_admin_context, financial_journal_projection
 * @outputs       canonical_accounting_journal_dom
 * @depends       /api/admin/workspaces/accounting/market/:marketCode/journal/*, finance-accounting-workspace
 * @used-by       canonical admin entrypoint
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      server_scope_is_authority, projection_only_no_business_recompute, eur_never_invented, not_double_entry
 * @impact-areas  admin-dashboard, accounting, finance
 * @version       2026-11
 *
 * Comptabilité : Synthèse | Journal | Rapprochements | Pièces justificatives (+ « Cash & dépôts » en transition vers Relais live).
 * Tout vient de la projection serveur du journal ; aucune règle financière n'est recalculée ici.
 */
'use strict';

(function initFinanceJournalWorkspace(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.KomerceCanonicalFinanceJournalWorkspace = api;
})(typeof globalThis !== 'undefined' ? globalThis : null, function createFinanceJournalWorkspace() {
  const PREFIX = '/api/admin/workspaces/accounting/market/';
  const MARKET_CODE = /^[A-Z]{2}$/;
  const TABS = Object.freeze([
    { id: 'summary', label: 'Synthèse' },
    { id: 'movements', label: 'Journal' },
    { id: 'reconciliation', label: 'Rapprochements' },
    { id: 'documents', label: 'Pièces justificatives' },
    { id: 'cash', label: 'Cash & dépôts' },
  ]);

  function text(doc, tag, className, value) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    node.textContent = value == null ? '' : String(value);
    return node;
  }

  function endpointFor(marketCode, view, filters = {}) {
    const code = String(marketCode || '').trim().toUpperCase();
    if (!MARKET_CODE.test(code)) throw new Error('canonical_accounting_journal_market_required');
    const query = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => { if (value) query.set(key, value); });
    const suffix = query.toString();
    return `${PREFIX}${encodeURIComponent(code)}/journal/${view}${suffix ? `?${suffix}` : ''}`;
  }

  async function getJson(fetchFn, url) {
    const response = await fetchFn(url, { method: 'GET', credentials: 'include', headers: { Accept: 'application/json' } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `Erreur HTTP ${response.status}`);
    return body;
  }

  const money = (value, currency) => `${new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value) || 0)} ${currency}`;
  const day = value => (value ? String(value).slice(0, 10) : '—');

  function table(doc, headers, rows, emptyMessage) {
    if (!rows.length) return text(doc, 'p', 'kmc-workspace-empty', emptyMessage);
    const wrap = doc.createElement('div');
    wrap.style.overflowX = 'auto';
    wrap.style.maxWidth = '100%';
    wrap.style.minWidth = '0';
    const node = doc.createElement('table');
    node.className = 'kmc-com-table';
    const head = doc.createElement('tr');
    headers.forEach(label => head.appendChild(text(doc, 'th', '', label)));
    const thead = doc.createElement('thead');
    thead.appendChild(head);
    node.appendChild(thead);
    const body = doc.createElement('tbody');
    rows.forEach(cells => {
      const tr = doc.createElement('tr');
      cells.forEach(cell => tr.appendChild(text(doc, 'td', '', cell)));
      body.appendChild(tr);
    });
    node.appendChild(body);
    wrap.appendChild(node);
    return wrap;
  }

  const nativeText = list => (list || []).map(item => money(item.total != null ? item.total : item.remaining_native, item.currency)).join(' · ');
  const eurBanner = (doc, eurComplete, count) => (eurComplete ? null : text(doc, 'p', 'kmc-workspace-note kmc-journal-eur-warning',
    `${count} mouvement(s) sans conversion EUR (taux indisponible) : totaux EUR partiels, jamais estimés.`));

  const RENDERERS = {
    summary(doc, host, data) {
      if (data.journal_empty) { host.appendChild(text(doc, 'p', 'kmc-workspace-empty', 'Le journal est vide : la projection est périodique, aucune donnée inventée.')); return; }
      const warning = eurBanner(doc, data.eur_complete, data.eur_unavailable_movements);
      if (warning) host.appendChild(warning);
      host.appendChild(table(doc, ['Mouvement', 'État', 'Nb', 'Montant EUR', 'Montants natifs'],
        data.lines.map(line => [line.label, line.state_label, line.movements,
          line.eur_unavailable > 0 && line.eur_total === 0 ? '—' : money(line.eur_total, '€'), nativeText(line.native)]),
        'Aucun mouvement sur la période.'));
      const remaining = data.supplier_remaining_native || [];
      host.appendChild(text(doc, 'p', 'kmc-workspace-note', remaining.length
        ? `Restant à décaisser fournisseurs (natif, jamais additionné entre devises) : ${nativeText(remaining)}.`
        : 'Aucun restant à décaisser fournisseur sur la période.'));
      host.appendChild(text(doc, 'p', 'kmc-workspace-note', 'Journal de mouvements, pas une comptabilité en partie double.'));
    },
    movements(doc, host, data) {
      host.appendChild(table(doc, ['Date', 'Mouvement', 'Réf.', 'État', 'Natif', 'EUR', 'Pièces'],
        data.rows.map(row => [day(row.occurred_at), row.label, row.reference || '—', row.state_label,
          money(row.amount_native, row.currency), row.amount_eur == null ? '—' : money(row.amount_eur, '€'), row.documents]),
        'Aucun mouvement sur la période.'));
      host.appendChild(text(doc, 'p', 'kmc-workspace-note', `${data.rows.length} sur ${data.total} mouvement(s).`));
    },
    reconciliation(doc, host, data) {
      host.appendChild(text(doc, 'p', `kmc-workspace-note ${data.ok ? 'is-ok' : 'is-ko'}`,
        data.ok ? 'Journal réconcilié avec les sources métier.' : 'Écarts détectés entre le journal et les sources : à traiter avant toute validation.'));
      host.appendChild(table(doc, ['Contrôle', 'Journal', 'Source', 'Résultat'],
        data.checks.map(check => [check.label, check.journal, check.source, check.ok ? 'Conforme' : 'ÉCART']), 'Aucun contrôle.'));
    },
    documents(doc, host, data) {
      host.appendChild(table(doc, ['Date', 'Mouvement', 'Pièce', 'Référence', 'Montant natif'],
        data.documents.map(row => [day(row.occurred_at), row.label, row.doc_kind, row.doc_ref, money(row.amount_native, row.currency)]),
        'Aucune pièce rattachée sur la période.'));
      host.appendChild(text(doc, 'h3', 'kmc-workspace-subtitle', `Décaissements réglés sans pièce (${data.missing_documents.length})`));
      host.appendChild(table(doc, ['Date', 'Mouvement', 'Réf.', 'Montant natif'],
        data.missing_documents.map(row => [day(row.occurred_at), row.label, row.reference || '—', money(row.amount_native, row.currency)]),
        'Aucun décaissement réglé sans pièce.'));
    },
  };

  async function mount(options = {}) {
    const rootNode = options.root;
    const doc = options.document;
    const ui = options.ui;
    const fetchFn = options.fetch;
    if (!rootNode || !doc || !ui || typeof fetchFn !== 'function') throw new Error('canonical_accounting_journal_dependencies_missing');
    const resolved = options.contextContract.resolveMarketView(options.adminContext, options.requestedMarket);
    if (!resolved.marketCode) throw new Error('canonical_accounting_journal_market_required');
    const marketCode = resolved.marketCode;
    const now = new Date();
    const state = { tab: 'summary', from: new Date(now.getTime() - 30 * 86400000).toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) };

    rootNode.className = 'kmc-operations-workspace';
    rootNode.setAttribute('data-workspace-kind', 'accounting-journal');
    rootNode.replaceChildren();
    const header = doc.createElement('header');
    header.className = 'kmc-workspace-header';
    header.setAttribute('data-dashboard-role', 'hero');
    const copy = doc.createElement('div');
    copy.appendChild(text(doc, 'span', 'kmc-workspace-kicker', 'COMPTABILITÉ'));
    copy.appendChild(text(doc, 'h1', 'kmc-workspace-title', 'Journal financier'));
    copy.appendChild(text(doc, 'p', 'kmc-workspace-subtitle', `${marketCode} · mouvements, rapprochements et pièces — natif conservé, pivot EUR`));
    header.appendChild(copy);
    rootNode.appendChild(header);

    const tabs = doc.createElement('div');
    tabs.className = 'kmc-workspace-tabs';
    tabs.setAttribute('role', 'tablist');
    rootNode.appendChild(tabs);
    const content = doc.createElement('div');
    content.setAttribute('data-journal-content', '');
    content.style.minWidth = '0';
    content.style.maxWidth = '100%';
    rootNode.appendChild(content);

    function drawTabs() {
      tabs.replaceChildren();
      TABS.forEach(item => {
        const button = text(doc, 'button', `kmc-workspace-tab${item.id === state.tab ? ' is-active' : ''}`, item.label);
        button.type = 'button';
        button.setAttribute('role', 'tab');
        button.setAttribute('aria-selected', item.id === state.tab ? 'true' : 'false');
        button.setAttribute('data-journal-tab', item.id);
        button.addEventListener('click', () => { state.tab = item.id; load(); });
        tabs.appendChild(button);
      });
    }

    async function load() {
      drawTabs();
      content.replaceChildren();
      if (state.tab === 'cash') {
        const cash = globalThis.KomerceCanonicalFinanceAccountingWorkspace;
        if (!cash) { content.appendChild(text(doc, 'p', 'kmc-workspace-note', 'Module Cash & dépôts indisponible.')); return; }
        content.appendChild(text(doc, 'p', 'kmc-workspace-note', 'Transition : l’exécution cash & dépôts vit dans Relais live ; cette vue reste la projection comptable.'));
        const host = doc.createElement('div');
        content.appendChild(host);
        await cash.mount({ ...options, root: host }).catch(error => host.appendChild(text(doc, 'p', 'kmc-workspace-note', error.message)));
        return;
      }
      ui.UIState.render(content, 'loading', 'Chargement…');
      try {
        const data = await getJson(fetchFn, endpointFor(marketCode, state.tab, { from: state.from, to: state.to }));
        content.replaceChildren();
        RENDERERS[state.tab](doc, content, data);
      } catch (error) {
        ui.UIState.render(content, 'error', error.message);
      }
    }
    await load();
    return { reload: load };
  }

  return Object.freeze({ endpointFor, mount, TABS });
});

/**
 * KOMERCE Dashboard — Vue Factures /admin/invoices
 * ════════════════════════════════════════════════════════════════════════
 * Questions : Factures en cours ? Rapprochement cash ? Impayés livraison ?
 *
 * Sources API :
 *   KmcApi.getInvoices(params)           → /api/invoices
 *   KmcApi.getCashReconciliation(params) → /api/cash/reconciliation
 *   KmcApi.getCashUncollected(params)    → /api/cash/uncollected
 *   KmcApi.getEconomicCharges()          → /api/admin/economic/charges
 */

(function (global) {
  'use strict';

  async function render(rootEl) {
    const filters = KmcFilters.get();

    rootEl.innerHTML = `
      <h1 class="page-title">Factures & Comptabilité</h1>
      <p class="page-subtitle">Factures, rapprochement cash, impayés livrés</p>

      <section class="page-section">
        <div id="inv-kpis" class="kpi-bar">
          <div class="loading-state"><span class="loader"></span> Chargement...</div>
        </div>
      </section>

      <section class="page-section grid grid-2">
        <div class="card">
          <div class="card-header"><h3 class="card-title">📄 Factures</h3></div>
          <div id="inv-table"></div>
        </div>
        <div class="card">
          <div class="card-header"><h3 class="card-title">💸 Impayés livrés</h3></div>
          <div id="inv-uncollected"></div>
        </div>
      </section>

      <section class="page-section">
        <div class="card">
          <div class="card-header"><h3 class="card-title">🔄 Rapprochement cash</h3></div>
          <div id="inv-reconciliation"></div>
        </div>
      </section>

      <p id="inv-meta" style="margin-top:16px;font-size:var(--fs-xs);color:var(--text-tertiary);"></p>
    `;

    try {
      const params = { from: filters.from, to: filters.to };
      const [invoices, reconciliation, uncollected] = await Promise.all([
        KmcApi.getInvoices(params).catch(() => null),
        KmcApi.getCashReconciliation(params).catch(() => null),
        KmcApi.getCashUncollected({ hours: 72 }).catch(() => null),
      ]);

      // Guard : navigation entre-temps → rootEl détaché du DOM
      if (!rootEl || !document.contains(rootEl)) return;

      _renderKpis(document.getElementById('inv-kpis'), invoices, uncollected);
      _renderInvoices(document.getElementById('inv-table'), invoices);
      _renderUncollected(document.getElementById('inv-uncollected'), uncollected);
      _renderReconciliation(document.getElementById('inv-reconciliation'), reconciliation);

      document.getElementById('inv-meta').textContent =
        `Données comptabilité — ${new Date().toLocaleTimeString('fr-FR')}`;

    } catch (err) {
      console.error('[InvoicesView] error:', err);
      if (!rootEl || !document.contains(rootEl)) return;
      document.getElementById('inv-kpis').innerHTML =
        `<div class="error-state">❌ Erreur : ${err.message || 'inconnue'}</div>`;
    }
  }

  function _renderKpis(el, invoices, uncollected) {
    const inv = invoices?.summary || invoices || {};
    const unc = uncollected?.summary || uncollected || {};
    KpiCard.renderBar(el, [
      { key: 'inv_total',    label: 'Factures émises',
        value: Number(inv.total_count || inv.count || 0).toLocaleString('fr-FR') },
      { key: 'inv_pending',  label: 'En attente paiement',
        value: Number(inv.pending_count || 0).toLocaleString('fr-FR') },
      { key: 'inv_amount',   label: 'Montant total',
        value: Number(inv.total_kmf || inv.amount_kmf || 0).toLocaleString('fr-FR') + ' KMF' },
      { key: 'unc_count',    label: 'Impayés livrés',
        value: Number(unc.count || unc.total_count || 0).toLocaleString('fr-FR'),
      },
      { key: 'unc_amount',   label: 'Montant impayés',
        value: Number(unc.total_kmf || unc.amount_kmf || 0).toLocaleString('fr-FR') + ' KMF' },
    ]);
  }

  function _renderInvoices(el, invoices) {
    const rows = invoices?.invoices || invoices?.items || (Array.isArray(invoices) ? invoices : []);
    DataTable.render(el, {
      emptyText: 'Aucune facture sur la période',
      columns: [
        { key: 'reference',    label: 'Référence',   render: (r) => r.reference || r.invoice_number || r.id || '—' },
        { key: 'client',       label: 'Client',      render: (r) => r.client_name || r.recipient_name || '—' },
        { key: 'amount',       label: 'Montant',     align: 'right',
          render: (r) => Number(r.amount_kmf || r.total_kmf || r.amount || 0).toLocaleString('fr-FR') + ' KMF' },
        { key: 'status',       label: 'Statut',      render: (r) => BadgeStatus.status(r.status || 'pending') },
        { key: 'issued_at',    label: 'Émise le',
          render: (r) => r.issued_at || r.created_at
            ? new Date(r.issued_at || r.created_at).toLocaleDateString('fr-FR') : '—' },
        { key: 'due_at',       label: 'Échéance',
          render: (r) => r.due_at ? new Date(r.due_at).toLocaleDateString('fr-FR') : '—' },
      ],
      rows,
    });
  }

  function _renderUncollected(el, uncollected) {
    const rows = uncollected?.orders || uncollected?.items || (Array.isArray(uncollected) ? uncollected : []);
    DataTable.render(el, {
      emptyText: 'Aucun impayé livré',
      columns: [
        { key: 'reference',    label: 'Commande',    render: (r) => r.reference || r.order_ref || r.id || '—' },
        { key: 'client',       label: 'Client',      render: (r) => r.client_name || r.recipient_name || '—' },
        { key: 'relais',       label: 'Relais',      render: (r) => r.relais_name || r.relais_id || '—' },
        { key: 'total',        label: 'Total',       align: 'right',
          render: (r) => Number(r.total_kmf || r.total || 0).toLocaleString('fr-FR') + ' KMF' },
        { key: 'delivered_at', label: 'Livré le',
          render: (r) => r.delivered_at || r.available_at
            ? new Date(r.delivered_at || r.available_at).toLocaleDateString('fr-FR') : '—' },
      ],
      rows,
    });
  }

  function _renderReconciliation(el, reconciliation) {
    if (!reconciliation) {
      el.innerHTML = '<div class="empty-state" style="padding:14px;">Données de rapprochement indisponibles</div>';
      return;
    }
    const rows = reconciliation.entries || reconciliation.items || (Array.isArray(reconciliation) ? reconciliation : []);
    const summary = reconciliation.summary || reconciliation;
    const gap = Number(summary.gap_kmf || summary.ecart_kmf || 0);
    const gapCls = Math.abs(gap) < 1000 ? 'is-green' : 'is-red';
    const gapLabel = gap === 0 ? 'Équilibré' : (gap > 0 ? `+${gap.toLocaleString('fr-FR')} KMF` : `${gap.toLocaleString('fr-FR')} KMF`);

    el.innerHTML = `
      <div style="display:flex;gap:12px;align-items:center;padding:12px 0;border-bottom:1px solid var(--border-subtle);margin-bottom:12px;">
        <span style="font-size:0.85rem;color:var(--text-secondary);">
          Théorique : <strong>${Number(summary.theoretical_kmf || summary.expected_kmf || 0).toLocaleString('fr-FR')} KMF</strong>
        </span>
        <span style="font-size:0.85rem;color:var(--text-secondary);">
          Réel : <strong>${Number(summary.actual_kmf || summary.collected_kmf || 0).toLocaleString('fr-FR')} KMF</strong>
        </span>
        <span class="badge ${gapCls}">Écart : ${gapLabel}</span>
      </div>
    `;

    const tableEl = document.createElement('div');
    el.appendChild(tableEl);
    DataTable.render(tableEl, {
      emptyText: 'Aucune ligne de rapprochement',
      columns: [
        { key: 'date',       label: 'Date',
          render: (r) => r.date || r.created_at ? new Date(r.date || r.created_at).toLocaleDateString('fr-FR') : '—' },
        { key: 'relais',     label: 'Relais',    render: (r) => r.relais_name || r.relais_id || '—' },
        { key: 'theoretical', label: 'Théorique', align: 'right',
          render: (r) => Number(r.theoretical_kmf || r.expected || 0).toLocaleString('fr-FR') + ' KMF' },
        { key: 'actual',     label: 'Réel',      align: 'right',
          render: (r) => Number(r.actual_kmf || r.collected || 0).toLocaleString('fr-FR') + ' KMF' },
        { key: 'gap',        label: 'Écart',     align: 'right',
          render: (r) => {
            const g = Number(r.gap_kmf || r.ecart || 0);
            const cls = Math.abs(g) < 100 ? 'is-green' : 'is-red';
            return `<span class="badge ${cls}">${g.toLocaleString('fr-FR')} KMF</span>`;
          }
        },
      ],
      rows,
    });
  }

  global.InvoicesView = { render };
})(window);

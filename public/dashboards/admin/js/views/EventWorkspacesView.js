/**
 * @komerce-arch
 * @role          admin-event-workspaces-view
 * @domain        admin-dashboard
 * @layer         ui-page
 * @criticality   medium
 * @inputs        event workspaces list
 * @outputs       event_workspaces_page_dom (paniers événement, participants, statuts)
 * @depends       api-client.js, filters-store.js, utils.js
 * @used-by       none
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      kmc_api_only
 * @impact-areas  group-cart, event-workspaces, admin-dashboard
 * @version       2026-06
 */

'use strict';
/**
 * KOMERCE Dashboard — Vue Panier événement /admin/event-workspaces
 * ════════════════════════════════════════════════════════════════════════
 * Question : "Combien d'événements en cours, où accompagner SANS culpabiliser ?"
 *
 * DOCTRINE UX ZERO-BLAME :
 *   - Aucun nominatif sur "qui n'a pas payé"
 *   - Formulations neutres ("Une contribution reste en attente")
 *   - Pas de dark pattern
 *   - Session terminée ≠ échec dramatique
 *   - Reprise simple toujours possible
 *
 * Sections :
 *   - KPI bar (8)
 *   - Pipeline workspace (funnel)
 *   - Tableau workspaces
 *   - Alertes & risques (formulations neutres)
 */

(function (global) {
  'use strict';

  /**
   * MAPPING formulations zero-blame.
   * NE JAMAIS modifier ces formulations sans accord — elles protègent la doctrine UX.
   */
  const ALERT_FORMULATIONS = {
    payment_authorization_failed: {
      label: 'Une contribution est à réessayer',
      description: 'Un paiement n\'a pas pu être finalisé. Le panier peut être repris.',
    },
    session_about_to_end: {
      label: 'Session bientôt terminée',
      description: 'La session de paiement arrive à échéance. Une nouvelle session peut être lancée.',
    },
    session_ended_without_order: {
      label: 'Session terminée sans commande',
      description: 'Le panier reste disponible et peut être repris facilement.',
    },
    product_unavailable: {
      label: 'Produit devenu indisponible',
      description: 'Une ligne du panier est impactée. Vous pouvez ajuster ou retirer cette ligne.',
    },
    workspace_abandoned: {
      label: 'Workspace inactif',
      description: 'Le workspace n\'a pas eu d\'activité récente. Le créateur peut le reprendre quand il le souhaite.',
    },
    order_creation_failed: {
      label: 'Création de commande à finaliser',
      description: 'Tous les paiements sont confirmés. La commande est prête à être créée.',
    },
  };

  async function render(rootEl) {
    rootEl.innerHTML = `
      <h1 class="page-title">Panier événement</h1>
      <p class="page-subtitle">Organiser la contribution familiale — accompagner sans pression</p>

      <section class="page-section">
        <div id="ws-kpis" class="kpi-bar">
          <div class="loading-state"><span class="loader"></span> Chargement...</div>
        </div>
      </section>

      <section class="page-section grid grid-2">
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">Pipeline des workspaces</h3>
          </div>
          <div id="ws-funnel-chart"></div>
        </div>
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">Bon à savoir</h3>
          </div>
          <div style="padding: 8px; font-size: 13px; color: var(--text-secondary); line-height: 1.6;">
            <p style="margin-bottom: 8px;">💡 <strong>Tous les paniers peuvent être repris.</strong></p>
            <p style="margin-bottom: 8px;">Une session terminée ne signifie pas un échec. Le créateur peut relancer une nouvelle session quand il le souhaite, avec les mêmes ou de nouveaux contributeurs.</p>
            <p>📨 Vous pouvez personnaliser le message de relance pour les contributeurs depuis la fiche workspace.</p>
          </div>
        </div>
      </section>

      <section class="page-section">
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">Workspaces actifs</h3>
          </div>
          <div id="ws-table"></div>
        </div>
      </section>

      <section class="page-section">
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">Alertes & accompagnement</h3>
          </div>
          <div id="ws-alerts"></div>
          <p style="margin-top: 12px; font-size: 11px; color: var(--text-tertiary); font-style: italic;">
            Formulations neutres — Komerce ne nomme jamais un contributeur en retard.
          </p>
        </div>
      </section>

      <p id="ws-meta" style="margin-top: 16px; font-size: var(--fs-xs); color: var(--text-tertiary);"></p>
    `;

    try {
      const filters = KmcFilters.get();
      const data = await KmcApi.getEventWorkspaces(filters);

      // KPIs
      // Guard : navigation entre-temps → rootEl détaché du DOM
      if (!rootEl || !document.contains(rootEl)) return;

      KpiCard.renderBar(document.getElementById('ws-kpis'), data.kpis || []);

      // Funnel
      if (data.charts && data.charts.workspace_funnel) {
        Charts.renderFunnel(
          document.getElementById('ws-funnel-chart'),
          data.charts.workspace_funnel
        );
      }

      // Tableau workspaces (data.tables.workspaces si dispo)
      const workspaces = (data.tables && data.tables.workspaces) || [];
      DataTable.render(document.getElementById('ws-table'), {
        emptyText: 'Aucun workspace en cours',
        columns: [
          { key: 'event_name', label: 'Événement' },
          {
            key: 'creator_name',
            label: 'Créateur',
            render: (row) => row.creator_name || row.creator_label || '—',
          },
          {
            key: 'recipient_name',
            label: 'Destinataire',
            render: (row) => row.recipient_name || '—',
          },
          {
            key: 'status',
            label: 'Statut',
            render: (row) => BadgeStatus.status(row.status || 'conception'),
          },
          {
            key: 'cart_total_kmf',
            label: 'Total panier',
            align: 'right',
            render: (row) => Number(row.cart_total_kmf || 0).toLocaleString('fr-FR'),
          },
          {
            key: 'progress_pct',
            label: 'Couvert',
            align: 'right',
            render: (row) => {
              const pct = Number(row.progress_pct || 0);
              const cls = pct >= 100 ? 'is-green' : (pct >= 50 ? 'is-blue' : 'is-orange');
              return `<span class="badge ${cls}">${pct.toFixed(0)}%</span>`;
            },
          },
          {
            key: 'order_id',
            label: 'Commande',
            render: (row) => row.order_id
              ? `<a href="/admin/orders-logistics?order_id=${row.order_id}" class="badge is-green">créée</a>`
              : '<span class="badge is-gray">en cours</span>',
          },
        ],
        rows: workspaces,
      });

      // Alertes — appliquer formulations zero-blame
      const cleanAlerts = (data.alerts || []).map(a => {
        const form = ALERT_FORMULATIONS[a.key];
        if (form) {
          return {
            ...a,
            label: form.label,
            message: form.description,
            level: a.level || 'info',
          };
        }
        return a;
      });
      AlertList.renderList(
        document.getElementById('ws-alerts'),
        cleanAlerts,
        { limit: 10, emptyText: 'Tous les workspaces fonctionnent normalement' }
      );

      // Meta
      if (data.data_quality) {
        const meta = document.getElementById('ws-meta');
        const dq = data.data_quality;
        const cached = dq.is_cached ? `(cache ${dq.cache_age_seconds}s)` : '(données fraîches)';
        meta.textContent = `Généré ${new Date(dq.generated_at).toLocaleTimeString('fr-FR')} ${cached}`;
      }
    } catch (err) {
      console.error('[Workspaces] error:', err);
      document.getElementById('ws-kpis').innerHTML = `<div class="error-state">
        ❌ Erreur: ${err.message || 'inconnue'}
        ${err.status === 401 ? ' — connectez-vous comme admin' : ''}
      </div>`;
    }
  }

  global.EventWorkspacesView = { render };
})(window);

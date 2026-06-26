/**
 * @komerce-arch
 * @role          admin-control-tower-view
 * @domain        admin-dashboard
 * @layer         ui-page
 * @criticality   high
 * @inputs        filters (from, to), ops pipeline, unsold stats
 * @outputs       control_tower_page_dom (pipeline commandes, hub & relais, stocks invendus)
 * @depends       api-client.js, api-client-unsold.js, filters-store.js, utils.js, components/KpiCard.js
 * @used-by       none
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      kmc_api_only
 * @impact-areas  hub-relais, ops, control-tower, admin-dashboard
 * @version       2026-06
 */

'use strict';
/**
 * KOMERCE Dashboard — Vue Tour de contrôle /admin/control-tower
 * ════════════════════════════════════════════════════════════════════════
 * Question : "Faut-il agir aujourd'hui ?"
 *
 * Sections :
 *   - KPI bar (8)
 *   - A : Activité (line chart)
 *   - B : Statuts (donut)
 *   - D : Alertes critiques (avec actions)
 *   - E : Commandes à traiter (table)
 *   - F : Pipeline colis (funnel)
 *   - G : Performance relais (table)
 *   - H : 🚦 SLA & délais [NOUVEAU — parité pilotage_op]
 *   - I : 📦 Invendus & stock [NOUVEAU — parité pilotage_op]
 *
 * Sources API :
 *   KmcApi.getControlTower(filters)  → /api/admin/dashboard/control-tower
 *   KmcApi.getOps(filters)           → /api/dashboard/ops  (SLA + délais)
 *   KmcApi.getUnsoldStats()          → /api/unsold/stats/summary (invendus)
 *
 * Parité legacy : ct-views-pilotage-op.js (wrapper sur ct-views-pilotage.js)
 *   tabs opérationnels : 🚦 Opérationnel (renderOps) + ⭐ Fidélité & Invendus (renderInvendus)
 * Lot 5 — statut cible : integrated_validated
 */

(function (global) {
  'use strict';

  /* ══════════════════════════════════════════════════════════════════════
   * CSS — namespaced ctv-* pour les nouvelles sections
   * ══════════════════════════════════════════════════════════════════════ */
  (function injectStyles() {
    if (document.getElementById('ctv-styles')) return;
    const s = document.createElement('style');
    s.id = 'ctv-styles';
    s.textContent = `
      /* ── SLA tracker ─────────────────────────────────────────────────── */
      .ctv-sla-grid {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: var(--sp-3);
        margin-bottom: var(--sp-4);
      }
      @media (max-width: 640px) { .ctv-sla-grid { grid-template-columns: repeat(2, 1fr); } }

      .ctv-sla-bucket {
        background: var(--bg-hover);
        border-radius: var(--border-radius);
        padding: var(--sp-3) var(--sp-4);
        text-align: center;
        border-top: 3px solid var(--border-color-2);
      }
      .ctv-sla-bucket.is-green  { border-top-color: var(--kmc-green);  background: var(--kmc-green-bg); }
      .ctv-sla-bucket.is-yellow { border-top-color: var(--kmc-orange); background: var(--kmc-orange-bg); }
      .ctv-sla-bucket.is-red    { border-top-color: var(--kmc-red);    background: var(--kmc-red-bg); }
      .ctv-sla-bucket.is-grey   { border-top-color: var(--kmc-gray);   background: var(--kmc-gray-bg); }

      .ctv-sla-num {
        font-size: var(--fs-2xl);
        font-weight: var(--fw-bold);
        color: var(--text-primary);
        line-height: 1.1;
        font-variant-numeric: tabular-nums;
      }
      .ctv-sla-label {
        font-size: var(--fs-xs);
        font-weight: var(--fw-semibold);
        color: var(--text-secondary);
        text-transform: uppercase;
        letter-spacing: 0.05em;
        margin-top: var(--sp-1);
      }

      .ctv-delays-row {
        display: flex;
        gap: var(--sp-4);
        font-size: var(--fs-sm);
        color: var(--text-secondary);
        margin-bottom: var(--sp-4);
        flex-wrap: wrap;
      }
      .ctv-delays-row strong { color: var(--text-primary); font-weight: var(--fw-semibold); }

      .ctv-sla-late {
        margin-top: var(--sp-3);
      }
      .ctv-sla-late-title {
        font-size: var(--fs-xs);
        font-weight: var(--fw-bold);
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--text-secondary);
        margin-bottom: var(--sp-2);
      }
      .ctv-sla-table {
        width: 100%;
        font-size: var(--fs-sm);
      }
      .ctv-sla-table th {
        background: var(--bg-hover);
        padding: var(--sp-2) var(--sp-3);
        text-align: left;
        font-size: var(--fs-xs);
        font-weight: var(--fw-semibold);
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--text-secondary);
        border-bottom: 1px solid var(--border-color);
      }
      .ctv-sla-table td {
        padding: var(--sp-2) var(--sp-3);
        border-bottom: 1px solid var(--border-color);
      }
      .ctv-sla-table td.num { text-align: right; font-variant-numeric: tabular-nums; font-weight: var(--fw-semibold); }
      .ctv-sla-table tr:last-child td { border-bottom: none; }

      /* ── Invendus ────────────────────────────────────────────────────── */
      .ctv-unsold-kpis {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
        gap: var(--sp-3);
        margin-bottom: var(--sp-4);
      }
      .ctv-unsold-kpi {
        background: var(--bg-hover);
        border-radius: var(--border-radius);
        padding: var(--sp-3) var(--sp-4);
      }
      .ctv-unsold-kpi-label {
        font-size: var(--fs-xs);
        font-weight: var(--fw-semibold);
        color: var(--text-secondary);
        text-transform: uppercase;
        letter-spacing: 0.05em;
        margin-bottom: var(--sp-1);
      }
      .ctv-unsold-kpi-val {
        font-size: var(--fs-xl);
        font-weight: var(--fw-bold);
        color: var(--text-primary);
        font-variant-numeric: tabular-nums;
      }
      .ctv-unsold-kpi-sub {
        font-size: var(--fs-xs);
        color: var(--text-tertiary);
        margin-top: 2px;
      }

      .ctv-channel-bar {
        display: flex;
        gap: var(--sp-3);
        flex-wrap: wrap;
        margin-top: var(--sp-2);
      }
      .ctv-channel-item {
        display: flex;
        align-items: center;
        gap: var(--sp-2);
        font-size: var(--fs-sm);
        color: var(--text-secondary);
      }
      .ctv-channel-dot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        flex-shrink: 0;
      }
      .ctv-ok-msg {
        padding: var(--sp-4);
        color: var(--kmc-green);
        font-size: var(--fs-sm);
        font-weight: var(--fw-semibold);
        display: flex;
        align-items: center;
        gap: var(--sp-2);
      }
    `;
    document.head.appendChild(s);
  })();

  /* ══════════════════════════════════════════════════════════════════════
   * Helpers
   * ══════════════════════════════════════════════════════════════════════ */
  function fmt(n) { return (Number(n) || 0).toLocaleString('fr-FR'); }
  function fmtShort(n) {
    const v = Number(n) || 0;
    if (Math.abs(v) >= 1_000_000) return (v / 1_000_000).toFixed(2) + 'M';
    if (Math.abs(v) >= 1_000)     return (v / 1_000).toFixed(0) + 'k';
    return String(Math.round(v));
  }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  /* ══════════════════════════════════════════════════════════════════════
   * Section H — SLA & délais
   * Source : KmcApi.getOps() → .sla { on_time, warning, late, blocked, details.late[] }
   *                          → .delais { avg_preparation_jours, avg_livraison_totale_jours }
   * ══════════════════════════════════════════════════════════════════════ */
  function _renderSla(el, ops) {
    if (!ops?.sla) {
      el.innerHTML = '<div class="empty-state">Données SLA indisponibles</div>';
      return;
    }

    const { sla, delais } = ops;

    // Buckets
    const buckets = [
      { key: 'on_time', label: 'Dans les délais', cls: 'is-green',  icon: '✅' },
      { key: 'warning',  label: 'En approche',    cls: 'is-yellow', icon: '⚠️' },
      { key: 'late',     label: 'En retard',       cls: 'is-red',   icon: '🔴' },
      { key: 'blocked',  label: 'Bloquées',        cls: 'is-grey',  icon: '🔒' },
    ];

    let html = '<div class="ctv-sla-grid">';
    for (const b of buckets) {
      html += `
        <div class="ctv-sla-bucket ${b.cls}">
          <div class="ctv-sla-num">${sla[b.key] ?? 0}</div>
          <div class="ctv-sla-label">${b.icon} ${b.label}</div>
        </div>
      `;
    }
    html += '</div>';

    // Délais moyens
    if (delais) {
      html += '<div class="ctv-delays-row">';
      if (delais.avg_preparation_jours != null) {
        html += `<span>⏱ Délai préparation moyen : <strong>${delais.avg_preparation_jours}j</strong></span>`;
      }
      if (delais.avg_livraison_totale_jours != null) {
        html += `<span>📦 Délai livraison totale moyen : <strong>${delais.avg_livraison_totale_jours}j</strong></span>`;
      }
      html += '</div>';
    }

    // Table des commandes en retard
    const late = sla.details?.late || [];
    if (late.length) {
      html += `
        <div class="ctv-sla-late">
          <div class="ctv-sla-late-title">🔴 Commandes en retard (${late.length})</div>
          <table class="ctv-sla-table">
            <thead><tr>
              <th>Référence</th><th>Statut</th><th class="num">Âge (j)</th>
            </tr></thead>
            <tbody>
              ${late.map(o => `
                <tr>
                  <td>
                    <a href="/admin/orders-logistics?order_id=${esc(o.id || '')}"
                       style="color:var(--kmc-blue);font-weight:var(--fw-semibold);">
                      ${esc(o.reference)}
                    </a>
                  </td>
                  <td>${esc(o.status || '—')}</td>
                  <td class="num">${o.jours ?? '?'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    } else {
      html += '<div class="ctv-ok-msg">✅ Aucune commande en retard détecté</div>';
    }

    el.innerHTML = html;
  }

  /* ══════════════════════════════════════════════════════════════════════
   * Section I — Invendus & stock
   * Source : KmcApi.getUnsoldStats() → /api/unsold/stats/summary
   *   { total_actifs, valeur_liquidation_kmf, valeur_initiale_kmf,
   *     jours_moy_en_stock, canal_whatsapp, canal_revendeur, canal_both }
   * ══════════════════════════════════════════════════════════════════════ */
  function _renderUnsold(el, stats) {
    if (!stats) {
      el.innerHTML = '<div class="empty-state">Données invendus indisponibles</div>';
      return;
    }

    const total = Number(stats.total_actifs) || 0;

    if (total === 0) {
      el.innerHTML = '<div class="ctv-ok-msg">✅ Aucun invendu actif — bonne santé du stock</div>';
      return;
    }

    const valLiquid   = Number(stats.valeur_liquidation_kmf) || 0;
    const valInitiale = Number(stats.valeur_initiale_kmf) || 0;
    const joursMoy    = Number(stats.jours_moy_en_stock) || 0;
    const remisePct   = valInitiale > 0
      ? Math.round((1 - valLiquid / valInitiale) * 100)
      : 0;

    let html = `
      <div class="ctv-unsold-kpis">
        <div class="ctv-unsold-kpi">
          <div class="ctv-unsold-kpi-label">Articles actifs</div>
          <div class="ctv-unsold-kpi-val">${total}</div>
          <div class="ctv-unsold-kpi-sub">en pipeline liquidation</div>
        </div>
        <div class="ctv-unsold-kpi">
          <div class="ctv-unsold-kpi-label">Valeur liquidation</div>
          <div class="ctv-unsold-kpi-val">${fmtShort(valLiquid)} KMF</div>
          <div class="ctv-unsold-kpi-sub">−${remisePct}% vs prix initial</div>
        </div>
        <div class="ctv-unsold-kpi">
          <div class="ctv-unsold-kpi-label">Valeur initiale</div>
          <div class="ctv-unsold-kpi-val">${fmtShort(valInitiale)} KMF</div>
          <div class="ctv-unsold-kpi-sub">coût total non récupéré</div>
        </div>
        <div class="ctv-unsold-kpi">
          <div class="ctv-unsold-kpi-label">Âge moyen</div>
          <div class="ctv-unsold-kpi-val">${joursMoy}j</div>
          <div class="ctv-unsold-kpi-sub">en stock invendu</div>
        </div>
      </div>
    `;

    // Répartition canaux
    const whatsapp  = Number(stats.canal_whatsapp) || 0;
    const revendeur = Number(stats.canal_revendeur) || 0;
    const both      = Number(stats.canal_both) || 0;
    if (whatsapp + revendeur + both > 0) {
      html += `
        <div class="ctv-channel-bar">
          <span style="font-size:var(--fs-xs);color:var(--text-secondary);font-weight:var(--fw-semibold);text-transform:uppercase;letter-spacing:0.05em;">Canaux :</span>
          ${whatsapp  ? `<span class="ctv-channel-item"><span class="ctv-channel-dot" style="background:#25d366"></span>${whatsapp} WhatsApp</span>` : ''}
          ${revendeur ? `<span class="ctv-channel-item"><span class="ctv-channel-dot" style="background:var(--kmc-blue)"></span>${revendeur} Revendeur</span>` : ''}
          ${both      ? `<span class="ctv-channel-item"><span class="ctv-channel-dot" style="background:var(--kmc-amber)"></span>${both} Les deux</span>` : ''}
        </div>
      `;
    }

    el.innerHTML = html;
  }

  /* ══════════════════════════════════════════════════════════════════════
   * Render principal
   * ══════════════════════════════════════════════════════════════════════ */
  async function render(rootEl) {
    rootEl.innerHTML = `
      <h1 class="page-title">Tour de contrôle</h1>
      <p class="page-subtitle">Voir, comprendre, décider — état opérationnel temps réel</p>

      <section class="page-section">
        <div id="ct-kpis" class="kpi-bar">
          <div class="loading-state"><span class="loader"></span> Chargement...</div>
        </div>
      </section>

      <section class="page-section grid grid-2">
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">Activité (commandes & CA)</h3>
          </div>
          <div id="ct-activity-chart"></div>
        </div>
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">Répartition par statut</h3>
          </div>
          <div id="ct-status-chart"></div>
        </div>
      </section>

      <section class="page-section">
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">Alertes critiques</h3>
            <a href="/admin/alerts" class="card-action">Voir toutes →</a>
          </div>
          <div id="ct-alerts"></div>
        </div>
      </section>

      <section class="page-section grid grid-2">
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">Commandes à traiter</h3>
          </div>
          <div id="ct-orders-table"></div>
        </div>
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">Performance relais (7j)</h3>
          </div>
          <div id="ct-relais-table"></div>
        </div>
      </section>

      <section class="page-section grid grid-2">
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">🚦 SLA & délais</h3>
            <a href="/admin/orders-logistics" class="card-action">Voir commandes →</a>
          </div>
          <div id="ct-sla" style="padding: var(--sp-4);">
            <div class="loading-state"><span class="loader"></span></div>
          </div>
        </div>
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">📦 Invendus & stock</h3>
            <a href="/admin/orders-logistics?status=unsold" class="card-action">Voir tout →</a>
          </div>
          <div id="ct-unsold" style="padding: var(--sp-4);">
            <div class="loading-state"><span class="loader"></span></div>
          </div>
        </div>
      </section>

      <p id="ct-meta" style="margin-top: 16px; font-size: var(--fs-xs); color: var(--text-tertiary);"></p>
    `;

    try {
      const filters = KmcFilters.get();

      // Fetch en parallèle : control-tower + ops (SLA) + unsold (invendus)
      const [data, ops, unsoldStats] = await Promise.all([
        KmcApi.getControlTower(filters),
        KmcApi.getOps(filters).catch(() => null),
        KmcApi.getUnsoldStats().catch(() => null),
      ]);

      // ── KPIs ─────────────────────────────────────────────────────────
      // Guard : navigation entre-temps → rootEl détaché du DOM
      if (!rootEl || !document.contains(rootEl)) return;

      KpiCard.renderBar(document.getElementById('ct-kpis'), data.kpis || []);

      // ── Charts ───────────────────────────────────────────────────────
      if (data.charts?.activity_timeline) {
        Charts.renderLineChart(
          document.getElementById('ct-activity-chart'),
          data.charts.activity_timeline
        );
      }
      if (data.charts?.status_breakdown) {
        Charts.renderDonutChart(
          document.getElementById('ct-status-chart'),
          data.charts.status_breakdown,
          { keyField: 'status', valueField: 'count' }
        );
      }

      // ── Alerts ───────────────────────────────────────────────────────
      AlertList.renderList(
        document.getElementById('ct-alerts'),
        data.alerts || [],
        { limit: 8, emptyText: 'Aucune alerte critique en cours' }
      );

      // ── Commandes à traiter ──────────────────────────────────────────
      const orders = data.tables?.orders_to_handle || [];
      DataTable.render(document.getElementById('ct-orders-table'), {
        emptyText: 'Aucune commande à traiter',
        columns: [
          { key: 'reference', label: 'Réf', cls: 'ref' },
          {
            key: 'payment_status',
            label: 'Paiement',
            render: (row) => BadgeStatus.status(row.payment_status || 'pending'),
          },
          {
            key: 'status',
            label: 'Statut',
            render: (row) => BadgeStatus.status(row.status || 'pending'),
          },
          {
            key: 'total_kmf',
            label: 'Total',
            align: 'right',
            render: (row) => Number(row.total_kmf || 0).toLocaleString('fr-FR') + ' KMF',
          },
          {
            key: 'relais_name',
            label: 'Relais',
            render: (row) => row.relais_name || '—',
          },
        ],
        rows: orders,
        onRowClick: (row) => {
          window.location.href = `/admin/orders-logistics?order_id=${row.id}`;
        },
      });

      // ── Performance relais ───────────────────────────────────────────
      const relais = data.tables?.relais_performance || [];
      DataTable.render(document.getElementById('ct-relais-table'), {
        emptyText: 'Aucune donnée relais',
        columns: [
          { key: 'relais_name', label: 'Relais' },
          { key: 'orders_count', label: 'Cmds', align: 'right' },
          { key: 'available', label: 'Disp.', align: 'right' },
          { key: 'collected', label: 'Retirés', align: 'right' },
          {
            key: 'taux_retrait_pct',
            label: 'Taux retrait',
            align: 'right',
            render: (row) => {
              const pct = Number(row.taux_retrait_pct || 0);
              const color = pct >= 70 ? 'is-green' : (pct >= 40 ? 'is-orange' : 'is-red');
              return `<span class="badge ${color}">${pct.toFixed(1)}%</span>`;
            },
          },
        ],
        rows: relais,
      });

      // ── SLA & délais (section H) ─────────────────────────────────────
      _renderSla(document.getElementById('ct-sla'), ops);

      // ── Invendus & stock (section I) ─────────────────────────────────
      _renderUnsold(document.getElementById('ct-unsold'), unsoldStats);

      // ── Meta ─────────────────────────────────────────────────────────
      if (data.data_quality) {
        const meta = document.getElementById('ct-meta');
        const dq = data.data_quality;
        const cached = dq.is_cached
          ? `(cache ${dq.cache_age_seconds}s/${dq.cache_ttl_seconds}s)`
          : '(données fraîches)';
        meta.textContent = `Généré ${new Date(dq.generated_at).toLocaleTimeString('fr-FR')} ${cached}`;
        if (dq.warnings?.length) {
          meta.textContent += ' · ' + dq.warnings.join(' · ');
        }
      }

    } catch (err) {
      console.error('[ControlTower] error:', err);
      const main = document.getElementById('ct-kpis');
      if (main) {
        main.innerHTML = `<div class="error-state">
          ❌ Erreur de chargement : ${err.message || 'inconnue'}
          ${err.status === 401 ? ' — connectez-vous comme admin' : ''}
        </div>`;
      }
    }
  }

  global.ControlTowerView = { render };

})(window);

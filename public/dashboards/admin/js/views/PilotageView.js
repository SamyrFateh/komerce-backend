/**
 * @komerce-arch
 * @role          admin-pilotage-view
 * @domain        admin-dashboard
 * @layer         ui-page
 * @criticality   high
 * @inputs        filters (from, to), pilotage KPIs
 * @outputs       pilotage_page_dom (KPI bar, tendances, alertes opé)
 * @depends       api-client.js, filters-store.js, utils.js, components/KpiCard.js, components/Charts.js
 * @used-by       none
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      kmc_api_only
 * @impact-areas  pilotage, kpi, admin-dashboard
 * @version       2026-06
 */
/**
 * KOMERCE Dashboard — Vue unifiée /admin/pilotage
 * ════════════════════════════════════════════════════════════════════════
 * Carte du système : 4 blocs vues + KPI bar globale + economic flow.
 */

(function (global) {
  'use strict';

  async function render(rootEl) {
    rootEl.innerHTML = `
      <h1 class="page-title">Pilotage</h1>
      <p class="page-subtitle">Vue unifiée du système Komerce — 4 vues spécialisées + boucle économique</p>

      <section class="page-section">
        <div id="pilotage-kpis" class="kpi-bar"><div class="loading-state"><span class="loader"></span> Chargement...</div></div>
      </section>

      <section class="page-section">
        <h2 class="page-section-title">Les 4 vues spécialisées</h2>
        <div id="pilotage-blocks" class="grid grid-2"><div class="loading-state"><span class="loader"></span></div></div>
      </section>

      <section class="page-section">
        <h2 class="page-section-title">Boucle économique</h2>
        <div id="pilotage-flow" class="economic-flow"></div>
        <p style="margin-top: 12px; font-size: var(--fs-sm); color: var(--text-secondary);">
          Cette boucle assure que Komerce sait pourquoi un produit est vendu à ce prix,
          combien il coûte rendu relais, et quelle marge reste après reventilation terrain.
        </p>
      </section>

      <section class="page-section grid grid-2">
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">Principes non négociables</h3>
          </div>
          <ul id="pilotage-principles" class="principles-list"></ul>
        </div>
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">Alertes système transverses</h3>
          </div>
          <div id="pilotage-alerts"></div>
        </div>
      </section>
    `;

    try {
      const filters = KmcFilters.get();
      const data = await KmcApi.getUnified(filters);

      // KPIs globaux
      // Guard : navigation entre-temps → rootEl détaché du DOM
      if (!rootEl || !document.contains(rootEl)) return;

      KpiCard.renderBar(document.getElementById('pilotage-kpis'), data.kpis_global || []);

      // Blocs vues
      const blocksEl = document.getElementById('pilotage-blocks');
      blocksEl.innerHTML = '';
      (data.view_blocks || []).forEach(block => {
        const div = document.createElement('div');
        div.className = 'view-block';
        div.addEventListener('click', () => window.location.href = block.url);

        div.innerHTML = `
          <div class="view-block-header">
            <div>
              <div class="view-block-title">${block.title}</div>
              <div class="view-block-subtitle">"${block.subtitle}"</div>
            </div>
            <div class="view-block-arrow">→</div>
          </div>
          <div class="view-block-kpis"></div>
        `;

        const kpisEl = div.querySelector('.view-block-kpis');
        (block.kpis_summary || []).slice(0, 4).forEach(kpi => {
          kpisEl.appendChild(KpiCard.renderMini(kpi));
        });

        blocksEl.appendChild(div);
      });

      // Economic flow
      const flowEl = document.getElementById('pilotage-flow');
      flowEl.innerHTML = '';
      const stages = (data.economic_flow && data.economic_flow.stages) || [];
      stages.forEach((stage, idx) => {
        if (idx > 0) {
          const arrow = document.createElement('div');
          arrow.className = 'economic-flow-arrow';
          arrow.innerHTML = '→';
          flowEl.appendChild(arrow);
        }
        const stageEl = document.createElement('div');
        stageEl.className = 'economic-flow-stage';
        stageEl.addEventListener('click', () => {
          if (stage.url) window.location.href = stage.url;
        });
        stageEl.innerHTML = `
          <div class="economic-flow-stage-icon">${idx + 1}</div>
          <div class="economic-flow-stage-label">${stage.label}</div>
        `;
        flowEl.appendChild(stageEl);
      });

      // Principles
      const principlesEl = document.getElementById('pilotage-principles');
      principlesEl.innerHTML = '';
      (data.principles || []).forEach(p => {
        const li = document.createElement('li');
        li.className = 'principle-item';
        li.innerHTML = `<span class="principle-item-bullet">•</span><span>${p}</span>`;
        principlesEl.appendChild(li);
      });

      // Alerts
      AlertList.renderList(
        document.getElementById('pilotage-alerts'),
        data.system_alerts || [],
        { limit: 5, emptyText: 'Aucune alerte critique' }
      );

      // Footer info data_quality
      if (data.data_quality) {
        const meta = document.createElement('p');
        meta.style.cssText = 'margin-top: 16px; font-size: var(--fs-xs); color: var(--text-tertiary);';
        const cached = data.data_quality.is_cached
          ? `(cache ${data.data_quality.cache_age_seconds}s/${data.data_quality.cache_ttl_seconds}s)`
          : '';
        meta.textContent = `Généré ${new Date(data.data_quality.generated_at).toLocaleTimeString('fr-FR')} ${cached}`;
        rootEl.appendChild(meta);
      }
    } catch (err) {
      console.error('[pilotage] error:', err);
      const main = rootEl.querySelector('#pilotage-kpis');
      if (main) {
        main.innerHTML = `<div class="error-state">
          ❌ Erreur de chargement: ${err.message || 'inconnue'}
          ${err.status === 401 ? ' — connectez-vous comme admin' : ''}
        </div>`;
      }
    }
  }

  global.PilotageView = { render };
})(window);

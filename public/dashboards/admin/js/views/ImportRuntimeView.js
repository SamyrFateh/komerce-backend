/**
 * @komerce-arch
 * @role          admin-import-runtime-view
 * @domain        admin-dashboard
 * @layer         ui-page
 * @criticality   medium
 * @inputs        import runtime run projection (business refs only)
 * @outputs       live run-scoped sourcing-to-catalogue pipeline projection
 * @depends       api-client.js
 * @used-by       public/dashboards/admin/js/app.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      kmc_api_only, dashboard_observes_server_truth, fail_closed_certification
 * @impact-areas  sourcing, catalog, certification, admin-dashboard
 * @version       2026-09
 */
'use strict';

(function (global) {
  'use strict';

  const POLL_MS = 3000;
  const LABELS = Object.freeze({
    SOURCE_CONNECTED: 'Source connectée',
    RAW_IMPORT: 'Import brut',
    REFINERY: 'Raffinerie',
    TAXONOMY: 'Taxonomie',
    CERTIFICATION: 'Certification',
    CATALOGUE: 'Catalogue',
  });
  const STAGE_ORDER = Object.keys(LABELS);
  const STATUS_LABELS = Object.freeze({
    RUNNING: 'En cours',
    COMPLETED: 'Terminé',
    FAILED: 'Échec',
  });

  let pollHandle = null;
  let mountedRoot = null;
  let selectedRunRef = null;

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function num(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  function pct(done, total) {
    if (!total) return 0;
    return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
  }

  function formatTime(value) {
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleTimeString('fr-FR', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }

  function injectStyles() {
    if (document.getElementById('import-runtime-live-styles')) return;
    const style = document.createElement('style');
    style.id = 'import-runtime-live-styles';
    style.textContent = `
      .irl-wrap{--bg:#08111f;--panel:#0d1727;--border:#203149;--text:#eef5ff;--muted:#8fa3bd;--blue:#2783ff;--green:#17dc83;--red:#ff4964;--orange:#ffad35;background:var(--bg);color:var(--text);border-radius:18px;padding:24px;min-height:calc(100vh - 120px)}
      .irl-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;margin-bottom:22px}.irl-title{font-size:27px;font-weight:800;letter-spacing:-.02em}.irl-sub{color:var(--muted);margin-top:5px}.irl-live{display:inline-flex;align-items:center;gap:8px;background:#063d2b;color:#28f29a;border-radius:999px;padding:7px 12px;font-weight:800;font-size:12px}.irl-live:before{content:'';width:9px;height:9px;border-radius:50%;background:#19e58a;box-shadow:0 0 14px #19e58a}
      .irl-pipeline{display:grid;grid-template-columns:repeat(6,1fr);background:var(--panel);border:1px solid var(--border);border-radius:14px;padding:24px 18px;margin-bottom:16px}.irl-stage{position:relative;text-align:center;min-width:0}.irl-stage:not(:last-child):after{content:'';position:absolute;top:18px;left:62%;right:-38%;height:3px;background:#30425c;z-index:0}.irl-stage.done:not(:last-child):after{background:var(--green)}.irl-dot{position:relative;z-index:1;margin:0 auto 10px;width:38px;height:38px;border-radius:50%;border:2px solid #7f93ad;background:#132033;display:flex;align-items:center;justify-content:center;font-weight:800;color:#a9b9cc}.irl-stage.done .irl-dot{border-color:var(--green);background:var(--green);color:#052116}.irl-stage.active .irl-dot{border-color:#3fa0ff;background:#0d4ca3;color:#fff;box-shadow:0 0 0 5px rgba(39,131,255,.18),0 0 20px rgba(39,131,255,.75)}.irl-stage.failed .irl-dot{border-color:var(--red);background:#5a1421;color:#ffc2cb}.irl-stage-label{font-weight:750;font-size:13px}.irl-stage-detail{font-size:11px;color:var(--muted);margin-top:5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.irl-stage.active .irl-stage-detail{color:#55aaff}.irl-stage.failed .irl-stage-detail{color:#ff8a9b}
      .irl-kpis{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;margin-bottom:16px}.irl-kpi{background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:16px}.irl-kpi-label{font-size:11px;color:#a9b9cc;font-weight:750;text-transform:uppercase;letter-spacing:.05em}.irl-kpi-value{font-size:29px;font-weight:850;margin-top:5px}.irl-kpi.green .irl-kpi-value{color:var(--green)}.irl-kpi.blue .irl-kpi-value{color:#55aaff}.irl-kpi.red .irl-kpi-value{color:var(--red)}.irl-kpi.orange .irl-kpi-value{color:var(--orange)}
      .irl-progress-row{display:grid;grid-template-columns:170px 1fr 58px 150px;align-items:center;gap:12px;margin:12px 0 20px}.irl-progress-label{font-weight:750}.irl-progress{height:14px;border-radius:999px;background:#17263a;overflow:hidden}.irl-progress>div{height:100%;border-radius:inherit;background:linear-gradient(90deg,#19e58a,#20d9c6,#2783ff);transition:width .3s}.irl-progress-pct{font-weight:850;font-size:18px}.irl-progress-count{color:var(--muted);font-size:12px;text-align:right}
      .irl-grid{display:grid;grid-template-columns:1.05fr .95fr;gap:14px}.irl-card{background:var(--panel);border:1px solid var(--border);border-radius:14px;padding:17px}.irl-card-title{font-size:16px;font-weight:800;margin-bottom:14px}.irl-activity{display:flex;flex-direction:column}.irl-event{display:grid;grid-template-columns:88px 16px 1fr;gap:10px;min-height:48px}.irl-time{font-size:12px;color:#92a6c0;padding-top:2px}.irl-marker{position:relative}.irl-marker:before{content:'';position:absolute;top:4px;left:4px;width:9px;height:9px;background:var(--green);border-radius:50%;box-shadow:0 0 10px rgba(23,220,131,.55)}.irl-marker:after{content:'';position:absolute;top:14px;bottom:-5px;left:8px;width:2px;background:#185b49}.irl-event:last-child .irl-marker:after{display:none}.irl-event.active .irl-marker:before{background:var(--blue);box-shadow:0 0 0 4px rgba(39,131,255,.18),0 0 14px var(--blue)}.irl-event-title{font-size:13px;font-weight:750}.irl-event-sub{font-size:12px;color:var(--muted);margin-top:3px}
      .irl-current{display:flex;gap:14px}.irl-product-img{width:92px;height:92px;object-fit:cover;border-radius:12px;background:white}.irl-product-name{font-size:17px;font-weight:800}.irl-product-meta{font-size:12px;color:#a4b4c8;line-height:1.7}.irl-badge{display:inline-flex;margin-top:8px;background:#0f4ea8;color:#9dccff;border-radius:8px;padding:6px 9px;font-size:11px;font-weight:750}.irl-recent{grid-column:1/-1}.irl-table{width:100%;border-collapse:collapse;font-size:12px}.irl-table th{text-align:left;color:#93a5bb;font-weight:650;background:#111f32;padding:9px}.irl-table td{padding:9px;border-top:1px solid rgba(255,255,255,.05)}.irl-foot{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-top:14px;padding:10px 13px;background:#0a1422;border:1px solid var(--border);border-radius:10px;font-size:12px;color:#a4b4c8}
      @media(max-width:1050px){.irl-pipeline{grid-template-columns:repeat(3,1fr);row-gap:22px}.irl-stage:after{display:none}.irl-kpis{grid-template-columns:repeat(2,1fr)}.irl-grid{grid-template-columns:1fr}.irl-recent{grid-column:auto}.irl-progress-row{grid-template-columns:1fr 80px}.irl-progress-label,.irl-progress-count{grid-column:1/-1;text-align:left}}
    `;
    document.head.appendChild(style);
  }

  function orderedStages(run) {
    const byKey = new Map((run?.stages || []).map((stage) => [stage.key, stage]));
    return STAGE_ORDER.map((key) => byKey.get(key) || {
      key,
      status: 'PENDING',
      processed: 0,
      total: 0,
    });
  }

  function stageClass(status) {
    if (status === 'COMPLETED') return 'done';
    if (status === 'RUNNING') return 'active';
    if (status === 'FAILED') return 'failed';
    return '';
  }

  function stageDetail(stage) {
    if (stage.status === 'FAILED') {
      return stage.reason ? 'Erreur · ' + stage.reason : 'Erreur';
    }
    if (stage.status === 'PENDING') {
      return stage.reason ? 'En attente · ' + stage.reason : 'À venir';
    }
    if (stage.key === 'SOURCE_CONNECTED') {
      return stage.metrics?.provider || 'Connecté';
    }
    return num(stage.processed) + ' / ' + num(stage.total);
  }

  function renderInto(root, run) {
    if (!run) {
      root.innerHTML = `
        <div class="irl-wrap">
          <div class="irl-title">Suivi d’import — Sourcing → Catalogue</div>
          <div class="irl-sub">Aucun run identifié. Le prochain import ou replay apparaîtra ici automatiquement.</div>
        </div>`;
      return;
    }

    const accounting = run.accounting || {};
    const stages = orderedStages(run);
    const total = num(accounting.source_total);
    const processed = num(run.processed);
    const progress = run.progress_pct == null ? pct(processed, total) : num(run.progress_pct);
    const recent = Array.isArray(run.recent_items) ? run.recent_items.slice(0, 10) : [];
    const events = Array.isArray(run.events) ? run.events.slice(0, 6) : [];
    const current = run.current_item || null;
    const live = run.status === 'RUNNING';
    const currentLabel = LABELS[run.current_stage] || '—';
    const balanced = num(accounting.unaccounted) === 0 && num(accounting.overflow) === 0;

    root.innerHTML = `
      <div class="irl-wrap">
        <div class="irl-head">
          <div>
            <div class="irl-title">Run ${esc(run.run_ref)} — Sourcing → Catalogue ${live ? '<span class="irl-live">LIVE</span>' : ''}</div>
            <div class="irl-sub">${esc(run.provider || '—')} · ${esc(run.mode || 'normal')} · début ${formatTime(run.started_at)} · ${esc(STATUS_LABELS[run.status] || run.status)}${run.failure_reason ? ' · ' + esc(run.failure_reason) : ''}</div>
          </div>
          <div style="text-align:right;color:#91a4bd;font-size:12px;line-height:1.6">
            Dernière actualisation<br><strong style="color:#eef5ff">${new Date().toLocaleTimeString('fr-FR')}</strong>
          </div>
        </div>

        <div class="irl-pipeline">
          ${stages.map((stage, index) => `
            <div class="irl-stage ${stageClass(stage.status)}" data-stage="${esc(stage.key)}" data-status="${esc(stage.status)}">
              <div class="irl-dot">${stage.status === 'COMPLETED' ? '✓' : stage.status === 'FAILED' ? '!' : index + 1}</div>
              <div class="irl-stage-label">${esc(LABELS[stage.key])}</div>
              <div class="irl-stage-detail">${esc(stageDetail(stage))}</div>
            </div>`).join('')}
        </div>

        <div class="irl-kpis">
          <div class="irl-kpi blue"><div class="irl-kpi-label">Source total</div><div class="irl-kpi-value">${total}</div></div>
          <div class="irl-kpi green"><div class="irl-kpi-label">Acceptés</div><div class="irl-kpi-value">${num(accounting.accepted)}</div></div>
          <div class="irl-kpi blue"><div class="irl-kpi-label">Doublons</div><div class="irl-kpi-value">${num(accounting.duplicates)}</div></div>
          <div class="irl-kpi red"><div class="irl-kpi-label">Rejetés</div><div class="irl-kpi-value">${num(accounting.rejected)}</div></div>
          <div class="irl-kpi orange"><div class="irl-kpi-label">Quarantaine</div><div class="irl-kpi-value">${num(accounting.quarantined)}</div></div>
        </div>

        <div class="irl-progress-row">
          <div class="irl-progress-label">Progression globale</div>
          <div class="irl-progress"><div style="width:${progress}%"></div></div>
          <div class="irl-progress-pct">${progress}%</div>
          <div class="irl-progress-count">${processed} / ${total || '—'} comptabilisés</div>
        </div>

        <div class="irl-grid">
          <div class="irl-card">
            <div class="irl-card-title">◷ Activité du run</div>
            <div class="irl-activity">
              ${events.map((event, index) => `
                <div class="irl-event ${index === 0 && live ? 'active' : ''}">
                  <div class="irl-time">${formatTime(event.at)}</div>
                  <div class="irl-marker"></div>
                  <div><div class="irl-event-title">${esc(LABELS[event.stage] || event.stage)} ${event.kind === 'STAGE_FINISHED' ? 'terminé' : 'démarré'}</div></div>
                </div>`).join('') || '<div class="irl-event-sub">Aucun événement pour le moment.</div>'}
            </div>
          </div>

          <div class="irl-card">
            <div class="irl-card-title">⬡ Produit en cours</div>
            ${current ? `
              <div class="irl-current">
                ${current.image_url ? `<img class="irl-product-img" src="${esc(current.image_url)}" alt="">` : ''}
                <div>
                  <div class="irl-product-name">${esc(current.product_name || current.supplier_product_id || current.candidate_ref)}</div>
                  <div class="irl-product-meta">
                    ID source : ${esc(current.supplier_product_id || '—')}<br>
                    Catégorie : ${esc(current.komerce_category || 'À déterminer')}
                  </div>
                  <div class="irl-badge">${esc(LABELS[current.stage] || '—')}</div>
                </div>
              </div>` : '<div class="irl-event-sub">Aucun produit traité pour le moment.</div>'}
          </div>

          <div class="irl-card irl-recent">
            <div class="irl-card-title">▣ Derniers produits traités</div>
            <table class="irl-table">
              <thead><tr><th>Produit</th><th>ID source</th><th>Étape</th><th>Catégorie</th><th>Actualisé</th></tr></thead>
              <tbody>
                ${recent.map((row) => `
                  <tr>
                    <td>${esc(row.product_name || row.supplier_product_id || row.candidate_ref)}</td>
                    <td>${esc(row.supplier_product_id || '—')}</td>
                    <td>${esc(LABELS[row.stage] || '—')}</td>
                    <td>${esc(row.komerce_category || '—')}</td>
                    <td>${formatTime(row.updated_at)}</td>
                  </tr>`).join('') || '<tr><td colspan="5">Aucune donnée.</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>

        <div class="irl-foot">
          <span>Étape actuelle : <strong style="color:#eef5ff">${esc(currentLabel)}</strong></span>
          <span>UNACCOUNTED : <strong style="color:${num(accounting.unaccounted) === 0 ? '#17dc83' : '#ff4964'}">${num(accounting.unaccounted)}</strong></span>
          <span>OVERFLOW : <strong style="color:${num(accounting.overflow) === 0 ? '#17dc83' : '#ff4964'}">${num(accounting.overflow)}</strong></span>
          <span>Réconciliation : <strong style="color:${balanced ? '#17dc83' : '#ffad35'}">${balanced ? 'ÉQUILIBRÉE' : 'À VÉRIFIER'}</strong></span>
        </div>
      </div>`;
  }

  async function resolveRun() {
    const requested = new URLSearchParams(window.location.search).get('run') || selectedRunRef;
    if (requested) return KmcApi.getImportRuntimeRun(requested);

    const list = await KmcApi.getImportRuntimeRuns();
    const first = Array.isArray(list?.runs) && list.runs.length ? list.runs[0] : null;
    if (!first) return null;

    selectedRunRef = first.run_ref;
    return KmcApi.getImportRuntimeRun(first.run_ref);
  }

  async function refresh(root) {
    if (!root || !document.contains(root) || window.location.pathname !== '/admin/import-runtime') {
      if (pollHandle) clearInterval(pollHandle);
      pollHandle = null;
      return;
    }

    try {
      const run = await resolveRun();
      if (document.contains(root) && window.location.pathname === '/admin/import-runtime') {
        renderInto(root, run);
      }
    } catch (err) {
      root.innerHTML = '<div class="error-state">Suivi d’import indisponible : ' + esc(err.message) + '</div>';
    }
  }

  async function render(root) {
    injectStyles();
    mountedRoot = root;
    selectedRunRef = null;
    root.innerHTML = '<div class="loading-state"><span class="loader"></span> Chargement du suivi d’import…</div>';
    if (pollHandle) clearInterval(pollHandle);
    await refresh(root);
    pollHandle = setInterval(() => refresh(mountedRoot), POLL_MS);
  }

  global.ImportRuntimeView = { render };
})(window);

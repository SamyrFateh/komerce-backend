/**
 * @komerce-arch
 * @role          admin-import-runtime-view
 * @domain        admin-dashboard
 * @layer         ui-page
 * @criticality   medium
 * @inputs        canonical sourcing workspace projection
 * @outputs       live sourcing-to-catalogue pipeline projection
 * @depends       api-client.js
 * @used-by       public/dashboards/admin/js/app.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      kmc_api_only, dashboard_observes_server_truth
 * @impact-areas  sourcing, catalog, certification, admin-dashboard
 * @version       2026-09
 */
'use strict';

(function (global) {
  'use strict';

  const POLL_MS = 3000;
  let pollHandle = null;
  let mountedRoot = null;

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function num(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  function pct(done, total) {
    if (!total) return 0;
    return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
  }

  function latestImport(workspace) {
    return Array.isArray(workspace?.imports) && workspace.imports.length ? workspace.imports[0] : null;
  }

  function sourceTruth(workspace) {
    const sources = Array.isArray(workspace?.sources) ? workspace.sources : [];
    const connected = sources.filter(s => s.connector_ready || s.runtime_enabled || s.last_capture_status === 'recorded');
    const certified = sources.filter(s => s.production_runtime_certified === true);
    return { sources, connected, certified };
  }

  function counts(workspace) {
    const imp = latestImport(workspace);
    const candidates = Array.isArray(workspace?.candidates) ? workspace.candidates : [];
    const total = num(imp?.total_items) || num(imp?.candidates_count) || num(workspace?.summary?.candidates_total);
    const imported = num(imp?.imported_count);
    const rejected = num(imp?.rejected_count) || candidates.filter(c => c.state === 'rejected').length;
    const quarantined = num(imp?.quarantined_count);
    const scanned = candidates.filter(c => c.scan_at || c.state === 'scanned' || c.state === 'imported_to_catalog').length;
    const taxonomized = candidates.filter(c => c.komerce_category || c.scan_result?.komerce_category).length;
    const processed = Math.max(scanned, taxonomized, imported);
    const duplicateSignals = candidates.filter(c => {
      const blob = JSON.stringify([c.findings, c.promotion_reasons, c.scan_result]).toLowerCase();
      return blob.includes('duplicate') || blob.includes('doublon');
    }).length;
    return { imp, candidates, total, imported, rejected, quarantined, scanned, taxonomized, processed, duplicateSignals };
  }

  function stageState(workspace) {
    const c = counts(workspace);
    const s = sourceTruth(workspace);
    const importComplete = Boolean(c.imp && (c.imp.finished_at || ['completed','finished','done'].includes(String(c.imp.status || '').toLowerCase())));
    const sourceDone = s.connected.length > 0;
    const importDone = Boolean(c.imp && (importComplete || (c.total > 0 && num(c.imp.candidates_count) >= c.total)));
    const refineryDone = c.total > 0 && c.processed >= Math.max(1, c.total - c.rejected - c.quarantined);
    const taxonomyDone = c.total > 0 && c.taxonomized >= Math.max(1, c.total - c.rejected - c.quarantined);
    const certificationDone = s.certified.length > 0;
    const catalogueDone = c.total > 0 && c.imported >= Math.max(1, c.total - c.rejected - c.quarantined);

    const stages = [
      { key:'source', label:'Source connectée', done:sourceDone, detail: sourceDone ? (s.connected[0]?.provider || s.connected[0]?.source_name || 'Connecteur prêt') : 'En attente' },
      { key:'import', label:'Import brut', done:importDone, active:sourceDone && !importDone, detail:c.total ? c.total + ' produits' : 'En attente' },
      { key:'refinery', label:'Raffinerie', done:refineryDone, active:importDone && !refineryDone, detail:c.processed + (c.total ? ' / ' + c.total : '') },
      { key:'taxonomy', label:'Taxonomie', done:taxonomyDone, active:refineryDone && !taxonomyDone, detail:c.taxonomized + (c.total ? ' / ' + c.total : '') },
      { key:'certification', label:'Certification', done:certificationDone, active:taxonomyDone && !certificationDone, detail:certificationDone ? 'Runtime certifié' : 'À certifier' },
      { key:'catalogue', label:'Catalogue', done:catalogueDone, active:certificationDone && !catalogueDone, detail:c.imported + (c.total ? ' / ' + c.total : '') },
    ];

    if (!stages.some(x => x.active) && !catalogueDone) {
      const firstPending = stages.find(x => !x.done);
      if (firstPending) firstPending.active = true;
    }
    return { stages, counts:c, sources:s };
  }

  function injectStyles() {
    if (document.getElementById('import-runtime-live-styles')) return;
    const style = document.createElement('style');
    style.id = 'import-runtime-live-styles';
    style.textContent = `
      .irl-wrap{--irl-bg:#08111f;--irl-panel:#0d1727;--irl-panel2:#101c2e;--irl-border:#203149;--irl-text:#eef5ff;--irl-muted:#8fa3bd;--irl-blue:#2783ff;--irl-green:#17dc83;--irl-red:#ff4964;--irl-orange:#ffad35;background:var(--irl-bg);color:var(--irl-text);border-radius:18px;padding:24px;min-height:calc(100vh - 120px)}
      .irl-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;margin-bottom:22px}.irl-title{font-size:27px;font-weight:800;letter-spacing:-.02em}.irl-sub{color:var(--irl-muted);margin-top:5px}.irl-live{display:inline-flex;align-items:center;gap:8px;background:#063d2b;color:#28f29a;border-radius:999px;padding:7px 12px;font-weight:800;font-size:12px}.irl-live:before{content:'';width:9px;height:9px;border-radius:50%;background:#19e58a;box-shadow:0 0 14px #19e58a}
      .irl-pipeline{display:grid;grid-template-columns:repeat(6,1fr);gap:0;background:var(--irl-panel);border:1px solid var(--irl-border);border-radius:14px;padding:24px 18px;margin-bottom:16px}.irl-stage{position:relative;text-align:center;min-width:0}.irl-stage:not(:last-child):after{content:'';position:absolute;top:18px;left:62%;right:-38%;height:3px;background:#30425c;z-index:0}.irl-stage.done:not(:last-child):after{background:linear-gradient(90deg,var(--irl-green),#2edeb2)}.irl-dot{position:relative;z-index:1;margin:0 auto 10px;width:38px;height:38px;border-radius:50%;border:2px solid #7f93ad;background:#132033;display:flex;align-items:center;justify-content:center;font-weight:800;color:#a9b9cc}.irl-stage.done .irl-dot{border-color:var(--irl-green);background:var(--irl-green);color:#052116}.irl-stage.active .irl-dot{border-color:#3fa0ff;background:#0d4ca3;color:#fff;box-shadow:0 0 0 5px rgba(39,131,255,.18),0 0 20px rgba(39,131,255,.75)}.irl-stage-label{font-weight:750;font-size:13px}.irl-stage-detail{font-size:11px;color:var(--irl-muted);margin-top:5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.irl-stage.active .irl-stage-detail{color:#55aaff}
      .irl-kpis{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;margin-bottom:16px}.irl-kpi{background:var(--irl-panel);border:1px solid var(--irl-border);border-radius:12px;padding:16px}.irl-kpi-label{font-size:11px;color:#a9b9cc;font-weight:750;text-transform:uppercase;letter-spacing:.05em}.irl-kpi-value{font-size:29px;font-weight:850;margin-top:5px}.irl-kpi.green .irl-kpi-value{color:var(--irl-green)}.irl-kpi.blue .irl-kpi-value{color:#55aaff}.irl-kpi.red .irl-kpi-value{color:var(--irl-red)}.irl-kpi.orange .irl-kpi-value{color:var(--irl-orange)}
      .irl-progress-row{display:grid;grid-template-columns:170px 1fr 58px 150px;align-items:center;gap:12px;margin:12px 0 20px}.irl-progress-label{font-weight:750}.irl-progress{height:14px;border-radius:999px;background:#17263a;overflow:hidden}.irl-progress>div{height:100%;border-radius:inherit;background:linear-gradient(90deg,#19e58a,#20d9c6,#2783ff);transition:width .3s}.irl-progress-pct{font-weight:850;font-size:18px}.irl-progress-count{color:var(--irl-muted);font-size:12px;text-align:right}
      .irl-grid{display:grid;grid-template-columns:1.05fr .95fr;gap:14px}.irl-card{background:var(--irl-panel);border:1px solid var(--irl-border);border-radius:14px;padding:17px}.irl-card-title{font-size:16px;font-weight:800;margin-bottom:14px}.irl-activity{display:flex;flex-direction:column;gap:0}.irl-event{display:grid;grid-template-columns:88px 16px 1fr;gap:10px;min-height:48px}.irl-time{font-size:12px;color:#92a6c0;padding-top:2px}.irl-marker{position:relative}.irl-marker:before{content:'';position:absolute;top:4px;left:4px;width:9px;height:9px;background:var(--irl-green);border-radius:50%;box-shadow:0 0 10px rgba(23,220,131,.55)}.irl-marker:after{content:'';position:absolute;top:14px;bottom:-5px;left:8px;width:2px;background:#185b49}.irl-event:last-child .irl-marker:after{display:none}.irl-event.active .irl-marker:before{background:var(--irl-blue);box-shadow:0 0 0 4px rgba(39,131,255,.18),0 0 14px var(--irl-blue)}.irl-event-title{font-size:13px;font-weight:750}.irl-event.active .irl-event-title{color:#4ea3ff}.irl-event-sub{font-size:12px;color:var(--irl-muted);margin-top:3px}
      .irl-current{display:flex;gap:14px}.irl-product-img{width:92px;height:92px;object-fit:cover;border-radius:12px;background:white}.irl-product-name{font-size:17px;font-weight:800}.irl-product-meta{font-size:12px;color:#a4b4c8;line-height:1.7}.irl-badge{display:inline-flex;margin-top:8px;background:#0f4ea8;color:#9dccff;border-radius:8px;padding:6px 9px;font-size:11px;font-weight:750}.irl-recent{grid-column:1/-1}.irl-table{width:100%;border-collapse:collapse;font-size:12px}.irl-table th{text-align:left;color:#93a5bb;font-weight:650;background:#111f32;padding:9px}.irl-table td{padding:9px;border-top:1px solid rgba(255,255,255,.05)}.irl-status-ok{color:var(--irl-green)}.irl-status-wait{color:#55aaff}.irl-foot{display:flex;justify-content:space-between;gap:12px;margin-top:14px;padding:10px 13px;background:#0a1422;border:1px solid var(--irl-border);border-radius:10px;font-size:12px;color:#a4b4c8}
      @media(max-width:1050px){.irl-pipeline{grid-template-columns:repeat(3,1fr);row-gap:22px}.irl-stage:after{display:none}.irl-kpis{grid-template-columns:repeat(2,1fr)}.irl-grid{grid-template-columns:1fr}.irl-recent{grid-column:auto}.irl-progress-row{grid-template-columns:1fr 80px}.irl-progress-label,.irl-progress-count{grid-column:1/-1;text-align:left}}
    `;
    document.head.appendChild(style);
  }

  function formatTime(value) {
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
  }

  function currentCandidate(candidates) {
    return [...candidates].sort((a,b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0))[0] || null;
  }

  function currentStageLabel(candidate) {
    if (!candidate) return 'En attente';
    if (candidate.state === 'imported_to_catalog') return 'Catalogue';
    if (candidate.komerce_category) return 'Taxonomie';
    if (candidate.scan_at || candidate.state === 'scanned') return 'Raffinerie';
    return 'Import brut';
  }

  function renderInto(root, workspace) {
    const state = stageState(workspace);
    const c = state.counts;
    const active = state.stages.find(x => x.active) || state.stages[state.stages.length - 1];
    const completionBase = c.total || 0;
    const completion = completionBase ? Math.max(c.processed, c.imported) : 0;
    const progress = pct(completion, completionBase);
    const recent = [...c.candidates].sort((a,b)=>new Date(b.updated_at||0)-new Date(a.updated_at||0)).slice(0,6);
    const current = currentCandidate(c.candidates);
    const unaccounted = c.total ? Math.max(0, c.total - (c.imported + c.rejected + c.quarantined + Math.max(0, c.total - c.processed))) : 0;

    root.innerHTML = `
      <div class="irl-wrap">
        <div class="irl-head">
          <div><div class="irl-title">Suivi d’import — Sourcing → Catalogue <span class="irl-live">LIVE</span></div>
          <div class="irl-sub">Vue opérationnelle du dernier import fournisseur — vérité serveur, rafraîchie automatiquement</div></div>
          <div style="text-align:right;color:#91a4bd;font-size:12px;line-height:1.6">Dernière actualisation<br><strong style="color:#eef5ff">${new Date().toLocaleTimeString('fr-FR')}</strong></div>
        </div>

        <div class="irl-pipeline">
          ${state.stages.map((s,i)=>`<div class="irl-stage ${s.done?'done':''} ${s.active?'active':''}">
            <div class="irl-dot">${s.done?'✓':i+1}</div>
            <div class="irl-stage-label">${esc(s.label)}</div>
            <div class="irl-stage-detail">${esc(s.active?'En cours · '+s.detail:s.detail)}</div>
          </div>`).join('')}
        </div>

        <div class="irl-kpis">
          <div class="irl-kpi blue"><div class="irl-kpi-label">Source total</div><div class="irl-kpi-value">${c.total}</div></div>
          <div class="irl-kpi green"><div class="irl-kpi-label">Traités</div><div class="irl-kpi-value">${c.processed}</div></div>
          <div class="irl-kpi blue"><div class="irl-kpi-label">Doublons signalés</div><div class="irl-kpi-value">${c.duplicateSignals}</div></div>
          <div class="irl-kpi red"><div class="irl-kpi-label">Rejetés</div><div class="irl-kpi-value">${c.rejected}</div></div>
          <div class="irl-kpi orange"><div class="irl-kpi-label">Quarantaine</div><div class="irl-kpi-value">${c.quarantined}</div></div>
        </div>

        <div class="irl-progress-row">
          <div class="irl-progress-label">Progression globale</div>
          <div class="irl-progress"><div style="width:${progress}%"></div></div>
          <div class="irl-progress-pct">${progress}%</div>
          <div class="irl-progress-count">${completion} / ${completionBase || '—'} traités</div>
        </div>

        <div class="irl-grid">
          <div class="irl-card">
            <div class="irl-card-title">◷ Activité en temps réel</div>
            <div class="irl-activity">
              ${state.stages.slice().reverse().filter(s=>s.done||s.active).map(s=>`<div class="irl-event ${s.active?'active':''}">
                <div class="irl-time">${s.key==='import'?formatTime(c.imp?.imported_at):s.key==='catalogue'?formatTime(c.imp?.finished_at):'•'}</div>
                <div class="irl-marker"></div>
                <div><div class="irl-event-title">${esc(s.label)}${s.active?' en cours':' validé'}</div><div class="irl-event-sub">${esc(s.detail)}</div></div>
              </div>`).join('') || '<div class="irl-event-sub">Aucun run observé pour le moment.</div>'}
            </div>
          </div>

          <div class="irl-card">
            <div class="irl-card-title">⬡ Produit observé</div>
            ${current ? `<div class="irl-current">
              ${current.image_url?`<img class="irl-product-img" src="${esc(current.image_url)}" alt="">`:''}
              <div><div class="irl-product-name">${esc(current.product_name || current.supplier_product_id || current.candidate_ref)}</div>
              <div class="irl-product-meta">Source : ${esc(current.supplier_name || '—')}<br>ID source : ${esc(current.supplier_product_id || '—')}<br>Catégorie : ${esc(current.komerce_category || current.supplier_category || 'À déterminer')}</div>
              <div class="irl-badge">${esc(currentStageLabel(current))}</div></div>
            </div>` : '<div class="irl-event-sub">Aucun candidat récent.</div>'}
          </div>

          <div class="irl-card irl-recent">
            <div class="irl-card-title">▣ Derniers produits observés</div>
            <table class="irl-table"><thead><tr><th>Produit</th><th>Source</th><th>Étape</th><th>Statut</th><th>Actualisé</th></tr></thead>
              <tbody>${recent.map(row=>`<tr><td>${esc(row.product_name || row.supplier_product_id || row.candidate_ref)}</td><td>${esc(row.supplier_name || '—')}</td><td>${esc(currentStageLabel(row))}</td><td class="${row.state==='rejected'?'':'irl-status-ok'}">${esc(row.state || 'observé')}</td><td>${formatTime(row.updated_at)}</td></tr>`).join('') || '<tr><td colspan="5">Aucune donnée récente.</td></tr>'}</tbody>
            </table>
          </div>
        </div>

        <div class="irl-foot"><span>Étape actuelle : <strong style="color:#eef5ff">${esc(active?.label || '—')}</strong></span><span>Certification runtime : <strong style="color:${state.sources.certified.length?'#17dc83':'#ffad35'}">${state.sources.certified.length?'CERTIFIÉE':'À CERTIFIER'}</strong></span><span>Non comptabilisé : <strong style="color:#17dc83">${unaccounted}</strong></span></div>
      </div>`;
  }

  async function refresh(root) {
    if (!root || !document.contains(root) || window.location.pathname !== '/admin/import-runtime') {
      if (pollHandle) clearInterval(pollHandle);
      pollHandle = null;
      return;
    }
    try {
      const workspace = await KmcApi.getSourcingWorkspace();
      if (document.contains(root) && window.location.pathname === '/admin/import-runtime') renderInto(root, workspace);
    } catch (err) {
      root.innerHTML = '<div class="error-state">Suivi d’import indisponible : ' + esc(err.message) + '</div>';
    }
  }

  async function render(root) {
    injectStyles();
    mountedRoot = root;
    root.innerHTML = '<div class="loading-state"><span class="loader"></span> Chargement du suivi d’import…</div>';
    if (pollHandle) clearInterval(pollHandle);
    await refresh(root);
    pollHandle = setInterval(() => refresh(mountedRoot), POLL_MS);
  }

  global.ImportRuntimeView = { render };
})(window);

/**
 * @komerce-arch
 * @role          canonical-import-runtime
 * @domain        sourcing
 * @layer         ui-workspace
 * @criticality   medium
 * @inputs        /api/admin/workspaces/sourcing, /api/admin/workspaces/sourcing/import-runs*, source control actions
 * @outputs       live canonical sourcing-to-catalogue runtime
 * @depends       none
 * @used-by       public/dashboards/canonical/js/app.js
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      canonical_only, api_only, server_truth, no_legacy_import
 * @impact-areas  sourcing, catalog, certification, admin-dashboard
 * @version       2026-09-v2-source-controls
 */
'use strict';

(function initCanonicalImportRuntime(global) {
  const POLL_MS = 3000;
  const STAGES = Object.freeze([
    ['SOURCE_CONNECTED', 'Source connectée'],
    ['RAW_IMPORT', 'Import brut'],
    ['REFINERY', 'Raffinerie'],
    ['TAXONOMY', 'Taxonomie'],
    ['CERTIFICATION', 'Certification'],
    ['CATALOGUE', 'Catalogue'],
  ]);
  let timer = null;
  let mountedRoot = null;
  let selectedRunRef = null;
  let mutationBusy = false;
  let actionFeedback = null;

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function num(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  function time(value) {
    if (!value) return '—';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
  }
  async function api(path, options = {}) {
    const init = {
      method: options.method || 'GET',
      credentials:'include',
      headers:{ Accept:'application/json', ...(options.body ? { 'Content-Type':'application/json' } : {}) },
    };
    if (options.body) init.body = JSON.stringify(options.body);
    const res = await global.fetch(path, init);
    let payload = null;
    try { payload = await res.json(); } catch (_) { payload = null; }
    if (!res.ok) {
      const error = new Error(payload?.error || `HTTP ${res.status}`);
      error.code = payload?.code || null;
      error.status = res.status;
      throw error;
    }
    return payload;
  }
  function stageRows(run) {
    const map = new Map((run?.stages || []).map(stage => [stage.key, stage]));
    return STAGES.map(([key,label], index) => ({
      key, label, index,
      ...(map.get(key) || { status:'PENDING', processed:0, total:0 }),
    }));
  }
  function stageClass(status) {
    if (status === 'COMPLETED') return 'is-done';
    if (status === 'RUNNING') return 'is-live';
    if (status === 'FAILED') return 'is-failed';
    return 'is-pending';
  }
  function stageDetail(stage) {
    if (stage.status === 'FAILED') return stage.reason || 'Échec';
    if (stage.status === 'PENDING') return 'En attente';
    if (stage.key === 'SOURCE_CONNECTED') return stage.metrics?.provider || 'Connectée';
    return `${num(stage.processed)} / ${num(stage.total)}`;
  }
  function zeroRun() {
    return {
      run_ref:null, status:'IDLE', provider:null, mode:null, started_at:null, current_stage:null,
      accounting:{ source_total:0, accepted:0, duplicates:0, rejected:0, quarantined:0, deferred:0, certified:0, published:0, unaccounted:0, overflow:0 },
      stages:[], events:[], recent_items:[], current_item:null, processed:0, progress_pct:0,
    };
  }

  function sourceCanImportNow(source) {
    return Boolean(
      source?.status === 'active'
      && source?.connector_ready
      && source?.discovery_enabled
      && source?.sync_enabled
      && source?.import_enabled
    );
  }

  function sourceCanStartAutopilot(source) {
    return Boolean(
      sourceCanImportNow(source)
      && source?.runtime_enabled
      && source?.production_runtime_certified
      && source?.production_enabled
    );
  }

  function sourceControlMarkup(source, run) {
    const ref = esc(source.source_ref || '');
    const label = esc(source.label || source.supplier_name || source.adapter_type || source.source_ref || 'Source');
    const supplier = esc(source.supplier_name || source.adapter_type || 'Source API');
    const certified = Boolean(source.production_runtime_certified);
    const runningHere = Boolean(run?.status === 'RUNNING' && run?.source_ref && run.source_ref === source.source_ref);
    const importReady = sourceCanImportNow(source) && !runningHere;
    const autoOn = Boolean(source.autopilot_enabled);
    const autoReady = autoOn || sourceCanStartAutopilot(source);
    const capabilities = [
      ['discovery','Découverte','discovery_enabled'],
      ['sync','Sync','sync_enabled'],
      ['import','Import','import_enabled'],
      ['production','Production','production_enabled'],
    ];

    return `
      <article class="kir-source-card ${runningHere ? 'is-running' : ''}" data-source-ref="${ref}">
        <div class="kir-source-head">
          <div>
            <div class="kir-source-name">${label}</div>
            <div class="kir-source-sub">${supplier}</div>
          </div>
          <div class="kir-source-badges">
            <span class="kir-source-state ${source.connector_ready ? 'is-ok' : 'is-blocked'}">● ${source.connector_ready ? 'Connectée' : 'Bloquée'}</span>
            <span class="kir-source-cert ${certified ? 'is-certified' : ''}">${certified ? 'Certifiée' : 'À certifier'}</span>
          </div>
        </div>

        <div class="kir-source-switches">
          ${capabilities.map(([cap,labelText,key]) => {
            const on = Boolean(source[key]);
            const locked = cap === 'production' && !certified && !on;
            return `<button type="button"
              class="kir-switch ${on ? 'is-on' : ''}"
              role="switch"
              aria-checked="${on ? 'true' : 'false'}"
              data-source-capability="${cap}"
              data-source-ref="${ref}"
              data-current="${on ? '1' : '0'}"
              ${locked ? 'disabled title="Certification runtime requise avant Production"' : ''}>
              <i></i><span>${labelText}</span>
            </button>`;
          }).join('')}
        </div>

        <div class="kir-source-actions">
          <button type="button" class="kir-btn kir-btn-import"
            data-source-import="${ref}" ${importReady ? '' : 'disabled'}>
            ${runningHere ? 'Import en cours…' : 'Importer maintenant'}
          </button>
          <button type="button" class="kir-btn ${autoOn ? 'kir-btn-stop' : 'kir-btn-auto'}"
            data-source-autopilot="${ref}" data-current="${autoOn ? '1' : '0'}"
            ${autoReady ? '' : 'disabled'}>
            ${autoOn ? 'Arrêter autopilot' : 'Démarrer autopilot'}
          </button>
        </div>

        <div class="kir-source-foot">
          <span>${source.runtime_enabled ? 'Runtime actif' : 'Runtime autopilot OFF'}</span>
          <span>Dernier passage · ${source.last_capture_at ? time(source.last_capture_at) : 'jamais'}</span>
        </div>
      </article>`;
  }

  function sourcePanelMarkup(workspace, run) {
    const sources = Array.isArray(workspace?.sources) ? workspace.sources : [];
    return `
      <section class="kir-source-panel">
        <div class="kir-source-panel-head">
          <div>
            <h2>Sources configurées</h2>
            <p>Déclenchement opérateur, capacités autorisées et autopilot par fournisseur.</p>
          </div>
          <span>${sources.length} source${sources.length > 1 ? 's' : ''}</span>
        </div>
        ${actionFeedback ? `<div class="kir-source-feedback ${actionFeedback.ok ? 'is-ok' : 'is-error'}">${esc(actionFeedback.message)}</div>` : ''}
        <div class="kir-source-list">
          ${sources.length ? sources.map(source => sourceControlMarkup(source, run)).join('') : '<div class="kir-empty">Aucune source récurrente configurée.</div>'}
        </div>
      </section>`;
  }
  function render(root, payload, workspace = null) {
    const run = payload || zeroRun();
    const idle = !run.run_ref;
    const a = run.accounting || {};
    const stages = stageRows(run);
    const total = num(a.source_total);
    const progress = num(run.progress_pct);
    const events = Array.isArray(run.events) ? run.events.slice(0,6) : [];
    const recent = Array.isArray(run.recent_items) ? run.recent_items.slice(0,8) : [];
    const current = run.current_item || null;
    const balanced = num(a.unaccounted) === 0 && num(a.overflow) === 0;

    root.className = 'kmc-import-runtime';
    root.innerHTML = `
      <section class="kir-page">
        <header class="kir-hero">
          <div>
            <div class="kir-eyebrow">SOURCING · EXÉCUTION</div>
            <div class="kir-title-row">
              <h1>Suivi d’import</h1>
              ${run.status === 'RUNNING' ? '<span class="kir-live">● LIVE</span>' : ''}
            </div>
            <p>Source → raffinerie → taxonomie → certification → catalogue</p>
          </div>
          <div class="kir-run-meta">
            <span>RUN</span>
            <strong>${esc(run.run_ref || 'Aucun run')}</strong>
            <small>${idle ? 'Le prochain import apparaîtra ici automatiquement.' : `${esc(run.provider || '—')} · ${esc(run.mode || 'normal')} · ${time(run.started_at)}`}</small>
          </div>
        </header>

        ${sourcePanelMarkup(workspace, run)}

        <section class="kir-stage-card" aria-label="Pipeline d'import">
          ${stages.map(stage => `
            <article class="kir-stage ${stageClass(stage.status)}">
              <div class="kir-stage-track"></div>
              <div class="kir-stage-dot">${stage.status === 'COMPLETED' ? '✓' : stage.status === 'FAILED' ? '!' : stage.index + 1}</div>
              <div class="kir-stage-copy">
                <strong>${esc(stage.label)}</strong>
                <span>${esc(stageDetail(stage))}</span>
              </div>
            </article>`).join('')}
        </section>

        <section class="kir-metrics">
          ${[
            ['Source total', total, 'neutral'],
            ['Acceptés', num(a.accepted), 'good'],
            ['Doublons', num(a.duplicates), 'info'],
            ['Rejetés', num(a.rejected), 'bad'],
            ['Quarantaine', num(a.quarantined), 'warn'],
            ['Certifiés', num(a.certified), 'good'],
          ].map(([label,value,tone]) => `
            <article class="kir-metric kir-${tone}">
              <span>${label}</span><strong>${value}</strong>
            </article>`).join('')}
        </section>

        <section class="kir-progress-card">
          <div class="kir-progress-head">
            <strong>Progression globale</strong>
            <span>${progress}% · ${num(run.processed)} / ${total || 0}</span>
          </div>
          <div class="kir-progress"><i style="width:${Math.max(0,Math.min(100,progress))}%"></i></div>
        </section>

        <section class="kir-grid">
          <article class="kir-panel">
            <div class="kir-panel-head"><h2>Activité du run</h2><span>actualisé ${new Date().toLocaleTimeString('fr-FR')}</span></div>
            <div class="kir-activity">
              ${events.length ? events.map(ev => `
                <div class="kir-event">
                  <time>${time(ev.at)}</time><i></i>
                  <div><strong>${esc(STAGES.find(([key]) => key === ev.stage)?.[1] || ev.stage || 'Événement')}</strong><span>${esc(ev.kind || '')}</span></div>
                </div>`).join('') : '<div class="kir-empty">Aucune activité pour le moment.</div>'}
            </div>
          </article>

          <article class="kir-panel">
            <div class="kir-panel-head"><h2>Produit en cours</h2><span>${esc(run.current_stage || '—')}</span></div>
            ${current ? `
              <div class="kir-product">
                ${current.image_url ? `<img src="${esc(current.image_url)}" alt="">` : '<div class="kir-product-placeholder">▦</div>'}
                <div><strong>${esc(current.product_name || current.supplier_product_id || current.candidate_ref || 'Produit')}</strong>
                <span>ID source · ${esc(current.supplier_product_id || '—')}</span>
                <span>Catégorie · ${esc(current.komerce_category || 'À déterminer')}</span></div>
              </div>` : '<div class="kir-empty">Aucun produit en traitement.</div>'}
          </article>

          <article class="kir-panel kir-wide">
            <div class="kir-panel-head"><h2>Derniers produits traités</h2><span>${recent.length} affichés</span></div>
            <div class="kir-table-wrap"><table class="kir-table">
              <thead><tr><th>Produit</th><th>ID source</th><th>Étape</th><th>Catégorie</th><th>Actualisé</th></tr></thead>
              <tbody>${recent.length ? recent.map(row => `
                <tr><td>${esc(row.product_name || row.candidate_ref || '—')}</td><td>${esc(row.supplier_product_id || '—')}</td><td>${esc(STAGES.find(([key]) => key === row.stage)?.[1] || row.stage || '—')}</td><td>${esc(row.komerce_category || '—')}</td><td>${time(row.updated_at)}</td></tr>`).join('') : '<tr><td colspan="5" class="kir-empty-cell">Aucun produit traité.</td></tr>'}</tbody>
            </table></div>
          </article>
        </section>

        <footer class="kir-reconcile">
          <span>UNACCOUNTED <strong class="${num(a.unaccounted)===0?'ok':'ko'}">${num(a.unaccounted)}</strong></span>
          <span>OVERFLOW <strong class="${num(a.overflow)===0?'ok':'ko'}">${num(a.overflow)}</strong></span>
          <span>RÉCONCILIATION <strong class="${balanced?'ok':'warn'}">${balanced?'ÉQUILIBRÉE':'À VÉRIFIER'}</strong></span>
        </footer>
      </section>`;
  }

  async function resolveRun() {
    const requested = new URLSearchParams(global.location.search).get('run') || selectedRunRef;
    if (requested) return api('/api/admin/workspaces/sourcing/import-runs/' + encodeURIComponent(requested));
    const list = await api('/api/admin/workspaces/sourcing/import-runs');
    const first = Array.isArray(list?.runs) ? list.runs[0] : null;
    if (!first) return null;
    selectedRunRef = first.run_ref;
    return api('/api/admin/workspaces/sourcing/import-runs/' + encodeURIComponent(first.run_ref));
  }

  async function mutateSource(path, body, successMessage) {
    mutationBusy = true;
    actionFeedback = null;
    try {
      const result = await api(path, { method:'POST', body: body || {} });
      const runRef = result?.result?.run_ref || result?.result?.first_run?.run_ref || null;
      if (runRef) selectedRunRef = runRef;
      actionFeedback = { ok:true, message: successMessage };
      return result;
    } catch (error) {
      actionFeedback = { ok:false, message: error.message || 'Action refusée' };
      throw error;
    } finally {
      mutationBusy = false;
      await refresh();
    }
  }

  function bindSourceControls(root) {
    root.querySelectorAll('[data-source-capability]').forEach(button => {
      button.addEventListener('click', async () => {
        const ref = button.getAttribute('data-source-ref');
        const capability = button.getAttribute('data-source-capability');
        const enabled = button.getAttribute('data-current') !== '1';
        button.disabled = true;
        try {
          await mutateSource(
            '/api/admin/workspaces/sourcing/sources/' + encodeURIComponent(ref) + '/capabilities/' + encodeURIComponent(capability),
            { enabled, reason:'Pilotage depuis Import live' },
            `${capability} ${enabled ? 'activé' : 'désactivé'} pour la source.`
          );
        } catch (_) {}
      });
    });

    root.querySelectorAll('[data-source-import]').forEach(button => {
      button.addEventListener('click', async () => {
        const ref = button.getAttribute('data-source-import');
        button.disabled = true;
        button.textContent = 'Démarrage…';
        try {
          await mutateSource(
            '/api/admin/workspaces/sourcing/sources/' + encodeURIComponent(ref) + '/import-now',
            {},
            'Import opérateur lancé. Le run apparaît dans le pipeline live.'
          );
        } catch (_) {}
      });
    });

    root.querySelectorAll('[data-source-autopilot]').forEach(button => {
      button.addEventListener('click', async () => {
        const ref = button.getAttribute('data-source-autopilot');
        const active = button.getAttribute('data-current') === '1';
        button.disabled = true;
        try {
          await mutateSource(
            '/api/admin/workspaces/sourcing/sources/' + encodeURIComponent(ref) + '/' + (active ? 'deactivate' : 'activate'),
            {},
            active ? 'Autopilot arrêté pour cette source.' : 'Autopilot démarré pour cette source.'
          );
        } catch (_) {}
      });
    });
  }

  async function refresh() {
    if (!mountedRoot || !document.contains(mountedRoot) || global.location.pathname !== '/admin/import-runtime') {
      if (timer) clearInterval(timer);
      timer = null;
      return;
    }
    if (mutationBusy) return;
    try {
      const [run, workspace] = await Promise.all([
        resolveRun(),
        api('/api/admin/workspaces/sourcing'),
      ]);
      render(mountedRoot, run, workspace);
      bindSourceControls(mountedRoot);
    } catch (error) {
      mountedRoot.innerHTML = '<div class="kir-error">Suivi indisponible · ' + esc(error.message) + '</div>';
    }
  }

  async function mount(options = {}) {
    if (!options.root) throw new Error('canonical_import_runtime_root_missing');
    mountedRoot = options.root;
    selectedRunRef = null;
    render(mountedRoot, null, { sources:[] });
    if (timer) clearInterval(timer);
    await refresh();
    timer = setInterval(refresh, POLL_MS);
  }

  global.KomerceCanonicalImportRuntime = Object.freeze({ mount, render, sourceCanImportNow, sourceCanStartAutopilot });
})(typeof window !== 'undefined' ? window : globalThis);

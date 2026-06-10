/**
 * KOMERCE Dashboard — SimulatorView /admin/simulator
 * ════════════════════════════════════════════════════════════════════════
 * Migration de CT.views.simulator (ct-views-simulator.js v2)
 *
 * 14 scénarios (3 catégories) + contrôles start/stop/cleanup/journal
 *
 * API : KmcApi.simStatus() / simStart(config) / simStop() /
 *       simCleanup() / simJournal()
 */

(function (global) {
  'use strict';

  /* ── Styles ─────────────────────────────────────────────────────────── */
  function _injectStyles() {
    if (document.getElementById('simv-styles')) return;
    const s = document.createElement('style');
    s.id = 'simv-styles';
    s.textContent = `
      .simv-header{margin-bottom:20px}
      .simv-header h2{font-size:22px;font-weight:800;color:var(--text-primary)}
      .simv-header p{color:var(--text-secondary);font-size:13px;margin-top:4px}
      .simv-banner{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;border-radius:12px;padding:14px 20px;margin-bottom:20px;border:2px solid transparent}
      .simv-banner.running{background:#dcfce7;border-color:#86efac}
      .simv-banner.stopped{background:var(--bg-secondary);border-color:var(--border)}
      .simv-banner-left{display:flex;align-items:center;gap:10px}
      .simv-banner-status{font-size:15px;font-weight:700}
      .simv-banner-status.running{color:#16a34a}
      .simv-banner-status.stopped{color:var(--text-secondary)}
      .simv-banner-meta{font-size:var(--fs-sm);color:var(--text-secondary);margin-top:2px}
      .simv-banner-actions{display:flex;gap:8px}
      .simv-section{background:var(--bg-card);border-radius:12px;padding:16px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.06)}
      .simv-section h3{font-size:14px;font-weight:700;color:var(--text-primary);margin-bottom:12px}
      .simv-config-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px}
      .simv-config-grid label{font-size:var(--fs-xs);color:var(--text-secondary);display:block;margin-bottom:4px;font-weight:600}
      .simv-config-grid input{width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;background:var(--bg-card);color:var(--text-primary);font-family:inherit;box-sizing:border-box}
      .simv-config-grid input:focus{border-color:#3b82f6;outline:none}
      .simv-hint{font-size:var(--fs-xs);color:var(--text-secondary);margin-top:2px}
      .simv-scen-group{border-radius:8px;padding:10px 12px;margin-bottom:8px}
      .simv-scen-group-title{font-size:var(--fs-sm);font-weight:700;margin-bottom:6px}
      .simv-scen-list{display:flex;flex-wrap:wrap;gap:4px}
      .simv-scen-list label{display:flex;align-items:center;gap:4px;background:var(--bg-card);padding:var(--sp-1) var(--sp-3);border-radius:6px;font-size:var(--fs-sm);cursor:pointer;min-width:140px;border:1px solid var(--border)}
      .simv-scen-list label:hover{background:var(--bg-secondary)}
      .simv-presets{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
      .simv-kpi-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px;margin-bottom:20px}
      .simv-kpi{background:var(--bg-card);border-radius:12px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,.08);text-align:center}
      .simv-kpi .num{font-size:26px;font-weight:700;color:var(--text-primary)}
      .simv-kpi .lbl{font-size:var(--fs-xs);color:var(--text-secondary);margin-top:4px}
      .simv-kpi.green .num{color:#16a34a}
      .simv-kpi.red .num{color:#dc2626}
      .simv-kpi.purple .num{color:#7c3aed}
      .simv-kpi.amber .num{color:#d97706}
      .simv-table{width:100%;border-collapse:collapse;font-size:13px;margin-top:8px}
      .simv-table th{text-align:left;padding:8px;border-bottom:2px solid var(--border);font-size:var(--fs-xs);color:var(--text-secondary);text-transform:uppercase}
      .simv-table td{padding:8px;border-bottom:1px solid var(--border)}
      .simv-table tr:last-child td{border-bottom:none}
      .simv-journal{font-family:ui-monospace,SFMono-Regular,monospace;font-size:var(--fs-xs);max-height:400px;overflow-y:auto;background:#0f172a;color:#e2e8f0;border-radius:8px;padding:12px;margin-top:8px}
      .simv-journal .jline{margin-bottom:3px}
      .simv-journal .jline.ok{color:#4ade80}
      .simv-journal .jline.err{color:#f87171}
      .simv-journal .jline.chaos{color:#fbbf24}
      .simv-journal .jline.tick{color:#a78bfa}
      .simv-journal .jline.meta{color:#94a3b8}
      .simv-warning-banner{background:#fef3c7;border:1px solid #fde68a;border-radius:8px;padding:12px 16px;font-size:13px;color:#92400e;margin-bottom:16px}

      /* Boutons réutilisés */
      .simv-btn{padding:8px 16px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;border:none;font-family:inherit;transition:all .15s}
      .simv-btn:disabled{opacity:.5;cursor:not-allowed}
      .simv-btn-primary{background:#3b82f6;color:#fff}
      .simv-btn-primary:hover:not(:disabled){background:#2563eb}
      .simv-btn-danger{background:#ef4444;color:#fff}
      .simv-btn-danger:hover:not(:disabled){background:#dc2626}
      .simv-btn-ghost{background:var(--bg-secondary);color:var(--text-secondary);border:1px solid var(--border)}
      .simv-btn-ghost:hover:not(:disabled){background:var(--border)}
      .simv-btn-amber{background:#f59e0b;color:#fff}
      .simv-btn-amber:hover:not(:disabled){background:#d97706}
    `;
    document.head.appendChild(s);
  }

  /* ── Constantes scénarios ────────────────────────────────────────────── */
  const SCENARIOS = [
    { group: '🟢 Flux normal', bg: '#dcfce7', color: '#16a34a', items: [
      { key: 'nominal',     icon: '✅', label: 'Nominal (complet)',  checked: true,  desc: 'pending → collected' },
      { key: 'express',     icon: '⚡', label: 'Express',            checked: false, desc: 'Tout en accéléré' },
    ]},
    { group: '🟡 Retards & complications', bg: '#fef9c3', color: '#ca8a04', items: [
      { key: 'late_cash',       icon: '💰', label: 'Cash tardif',        checked: true,  desc: 'Paiement retardé' },
      { key: 'customs_delay',   icon: '🛃', label: 'Retard douane',       checked: false, desc: 'Bloqué douane Moroni' },
      { key: 'partial_delivery',icon: '📦', label: 'Livraison partielle', checked: false, desc: 'Multi-colis, un en retard' },
      { key: 'wrong_relais',    icon: '📍', label: 'Mauvais relais',      checked: false, desc: 'Redirection nécessaire' },
      { key: 'backorder',       icon: '🕐', label: 'Rupture stock',       checked: false, desc: 'Réappro puis livraison' },
    ]},
    { group: '🔴 Échecs & litiges', bg: '#fee2e2', color: '#dc2626', items: [
      { key: 'abandoned',       icon: '⏳', label: 'Abandonné',           checked: true,  desc: 'Jamais payé' },
      { key: 'cancelled',       icon: '❌', label: 'Annulé',              checked: true,  desc: 'Annulation avant paiement' },
      { key: 'stuck',           icon: '🔒', label: 'Bloqué',              checked: false, desc: 'Bloqué en préparation' },
      { key: 'uncollected',     icon: '📦', label: 'Non collecté',        checked: false, desc: 'Jamais récupéré' },
      { key: 'damaged',         icon: '💔', label: 'Endommagé',           checked: false, desc: 'Colis cassé en transit' },
      { key: 'return_refund',   icon: '🔄', label: 'Retour/Rembours.',    checked: false, desc: 'Livré puis retourné' },
      { key: 'payment_dispute', icon: '⚖️', label: 'Litige paiement',     checked: false, desc: 'Client conteste' },
    ]},
  ];
  const ALL_SCENARIO_KEYS = SCENARIOS.flatMap(g => g.items.map(i => i.key));
  const SCENARIO_ICONS = Object.fromEntries(SCENARIOS.flatMap(g => g.items.map(i => [i.key, i.icon])));

  /* ── Helpers ────────────────────────────────────────────────────────── */
  function _esc(s) {
    return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function _renderJournal(entries) {
    if (!entries || !entries.length) return '<div style="color:#94a3b8">Aucune entrée.</div>';
    return entries.map(e => {
      let cls = 'meta';
      if (e.success === false)                                   cls = 'err';
      else if (e.success === true)                               cls = 'ok';
      if (e.message && e.message.includes('🎲'))                cls = 'chaos';
      if (e.message && e.message.includes('═══'))               cls = 'tick';
      return `<div class="jline ${cls}"><span style="color:#94a3b8">[${e.time||''}]</span> ${e.ref?`<strong>${_esc(e.ref)}</strong> `:''}`
           + `${e.scenario?`<span style="color:#a78bfa">${_esc(e.scenario)}</span> `:''}${_esc(e.message||'')}</div>`;
    }).join('');
  }

  function _setPreset(keys, chaosVal) {
    document.querySelectorAll('.simv-cb').forEach(cb => { cb.checked = keys.includes(cb.value); });
    const ci = document.getElementById('simv-chaos');
    if (ci) ci.value = chaosVal;
  }

  /* ── Rendu ──────────────────────────────────────────────────────────── */
  async function _render(root) {
    let status;
    try {
      status = await global.KmcApi.simStatus().catch(() => ({
        running: false, tick_count: 0, orders_tracked: 0, available_scenarios: null,
      }));
    } catch (_) {
      status = { running: false, tick_count: 0, orders_tracked: 0 };
    }

    const running = !!status.running;

    let html = `
      <div class="simv-header">
        <h2>🤖 Simulateur métier</h2>
        <p>Faire avancer les commandes automatiquement à travers le flux complet</p>
      </div>
      <div class="simv-banner ${running?'running':'stopped'}">
        <div class="simv-banner-left">
          <span style="font-size:22px">${running?'🟢':'⚪'}</span>
          <div>
            <div class="simv-banner-status ${running?'running':'stopped'}">${running?'Simulation en cours':'Simulation arrêtée'}</div>
            ${running?`<div class="simv-banner-meta">Tick #${status.tick_count||0} · ${status.orders_tracked||0} commandes suivies · cadence ${status.config?.cadence_minutes||3} min · chaos ${((status.config?.chaos_level||0)*100).toFixed(0)}%</div>`:''}
          </div>
        </div>
        <div class="simv-banner-actions">
          ${!running ? '<button class="simv-btn simv-btn-primary" id="simv-start">▶️ Démarrer</button>' : '<button class="simv-btn simv-btn-danger" id="simv-stop">⏹️ Arrêter</button>'}
          <button class="simv-btn simv-btn-ghost" id="simv-refresh" title="Actualiser">🔄</button>
        </div>
      </div>`;

    /* ── Config (arrêté seulement) ── */
    if (!running) {
      html += `
        <div class="simv-section" style="border-left:4px solid #3b82f6">
          <h3>⚙️ Configuration</h3>
          <div class="simv-config-grid">
            <div>
              <label>Cadence (minutes)</label>
              <input type="number" id="simv-cadence" value="3" min="1" max="30">
            </div>
            <div>
              <label>Max commandes</label>
              <input type="number" id="simv-max" value="20" min="1" max="100">
            </div>
            <div>
              <label>Chaos (0 → 1)</label>
              <input type="number" id="simv-chaos" value="0.2" min="0" max="1" step="0.05">
              <div class="simv-hint">0 = stable · 0.3 = modéré · 0.7+ = chaos total</div>
            </div>
          </div>

          <div style="margin-top:16px">
            <div style="font-size:var(--fs-sm);color:var(--text-secondary);font-weight:600;margin-bottom:8px">Scénarios actifs</div>
            ${SCENARIOS.map(g => `
              <div class="simv-scen-group" style="background:${g.bg};border:1px solid ${g.color}33;margin-bottom:8px">
                <div class="simv-scen-group-title" style="color:${g.color}">${g.group}</div>
                <div class="simv-scen-list">
                  ${g.items.map(i => `
                    <label title="${_esc(i.desc)}">
                      <input type="checkbox" class="simv-cb" value="${i.key}"${i.checked?' checked':''}>
                      ${i.icon} ${_esc(i.label)}
                    </label>`).join('')}
                </div>
              </div>`).join('')}
          </div>

          <div class="simv-presets">
            <button class="simv-btn simv-btn-ghost" id="simv-preset-minimal" style="font-size:var(--fs-sm)">🟢 Minimal</button>
            <button class="simv-btn simv-btn-ghost" id="simv-preset-realistic" style="font-size:var(--fs-sm)">🟡 Réaliste</button>
            <button class="simv-btn simv-btn-ghost" id="simv-preset-chaos" style="font-size:var(--fs-sm)">🔴 Chaos total</button>
          </div>
        </div>`;
    }

    /* ── KPIs ── */
    if (status.tick_count > 0 || running) {
      const st = status.stats || {};
      html += `<div class="simv-kpi-grid">
        <div class="simv-kpi"><div class="num">${status.orders_tracked||0}</div><div class="lbl">Commandes suivies</div></div>
        <div class="simv-kpi purple"><div class="num">${status.tick_count||0}</div><div class="lbl">Ticks exécutés</div></div>
        <div class="simv-kpi green"><div class="num">${st.transitions_ok||0}</div><div class="lbl">Transitions OK</div></div>
        <div class="simv-kpi ${(st.errors||0)>0?'red':'green'}"><div class="num">${st.errors||0}</div><div class="lbl">Erreurs</div></div>
        <div class="simv-kpi green"><div class="num">${st.completed||0}</div><div class="lbl">Terminées</div></div>
        <div class="simv-kpi amber"><div class="num">${st.chaos_events||0}</div><div class="lbl">Chaos injectés</div></div>
      </div>`;

      if (st.scenarioBreakdown && Object.keys(st.scenarioBreakdown).length > 0) {
        html += `
          <div class="simv-section">
            <h3>📊 Répartition par scénario</h3>
            <table class="simv-table">
              <thead><tr><th>Scénario</th><th>Total</th><th>Terminées</th><th>Erreurs</th><th>Chaos</th></tr></thead>
              <tbody>
                ${Object.entries(st.scenarioBreakdown).map(([name, sd]) => {
                  const pct = sd.total > 0 ? Math.round(sd.completed / sd.total * 100) : 0;
                  return `<tr>
                    <td>${SCENARIO_ICONS[name]||'•'} ${name}</td>
                    <td>${sd.total}</td>
                    <td>${sd.completed} <span style="color:var(--text-secondary)">(${pct}%)</span></td>
                    <td style="color:${sd.errors>0?'#ef4444':'#16a34a'}">${sd.errors}</td>
                    <td style="color:#f59e0b">${sd.chaos}</td>
                  </tr>`;
                }).join('')}
              </tbody>
            </table>
          </div>`;
      }
    }

    /* ── Journal ── */
    html += `
      <div class="simv-section">
        <h3 style="display:flex;align-items:center;justify-content:space-between">
          📋 Journal
          <button class="simv-btn simv-btn-ghost" style="font-size:var(--fs-sm)" id="simv-journal-load">Charger tout</button>
        </h3>
        <div class="simv-journal" id="simv-journal">
          ${status.recent_journal && status.recent_journal.length ? _renderJournal(status.recent_journal) : '<span style="color:#94a3b8">Aucune entrée.</span>'}
        </div>
      </div>`;

    /* ── Cleanup ── */
    html += `
      <div class="simv-section" style="border-left:4px solid #f59e0b">
        <h3>🧹 Nettoyage</h3>
        <p style="font-size:13px;color:var(--text-secondary);margin-bottom:12px">Supprimer toutes les données de simulation (commandes test, colis, scans).</p>
        <button class="simv-btn simv-btn-amber" id="simv-cleanup">🧹 Nettoyer données test</button>
      </div>`;

    root.innerHTML = html;
    _wireButtons(root, running);
  }

  function _wireButtons(root, running) {
    const startBtn   = document.getElementById('simv-start');
    const stopBtn    = document.getElementById('simv-stop');
    const refreshBtn = document.getElementById('simv-refresh');
    const cleanupBtn = document.getElementById('simv-cleanup');
    const journalBtn = document.getElementById('simv-journal-load');
    const presetMin  = document.getElementById('simv-preset-minimal');
    const presetReal = document.getElementById('simv-preset-realistic');
    const presetChaos= document.getElementById('simv-preset-chaos');

    if (presetMin) presetMin.addEventListener('click', () => _setPreset(['nominal','express'], 0.05));
    if (presetReal) presetReal.addEventListener('click', () =>
      _setPreset(['nominal','express','late_cash','customs_delay','abandoned','cancelled','partial_delivery','backorder'], 0.2));
    if (presetChaos) presetChaos.addEventListener('click', () => _setPreset(ALL_SCENARIO_KEYS, 0.7));

    if (startBtn) {
      startBtn.addEventListener('click', async () => {
        const scenarios = Array.from(document.querySelectorAll('.simv-cb:checked')).map(cb => cb.value);
        if (!scenarios.length) { alert('⚠️ Sélectionnez au moins un scénario'); return; }
        const config = {
          cadence_minutes: parseInt(document.getElementById('simv-cadence').value) || 3,
          max_orders:      parseInt(document.getElementById('simv-max').value) || 20,
          chaos_level:     parseFloat(document.getElementById('simv-chaos').value) || 0.1,
          scenarios,
        };
        startBtn.disabled = true; startBtn.textContent = '⏳ Démarrage…';
        try {
          await global.KmcApi.simStart(config);
          await _render(root);
        } catch (e) { alert('❌ ' + e.message); startBtn.disabled = false; startBtn.textContent = '▶️ Démarrer'; }
      });
    }

    if (stopBtn) {
      stopBtn.addEventListener('click', async () => {
        stopBtn.disabled = true; stopBtn.textContent = '⏳ Arrêt…';
        try {
          await global.KmcApi.simStop();
          await _render(root);
        } catch (e) { alert('❌ ' + e.message); }
      });
    }

    if (refreshBtn) refreshBtn.addEventListener('click', () => _render(root));

    if (cleanupBtn) {
      cleanupBtn.addEventListener('click', async () => {
        if (!confirm('🧹 Supprimer toutes les données de test ?')) return;
        cleanupBtn.disabled = true; cleanupBtn.textContent = '⏳ Nettoyage…';
        try {
          const r = await global.KmcApi.simCleanup();
          alert('✅ ' + (r.message || 'Nettoyage terminé'));
          await _render(root);
        } catch (e) { alert('❌ ' + e.message); cleanupBtn.disabled = false; cleanupBtn.textContent = '🧹 Nettoyer données test'; }
      });
    }

    if (journalBtn) {
      journalBtn.addEventListener('click', async () => {
        journalBtn.disabled = true; journalBtn.textContent = '⏳ Chargement…';
        try {
          const j = await global.KmcApi.simJournal();
          const el = document.getElementById('simv-journal');
          el.innerHTML = j.entries && j.entries.length ? _renderJournal(j.entries) : '<span style="color:#94a3b8">Journal vide.</span>';
        } catch (e) { alert('❌ ' + e.message); }
        journalBtn.disabled = false; journalBtn.textContent = 'Charger tout';
      });
    }
  }

  /* ── Point d'entrée ─────────────────────────────────────────────────── */
  global.SimulatorView = async function render(root) {
    _injectStyles();
    root.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-secondary)">🤖 Chargement simulateur…</div>';
    await _render(root);
  };

})(window);


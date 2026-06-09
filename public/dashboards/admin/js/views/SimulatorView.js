/**
 * KOMERCE Dashboard â€” SimulatorView /admin/simulator
 * â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
 * Migration de CT.views.simulator (ct-views-simulator.js v2)
 *
 * 14 scÃ©narios (3 catÃ©gories) + contrÃ´les start/stop/cleanup/journal
 *
 * API : KmcApi.simStatus() / simStart(config) / simStop() /
 *       simCleanup() / simJournal()
 */

(function (global) {
  'use strict';

  /* â”€â”€ Styles â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
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
      .simv-banner-meta{font-size:12px;color:var(--text-secondary);margin-top:2px}
      .simv-banner-actions{display:flex;gap:8px}
      .simv-section{background:var(--bg-card);border-radius:12px;padding:16px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.06)}
      .simv-section h3{font-size:14px;font-weight:700;color:var(--text-primary);margin-bottom:12px}
      .simv-config-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px}
      .simv-config-grid label{font-size:11px;color:var(--text-secondary);display:block;margin-bottom:4px;font-weight:600}
      .simv-config-grid input{width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;background:var(--bg-card);color:var(--text-primary);font-family:inherit;box-sizing:border-box}
      .simv-config-grid input:focus{border-color:#3b82f6;outline:none}
      .simv-hint{font-size:10px;color:var(--text-secondary);margin-top:2px}
      .simv-scen-group{border-radius:8px;padding:10px 12px;margin-bottom:8px}
      .simv-scen-group-title{font-size:12px;font-weight:700;margin-bottom:6px}
      .simv-scen-list{display:flex;flex-wrap:wrap;gap:4px}
      .simv-scen-list label{display:flex;align-items:center;gap:4px;background:var(--bg-card);padding:4px 9px;border-radius:6px;font-size:12px;cursor:pointer;min-width:140px;border:1px solid var(--border)}
      .simv-scen-list label:hover{background:var(--bg-secondary)}
      .simv-presets{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
      .simv-kpi-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px;margin-bottom:20px}
      .simv-kpi{background:var(--bg-card);border-radius:12px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,.08);text-align:center}
      .simv-kpi .num{font-size:26px;font-weight:700;color:var(--text-primary)}
      .simv-kpi .lbl{font-size:11px;color:var(--text-secondary);margin-top:4px}
      .simv-kpi.green .num{color:#16a34a}
      .simv-kpi.red .num{color:#dc2626}
      .simv-kpi.purple .num{color:#7c3aed}
      .simv-kpi.amber .num{color:#d97706}
      .simv-table{width:100%;border-collapse:collapse;font-size:13px;margin-top:8px}
      .simv-table th{text-align:left;padding:8px;border-bottom:2px solid var(--border);font-size:11px;color:var(--text-secondary);text-transform:uppercase}
      .simv-table td{padding:8px;border-bottom:1px solid var(--border)}
      .simv-table tr:last-child td{border-bottom:none}
      .simv-journal{font-family:ui-monospace,SFMono-Regular,monospace;font-size:11px;max-height:400px;overflow-y:auto;background:#0f172a;color:#e2e8f0;border-radius:8px;padding:12px;margin-top:8px}
      .simv-journal .jline{margin-bottom:3px}
      .simv-journal .jline.ok{color:#4ade80}
      .simv-journal .jline.err{color:#f87171}
      .simv-journal .jline.chaos{color:#fbbf24}
      .simv-journal .jline.tick{color:#a78bfa}
      .simv-journal .jline.meta{color:#94a3b8}
      .simv-warning-banner{background:#fef3c7;border:1px solid #fde68a;border-radius:8px;padding:12px 16px;font-size:13px;color:#92400e;margin-bottom:16px}

      /* Boutons rÃ©utilisÃ©s */
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

  /* â”€â”€ Constantes scÃ©narios â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
  const SCENARIOS = [
    { group: 'ðŸŸ¢ Flux normal', bg: '#dcfce7', color: '#16a34a', items: [
      { key: 'nominal',     icon: 'âœ…', label: 'Nominal (complet)',  checked: true,  desc: 'pending â†’ collected' },
      { key: 'express',     icon: 'âš¡', label: 'Express',            checked: false, desc: 'Tout en accÃ©lÃ©rÃ©' },
    ]},
    { group: 'ðŸŸ¡ Retards & complications', bg: '#fef9c3', color: '#ca8a04', items: [
      { key: 'late_cash',       icon: 'ðŸ’°', label: 'Cash tardif',        checked: true,  desc: 'Paiement retardÃ©' },
      { key: 'customs_delay',   icon: 'ðŸ›ƒ', label: 'Retard douane',       checked: false, desc: 'BloquÃ© douane Moroni' },
      { key: 'partial_delivery',icon: 'ðŸ“¦', label: 'Livraison partielle', checked: false, desc: 'Multi-colis, un en retard' },
      { key: 'wrong_relais',    icon: 'ðŸ“', label: 'Mauvais relais',      checked: false, desc: 'Redirection nÃ©cessaire' },
      { key: 'backorder',       icon: 'ðŸ•', label: 'Rupture stock',       checked: false, desc: 'RÃ©appro puis livraison' },
    ]},
    { group: 'ðŸ”´ Ã‰checs & litiges', bg: '#fee2e2', color: '#dc2626', items: [
      { key: 'abandoned',       icon: 'â³', label: 'AbandonnÃ©',           checked: true,  desc: 'Jamais payÃ©' },
      { key: 'cancelled',       icon: 'âŒ', label: 'AnnulÃ©',              checked: true,  desc: 'Annulation avant paiement' },
      { key: 'stuck',           icon: 'ðŸ”’', label: 'BloquÃ©',              checked: false, desc: 'BloquÃ© en prÃ©paration' },
      { key: 'uncollected',     icon: 'ðŸ“¦', label: 'Non collectÃ©',        checked: false, desc: 'Jamais rÃ©cupÃ©rÃ©' },
      { key: 'damaged',         icon: 'ðŸ’”', label: 'EndommagÃ©',           checked: false, desc: 'Colis cassÃ© en transit' },
      { key: 'return_refund',   icon: 'ðŸ”„', label: 'Retour/Rembours.',    checked: false, desc: 'LivrÃ© puis retournÃ©' },
      { key: 'payment_dispute', icon: 'âš–ï¸', label: 'Litige paiement',     checked: false, desc: 'Client conteste' },
    ]},
  ];
  const ALL_SCENARIO_KEYS = SCENARIOS.flatMap(g => g.items.map(i => i.key));
  const SCENARIO_ICONS = Object.fromEntries(SCENARIOS.flatMap(g => g.items.map(i => [i.key, i.icon])));

  /* â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
  function _esc(s) {
    return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function _renderJournal(entries) {
    if (!entries || !entries.length) return '<div style="color:#94a3b8">Aucune entrÃ©e.</div>';
    return entries.map(e => {
      let cls = 'meta';
      if (e.success === false)                                   cls = 'err';
      else if (e.success === true)                               cls = 'ok';
      if (e.message && e.message.includes('ðŸŽ²'))                cls = 'chaos';
      if (e.message && e.message.includes('â•â•â•'))               cls = 'tick';
      return `<div class="jline ${cls}"><span style="color:#94a3b8">[${e.time||''}]</span> ${e.ref?`<strong>${_esc(e.ref)}</strong> `:''}`
           + `${e.scenario?`<span style="color:#a78bfa">${_esc(e.scenario)}</span> `:''}${_esc(e.message||'')}</div>`;
    }).join('');
  }

  function _setPreset(keys, chaosVal) {
    document.querySelectorAll('.simv-cb').forEach(cb => { cb.checked = keys.includes(cb.value); });
    const ci = document.getElementById('simv-chaos');
    if (ci) ci.value = chaosVal;
  }

  /* â”€â”€ Rendu â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
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
        <h2>ðŸ¤– Simulateur mÃ©tier</h2>
        <p>Faire avancer les commandes automatiquement Ã  travers le flux complet</p>
      </div>
      <div class="simv-banner ${running?'running':'stopped'}">
        <div class="simv-banner-left">
          <span style="font-size:22px">${running?'ðŸŸ¢':'âšª'}</span>
          <div>
            <div class="simv-banner-status ${running?'running':'stopped'}">${running?'Simulation en cours':'Simulation arrÃªtÃ©e'}</div>
            ${running?`<div class="simv-banner-meta">Tick #${status.tick_count||0} Â· ${status.orders_tracked||0} commandes suivies Â· cadence ${status.config?.cadence_minutes||3} min Â· chaos ${((status.config?.chaos_level||0)*100).toFixed(0)}%</div>`:''}
          </div>
        </div>
        <div class="simv-banner-actions">
          ${!running ? '<button class="simv-btn simv-btn-primary" id="simv-start">â–¶ï¸ DÃ©marrer</button>' : '<button class="simv-btn simv-btn-danger" id="simv-stop">â¹ï¸ ArrÃªter</button>'}
          <button class="simv-btn simv-btn-ghost" id="simv-refresh" title="Actualiser">ðŸ”„</button>
        </div>
      </div>`;

    /* â”€â”€ Config (arrÃªtÃ© seulement) â”€â”€ */
    if (!running) {
      html += `
        <div class="simv-section" style="border-left:4px solid #3b82f6">
          <h3>âš™ï¸ Configuration</h3>
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
              <label>Chaos (0 â†’ 1)</label>
              <input type="number" id="simv-chaos" value="0.2" min="0" max="1" step="0.05">
              <div class="simv-hint">0 = stable Â· 0.3 = modÃ©rÃ© Â· 0.7+ = chaos total</div>
            </div>
          </div>

          <div style="margin-top:16px">
            <div style="font-size:12px;color:var(--text-secondary);font-weight:600;margin-bottom:8px">ScÃ©narios actifs</div>
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
            <button class="simv-btn simv-btn-ghost" id="simv-preset-minimal" style="font-size:12px">ðŸŸ¢ Minimal</button>
            <button class="simv-btn simv-btn-ghost" id="simv-preset-realistic" style="font-size:12px">ðŸŸ¡ RÃ©aliste</button>
            <button class="simv-btn simv-btn-ghost" id="simv-preset-chaos" style="font-size:12px">ðŸ”´ Chaos total</button>
          </div>
        </div>`;
    }

    /* â”€â”€ KPIs â”€â”€ */
    if (status.tick_count > 0 || running) {
      const st = status.stats || {};
      html += `<div class="simv-kpi-grid">
        <div class="simv-kpi"><div class="num">${status.orders_tracked||0}</div><div class="lbl">Commandes suivies</div></div>
        <div class="simv-kpi purple"><div class="num">${status.tick_count||0}</div><div class="lbl">Ticks exÃ©cutÃ©s</div></div>
        <div class="simv-kpi green"><div class="num">${st.transitions_ok||0}</div><div class="lbl">Transitions OK</div></div>
        <div class="simv-kpi ${(st.errors||0)>0?'red':'green'}"><div class="num">${st.errors||0}</div><div class="lbl">Erreurs</div></div>
        <div class="simv-kpi green"><div class="num">${st.completed||0}</div><div class="lbl">TerminÃ©es</div></div>
        <div class="simv-kpi amber"><div class="num">${st.chaos_events||0}</div><div class="lbl">Chaos injectÃ©s</div></div>
      </div>`;

      if (st.scenarioBreakdown && Object.keys(st.scenarioBreakdown).length > 0) {
        html += `
          <div class="simv-section">
            <h3>ðŸ“Š RÃ©partition par scÃ©nario</h3>
            <table class="simv-table">
              <thead><tr><th>ScÃ©nario</th><th>Total</th><th>TerminÃ©es</th><th>Erreurs</th><th>Chaos</th></tr></thead>
              <tbody>
                ${Object.entries(st.scenarioBreakdown).map(([name, sd]) => {
                  const pct = sd.total > 0 ? Math.round(sd.completed / sd.total * 100) : 0;
                  return `<tr>
                    <td>${SCENARIO_ICONS[name]||'â€¢'} ${name}</td>
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

    /* â”€â”€ Journal â”€â”€ */
    html += `
      <div class="simv-section">
        <h3 style="display:flex;align-items:center;justify-content:space-between">
          ðŸ“‹ Journal
          <button class="simv-btn simv-btn-ghost" style="font-size:12px" id="simv-journal-load">Charger tout</button>
        </h3>
        <div class="simv-journal" id="simv-journal">
          ${status.recent_journal && status.recent_journal.length ? _renderJournal(status.recent_journal) : '<span style="color:#94a3b8">Aucune entrÃ©e.</span>'}
        </div>
      </div>`;

    /* â”€â”€ Cleanup â”€â”€ */
    html += `
      <div class="simv-section" style="border-left:4px solid #f59e0b">
        <h3>ðŸ§¹ Nettoyage</h3>
        <p style="font-size:13px;color:var(--text-secondary);margin-bottom:12px">Supprimer toutes les donnÃ©es de simulation (commandes test, colis, scans).</p>
        <button class="simv-btn simv-btn-amber" id="simv-cleanup">ðŸ§¹ Nettoyer donnÃ©es test</button>
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
        if (!scenarios.length) { alert('âš ï¸ SÃ©lectionnez au moins un scÃ©nario'); return; }
        const config = {
          cadence_minutes: parseInt(document.getElementById('simv-cadence').value) || 3,
          max_orders:      parseInt(document.getElementById('simv-max').value) || 20,
          chaos_level:     parseFloat(document.getElementById('simv-chaos').value) || 0.1,
          scenarios,
        };
        startBtn.disabled = true; startBtn.textContent = 'â³ DÃ©marrageâ€¦';
        try {
          await global.KmcApi.simStart(config);
          await _render(root);
        } catch (e) { alert('âŒ ' + e.message); startBtn.disabled = false; startBtn.textContent = 'â–¶ï¸ DÃ©marrer'; }
      });
    }

    if (stopBtn) {
      stopBtn.addEventListener('click', async () => {
        stopBtn.disabled = true; stopBtn.textContent = 'â³ ArrÃªtâ€¦';
        try {
          await global.KmcApi.simStop();
          await _render(root);
        } catch (e) { alert('âŒ ' + e.message); }
      });
    }

    if (refreshBtn) refreshBtn.addEventListener('click', () => _render(root));

    if (cleanupBtn) {
      cleanupBtn.addEventListener('click', async () => {
        if (!confirm('ðŸ§¹ Supprimer toutes les donnÃ©es de test ?')) return;
        cleanupBtn.disabled = true; cleanupBtn.textContent = 'â³ Nettoyageâ€¦';
        try {
          const r = await global.KmcApi.simCleanup();
          alert('âœ… ' + (r.message || 'Nettoyage terminÃ©'));
          await _render(root);
        } catch (e) { alert('âŒ ' + e.message); cleanupBtn.disabled = false; cleanupBtn.textContent = 'ðŸ§¹ Nettoyer donnÃ©es test'; }
      });
    }

    if (journalBtn) {
      journalBtn.addEventListener('click', async () => {
        journalBtn.disabled = true; journalBtn.textContent = 'â³ Chargementâ€¦';
        try {
          const j = await global.KmcApi.simJournal();
          const el = document.getElementById('simv-journal');
          el.innerHTML = j.entries && j.entries.length ? _renderJournal(j.entries) : '<span style="color:#94a3b8">Journal vide.</span>';
        } catch (e) { alert('âŒ ' + e.message); }
        journalBtn.disabled = false; journalBtn.textContent = 'Charger tout';
      });
    }
  }

  /* â”€â”€ Point d'entrÃ©e â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
  global.SimulatorView = async function render(root) {
    _injectStyles();
    root.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-secondary)">ðŸ¤– Chargement simulateurâ€¦</div>';
    await _render(root);
  };

})(window);


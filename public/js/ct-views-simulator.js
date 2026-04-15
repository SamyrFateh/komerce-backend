/* ===================================================================
   Komerce Control Tower — ct-views-simulator.js
   Dashboard de contrôle du simulateur métier
   =================================================================== */
window.CT = window.CT || {};

CT.views.simulator = async function(container) {
  container.innerHTML = '<div class="ct-loading">🤖 Chargement simulateur...</div>';

  try {
    var status = await CT.api.simStatus().catch(function() {
      return { running: false, tick_count: 0, orders_tracked: 0 };
    });

    var html = '<div class="ct-view-header">' +
      '<h2>🤖 Simulateur métier</h2>' +
      '<p class="ct-subtitle">Faire avancer les commandes automatiquement à travers le flux complet</p></div>';

    // Status banner
    var running = status.running;
    var bannerBg = running ? '#dcfce7' : '#f1f5f9';
    var bannerColor = running ? '#16a34a' : '#64748b';
    var bannerIcon = running ? '🟢' : '⚪';
    html += '<div style="background:' + bannerBg + ';border:2px solid ' + bannerColor + '44;border-radius:12px;padding:16px 20px;margin-bottom:20px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">';
    html += '<div style="display:flex;align-items:center;gap:10px">';
    html += '<span style="font-size:24px">' + bannerIcon + '</span>';
    html += '<div><strong style="font-size:16px;color:' + bannerColor + '">' + (running ? 'Simulation en cours' : 'Simulation arrêtée') + '</strong>';
    if (running) {
      html += '<div style="font-size:13px;color:#475569">Tick #' + (status.tick_count || 0) +
        ' · ' + (status.orders_tracked || 0) + ' commandes suivies · cadence ' + (status.config?.cadence_minutes || 3) + 'min</div>';
    }
    html += '</div></div>';

    // Controls
    html += '<div style="display:flex;gap:8px">';
    if (!running) {
      html += '<button class="ct-btn ct-btn-action" id="sim-start">▶️ Démarrer</button>';
    } else {
      html += '<button class="ct-btn" style="background:#ef4444;color:white" id="sim-stop">⏹️ Arrêter</button>';
    }
    html += '<button class="ct-btn ct-btn-ghost" id="sim-refresh">🔄</button>';
    html += '</div></div>';

    // Config panel (only when stopped)
    if (!running) {
      html += '<div class="ct-section-block" style="border-left:4px solid #3b82f6">' +
        '<h3>⚙️ Configuration</h3>' +
        '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;margin-top:12px">' +
        '<div><label style="font-size:12px;color:#64748b;display:block;margin-bottom:4px">Cadence (minutes)</label>' +
        '<input id="sim-cadence" type="number" value="3" min="1" max="30" class="ct-input" style="width:100%"></div>' +
        '<div><label style="font-size:12px;color:#64748b;display:block;margin-bottom:4px">Max commandes</label>' +
        '<input id="sim-max" type="number" value="20" min="1" max="100" class="ct-input" style="width:100%"></div>' +
        '<div><label style="font-size:12px;color:#64748b;display:block;margin-bottom:4px">Chaos (0-1)</label>' +
        '<input id="sim-chaos" type="number" value="0.1" min="0" max="1" step="0.1" class="ct-input" style="width:100%"></div>' +
        '</div>' +
        '<div style="margin-top:12px"><label style="font-size:12px;color:#64748b;display:block;margin-bottom:4px">Scénarios actifs</label>' +
        '<div style="display:flex;flex-wrap:wrap;gap:6px" id="sim-scenarios">' +
        _scenarioCheckbox('nominal', '✅ Nominal (complet)', true) +
        _scenarioCheckbox('abandoned', '⏳ Abandonné', true) +
        _scenarioCheckbox('cancelled', '❌ Annulé', true) +
        _scenarioCheckbox('late_cash', '💰 Cash tardif', true) +
        _scenarioCheckbox('stuck', '🔒 Bloqué', false) +
        _scenarioCheckbox('uncollected', '📦 Non collecté', false) +
        '</div></div>' +
        '</div>';
    }

    // KPIs (when running or has data)
    if (status.tick_count > 0 || running) {
      var st = status.stats || {};
      html += '<div class="ct-kpi-grid">';
      html += CT.pc.kpiCard('📋', 'Commandes suivies', status.orders_tracked || 0, '#3b82f6');
      html += CT.pc.kpiCard('🔄', 'Ticks exécutés', status.tick_count || 0, '#8b5cf6');
      html += CT.pc.kpiCard('✅', 'Transitions OK', st.transitions_ok || 0, '#22c55e');
      html += CT.pc.kpiCard('❌', 'Erreurs', st.errors || 0, (st.errors || 0) > 0 ? '#ef4444' : '#22c55e');
      html += CT.pc.kpiCard('✔️', 'Terminées', st.completed || 0, '#16a34a');
      html += CT.pc.kpiCard('🎲', 'Chaos injectés', st.chaos_events || 0, '#f59e0b');
      html += '</div>';
    }

    // Journal (last entries)
    html += '<div class="ct-section-block">' +
      '<h3 style="display:flex;align-items:center;justify-content:space-between">📋 Journal' +
      '<button class="ct-btn ct-btn-ghost" style="font-size:12px" id="sim-journal-load">Charger journal complet</button></h3>' +
      '<div id="sim-journal-content">';

    if (status.recent_journal && status.recent_journal.length > 0) {
      html += '<div style="font-family:monospace;font-size:12px;max-height:400px;overflow-y:auto;background:#0f172a;color:#e2e8f0;border-radius:8px;padding:12px">';
      status.recent_journal.forEach(function(entry) {
        var color = entry.success ? '#4ade80' : '#f87171';
        html += '<div style="margin-bottom:4px;color:' + color + '">' +
          '<span style="color:#94a3b8">[' + (entry.time || '') + ']</span> ' +
          '<strong>' + (entry.ref || '') + '</strong> ' +
          (entry.scenario ? '<span style="color:#a78bfa">' + entry.scenario + '</span> ' : '') +
          entry.message + '</div>';
      });
      html += '</div>';
    } else {
      html += '<div class="ct-empty">Aucune entrée de journal</div>';
    }

    html += '</div></div>';

    // Cleanup
    html += '<div class="ct-section-block" style="border-left:4px solid #f59e0b">' +
      '<h3>🧹 Nettoyage</h3>' +
      '<p style="font-size:13px;color:#64748b;margin-bottom:12px">Supprimer toutes les données de simulation (commandes test, colis, scans)</p>' +
      '<button class="ct-btn" style="background:#f59e0b;color:white" id="sim-cleanup">🧹 Nettoyer données test</button>' +
      '</div>';

    container.innerHTML = html;

    // ── Wire buttons ──
    var startBtn = document.getElementById('sim-start');
    var stopBtn = document.getElementById('sim-stop');
    var refreshBtn = document.getElementById('sim-refresh');
    var cleanupBtn = document.getElementById('sim-cleanup');
    var journalBtn = document.getElementById('sim-journal-load');

    if (startBtn) {
      startBtn.addEventListener('click', async function() {
        var config = {
          cadence_minutes: parseInt(document.getElementById('sim-cadence').value) || 3,
          max_orders: parseInt(document.getElementById('sim-max').value) || 20,
          chaos_level: parseFloat(document.getElementById('sim-chaos').value) || 0.1,
          scenarios: []
        };
        document.querySelectorAll('#sim-scenarios input:checked').forEach(function(cb) {
          config.scenarios.push(cb.value);
        });
        startBtn.disabled = true; startBtn.textContent = '⏳...';
        try {
          await CT.api.simStart(config);
          CT.views.simulator(container);
        } catch(e) { alert('❌ ' + e.message); startBtn.disabled = false; startBtn.textContent = '▶️ Démarrer'; }
      });
    }

    if (stopBtn) {
      stopBtn.addEventListener('click', async function() {
        stopBtn.disabled = true; stopBtn.textContent = '⏳...';
        try {
          await CT.api.simStop();
          CT.views.simulator(container);
        } catch(e) { alert('❌ ' + e.message); }
      });
    }

    if (refreshBtn) {
      refreshBtn.addEventListener('click', function() { CT.views.simulator(container); });
    }

    if (cleanupBtn) {
      cleanupBtn.addEventListener('click', async function() {
        if (!confirm('🧹 Supprimer toutes les données de test de la simulation ?')) return;
        cleanupBtn.disabled = true; cleanupBtn.textContent = '⏳...';
        try {
          var r = await CT.api.simCleanup();
          alert('✅ ' + (r.message || 'Nettoyage terminé'));
          CT.views.simulator(container);
        } catch(e) { alert('❌ ' + e.message); cleanupBtn.disabled = false; }
      });
    }

    if (journalBtn) {
      journalBtn.addEventListener('click', async function() {
        try {
          var j = await CT.api.simJournal();
          var jContent = document.getElementById('sim-journal-content');
          if (j.entries && j.entries.length) {
            var jhtml = '<div style="font-family:monospace;font-size:12px;max-height:600px;overflow-y:auto;background:#0f172a;color:#e2e8f0;border-radius:8px;padding:12px">';
            j.entries.forEach(function(entry) {
              var color = entry.success ? '#4ade80' : '#f87171';
              jhtml += '<div style="margin-bottom:4px;color:' + color + '">' +
                '<span style="color:#94a3b8">[' + (entry.time || '') + ']</span> ' +
                '<strong>' + (entry.ref || '') + '</strong> ' +
                (entry.scenario ? '<span style="color:#a78bfa">' + entry.scenario + '</span> ' : '') +
                entry.message + '</div>';
            });
            jhtml += '</div>';
            jContent.innerHTML = jhtml;
          } else {
            jContent.innerHTML = '<div class="ct-empty">Journal vide</div>';
          }
        } catch(e) { alert('❌ ' + e.message); }
      });
    }

  } catch(err) {
    container.innerHTML = '<div class="ct-error">❌ ' + err.message + '</div>';
  }
};

function _scenarioCheckbox(val, label, checked) {
  return '<label style="display:flex;align-items:center;gap:4px;background:#f8fafc;padding:4px 10px;border-radius:6px;font-size:13px;cursor:pointer">' +
    '<input type="checkbox" value="' + val + '"' + (checked ? ' checked' : '') + '> ' + label + '</label>';
}

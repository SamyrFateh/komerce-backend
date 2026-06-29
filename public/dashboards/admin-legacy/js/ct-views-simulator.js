/**
 * @komerce-arch-lite
 * @role          legacy-ct-views-simulator
 * @domain        legacy-control-tower
 * @layer         ui-shell
 * @status        deprecated
 * @owner         dashboards (legacy - remplace par dashboards/admin/)
 * @purpose       Conserve en lecture pour control-tower.html ; migration vers dashboards/admin/ en cours.
 * @impact-areas  legacy-control-tower
 * @version       2026-06
 */
/* ===================================================================
   Komerce Control Tower — ct-views-simulator.js v2
   Dashboard de contrôle du simulateur métier
   14 scénarios (3 catégories) + 12 chaos actions
   =================================================================== */
window.CT = window.CT || {};

CT.views.simulator = async function(container) {
  container.innerHTML = '<div class="ct-loading">🤖 Chargement simulateur...</div>';

  try {
    var status = await CT.api.simStatus().catch(function() {
      return { running: false, tick_count: 0, orders_tracked: 0, available_scenarios: null };
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
        ' · ' + (status.orders_tracked || 0) + ' commandes suivies · cadence ' + (status.config?.cadence_minutes || 3) + 'min · chaos ' + ((status.config?.chaos_level || 0) * 100) + '%</div>';
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

    // ── Config panel (only when stopped) ──
    if (!running) {
      html += '<div class="ct-section-block" style="border-left:4px solid #3b82f6">' +
        '<h3>⚙️ Configuration</h3>' +
        '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;margin-top:12px">' +
        '<div><label style="font-size:12px;color:#64748b;display:block;margin-bottom:4px">Cadence (minutes)</label>' +
        '<input id="sim-cadence" type="number" value="3" min="1" max="30" class="ct-input" style="width:100%"></div>' +
        '<div><label style="font-size:12px;color:#64748b;display:block;margin-bottom:4px">Max commandes</label>' +
        '<input id="sim-max" type="number" value="20" min="1" max="100" class="ct-input" style="width:100%"></div>' +
        '<div><label style="font-size:12px;color:#64748b;display:block;margin-bottom:4px">Chaos (0-1)</label>' +
        '<input id="sim-chaos" type="number" value="0.2" min="0" max="1" step="0.05" class="ct-input" style="width:100%">' +
        '<div style="font-size:11px;color:#94a3b8;margin-top:2px">0 = pas de chaos · 0.3 = modéré · 0.7+ = chaos total</div></div>' +
        '</div>';

      // ── Scenario groups ──
      html += '<div style="margin-top:16px">' +
        '<label style="font-size:12px;color:#64748b;display:block;margin-bottom:8px">Scénarios actifs</label>';

      // Group 1: Happy path
      html += _scenarioGroup('🟢 Flux normal', '#dcfce7', '#16a34a', [
        { key: 'nominal', icon: '✅', label: 'Nominal (complet)', checked: true, desc: 'pending → collected' },
        { key: 'express', icon: '⚡', label: 'Express', checked: false, desc: 'Tout en accéléré' },
      ]);

      // Group 2: Delays
      html += _scenarioGroup('🟡 Retards & complications', '#fef9c3', '#ca8a04', [
        { key: 'late_cash', icon: '💰', label: 'Cash tardif', checked: true, desc: 'Paiement retardé puis OK' },
        { key: 'customs_delay', icon: '🛃', label: 'Retard douane', checked: false, desc: 'Bloqué douane Moroni' },
        { key: 'partial_delivery', icon: '📦', label: 'Livraison partielle', checked: false, desc: 'Multi-colis, un en retard' },
        { key: 'wrong_relais', icon: '📍', label: 'Mauvais relais', checked: false, desc: 'Redirection nécessaire' },
        { key: 'backorder', icon: '🕐', label: 'Rupture stock', checked: false, desc: 'Réappro puis livraison' },
      ]);

      // Group 3: Failures
      html += _scenarioGroup('🔴 Échecs & litiges', '#fee2e2', '#dc2626', [
        { key: 'abandoned', icon: '⏳', label: 'Abandonné', checked: true, desc: 'Jamais payé' },
        { key: 'cancelled', icon: '❌', label: 'Annulé', checked: true, desc: 'Annulation avant paiement' },
        { key: 'stuck', icon: '🔒', label: 'Bloqué', checked: false, desc: 'Bloqué en préparation' },
        { key: 'uncollected', icon: '📦', label: 'Non collecté', checked: false, desc: 'Jamais récupéré' },
        { key: 'damaged', icon: '💔', label: 'Endommagé', checked: false, desc: 'Colis cassé en transit' },
        { key: 'return_refund', icon: '🔄', label: 'Retour/Rembours.', checked: false, desc: 'Livré puis retourné' },
        { key: 'payment_dispute', icon: '⚖️', label: 'Litige paiement', checked: false, desc: 'Client conteste' },
      ]);

      // Quick presets
      html += '<div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">' +
        '<button class="ct-btn ct-btn-ghost" id="sim-preset-minimal" style="font-size:12px">🟢 Minimal (nominal + express)</button>' +
        '<button class="ct-btn ct-btn-ghost" id="sim-preset-realistic" style="font-size:12px">🟡 Réaliste (retards inclus)</button>' +
        '<button class="ct-btn ct-btn-ghost" id="sim-preset-chaos" style="font-size:12px">🔴 Chaos total (tout)</button>' +
        '</div>';

      html += '</div></div>';
    }

    // ── KPIs ──
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

      // ── Per-scenario breakdown ──
      if (st.scenarioBreakdown && Object.keys(st.scenarioBreakdown).length > 0) {
        html += '<div class="ct-section-block">' +
          '<h3>📊 Répartition par scénario</h3>' +
          '<table style="width:100%;border-collapse:collapse;margin-top:8px;font-size:13px">' +
          '<thead><tr style="border-bottom:2px solid #e2e8f0;text-align:left">' +
          '<th style="padding:6px 8px">Scénario</th>' +
          '<th style="padding:6px 8px;text-align:center">Total</th>' +
          '<th style="padding:6px 8px;text-align:center">Terminées</th>' +
          '<th style="padding:6px 8px;text-align:center">Erreurs</th>' +
          '<th style="padding:6px 8px;text-align:center">Chaos</th>' +
          '</tr></thead><tbody>';

        var scenarioIcons = {
          nominal: '✅', abandoned: '⏳', cancelled: '❌', late_cash: '💰',
          stuck: '🔒', uncollected: '📦', express: '⚡', customs_delay: '🛃',
          damaged: '💔', partial_delivery: '📦½', return_refund: '🔄',
          wrong_relais: '📍', payment_dispute: '⚖️', backorder: '🕐'
        };

        for (var sName in st.scenarioBreakdown) {
          var sd = st.scenarioBreakdown[sName];
          var pct = sd.total > 0 ? Math.round(sd.completed / sd.total * 100) : 0;
          html += '<tr style="border-bottom:1px solid #f1f5f9">' +
            '<td style="padding:6px 8px">' + (scenarioIcons[sName] || '•') + ' ' + sName + '</td>' +
            '<td style="padding:6px 8px;text-align:center">' + sd.total + '</td>' +
            '<td style="padding:6px 8px;text-align:center">' + sd.completed + ' <span style="color:#94a3b8">(' + pct + '%)</span></td>' +
            '<td style="padding:6px 8px;text-align:center;color:' + (sd.errors > 0 ? '#ef4444' : '#22c55e') + '">' + sd.errors + '</td>' +
            '<td style="padding:6px 8px;text-align:center;color:#f59e0b">' + sd.chaos + '</td>' +
            '</tr>';
        }
        html += '</tbody></table></div>';
      }
    }

    // ── Journal ──
    html += '<div class="ct-section-block">' +
      '<h3 style="display:flex;align-items:center;justify-content:space-between">📋 Journal' +
      '<button class="ct-btn ct-btn-ghost" style="font-size:12px" id="sim-journal-load">Charger journal complet</button></h3>' +
      '<div id="sim-journal-content">';

    if (status.recent_journal && status.recent_journal.length > 0) {
      html += _renderJournal(status.recent_journal);
    } else {
      html += '<div class="ct-empty">Aucune entrée de journal</div>';
    }

    html += '</div></div>';

    // ── Cleanup ──
    html += '<div class="ct-section-block" style="border-left:4px solid #f59e0b">' +
      '<h3>🧹 Nettoyage</h3>' +
      '<p style="font-size:13px;color:#64748b;margin-bottom:12px">Supprimer toutes les données de simulation (commandes test, colis, scans)</p>' +
      '<button class="ct-btn" style="background:#f59e0b;color:white" id="sim-cleanup">🧹 Nettoyer données test</button>' +
      '</div>';

    container.innerHTML = html;

    // ── Wire buttons ──
    _wireButtons(container, status);

  } catch(err) {
    container.innerHTML = '<div class="ct-error">❌ ' + err.message + '</div>';
  }
};

// ── Helpers ──────────────────────────────────────────────────

function _scenarioGroup(title, bgColor, borderColor, items) {
  var html = '<div style="background:' + bgColor + ';border:1px solid ' + borderColor + '33;border-radius:8px;padding:10px 12px;margin-bottom:8px">' +
    '<div style="font-size:12px;font-weight:600;color:' + borderColor + ';margin-bottom:6px">' + title + '</div>' +
    '<div style="display:flex;flex-wrap:wrap;gap:4px">';
  items.forEach(function(item) {
    html += '<label style="display:flex;align-items:center;gap:4px;background:white;padding:4px 8px;border-radius:6px;font-size:12px;cursor:pointer;min-width:140px" title="' + item.desc + '">' +
      '<input type="checkbox" class="sim-scenario-cb" value="' + item.key + '"' + (item.checked ? ' checked' : '') + '>' +
      ' ' + item.icon + ' ' + item.label + '</label>';
  });
  html += '</div></div>';
  return html;
}

function _renderJournal(entries) {
  var html = '<div style="font-family:monospace;font-size:12px;max-height:400px;overflow-y:auto;background:#0f172a;color:#e2e8f0;border-radius:8px;padding:12px">';
  entries.forEach(function(entry) {
    var color = entry.success === false ? '#f87171' : entry.success ? '#4ade80' : '#94a3b8';
    if (entry.message && entry.message.indexOf('🎲') >= 0) color = '#fbbf24';
    if (entry.message && entry.message.indexOf('═══') >= 0) color = '#7c3aed';

    html += '<div style="margin-bottom:4px;color:' + color + '">' +
      '<span style="color:#94a3b8">[' + (entry.time || '') + ']</span> ' +
      (entry.ref ? '<strong>' + entry.ref + '</strong> ' : '') +
      (entry.scenario ? '<span style="color:#a78bfa">' + entry.scenario + '</span> ' : '') +
      entry.message + '</div>';
  });
  html += '</div>';
  return html;
}

function _wireButtons(container, status) {
  var startBtn = document.getElementById('sim-start');
  var stopBtn = document.getElementById('sim-stop');
  var refreshBtn = document.getElementById('sim-refresh');
  var cleanupBtn = document.getElementById('sim-cleanup');
  var journalBtn = document.getElementById('sim-journal-load');

  // Presets
  var presetMinimal = document.getElementById('sim-preset-minimal');
  var presetRealistic = document.getElementById('sim-preset-realistic');
  var presetChaos = document.getElementById('sim-preset-chaos');

  function setPreset(keys, chaosVal) {
    document.querySelectorAll('.sim-scenario-cb').forEach(function(cb) {
      cb.checked = keys.includes(cb.value);
    });
    var chaosInput = document.getElementById('sim-chaos');
    if (chaosInput) chaosInput.value = chaosVal;
  }

  if (presetMinimal) presetMinimal.addEventListener('click', function() {
    setPreset(['nominal', 'express'], 0.05);
  });
  if (presetRealistic) presetRealistic.addEventListener('click', function() {
    setPreset(['nominal', 'express', 'late_cash', 'customs_delay', 'abandoned', 'cancelled', 'partial_delivery', 'backorder'], 0.2);
  });
  if (presetChaos) presetChaos.addEventListener('click', function() {
    setPreset(Object.keys(_allScenarioKeys()), 0.7);
    var chaosInput = document.getElementById('sim-chaos');
    if (chaosInput) chaosInput.value = '0.7';
  });

  if (startBtn) {
    startBtn.addEventListener('click', async function() {
      var config = {
        cadence_minutes: parseInt(document.getElementById('sim-cadence').value) || 3,
        max_orders: parseInt(document.getElementById('sim-max').value) || 20,
        chaos_level: parseFloat(document.getElementById('sim-chaos').value) || 0.1,
        scenarios: []
      };
      document.querySelectorAll('.sim-scenario-cb:checked').forEach(function(cb) {
        config.scenarios.push(cb.value);
      });
      if (!config.scenarios.length) { alert('⚠️ Sélectionnez au moins un scénario'); return; }

      startBtn.disabled = true; startBtn.textContent = '⏳ Démarrage...';
      try {
        await CT.api.simStart(config);
        CT.views.simulator(container);
      } catch(e) { alert('❌ ' + e.message); startBtn.disabled = false; startBtn.textContent = '▶️ Démarrer'; }
    });
  }

  if (stopBtn) {
    stopBtn.addEventListener('click', async function() {
      stopBtn.disabled = true; stopBtn.textContent = '⏳ Arrêt...';
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
      cleanupBtn.disabled = true; cleanupBtn.textContent = '⏳ Nettoyage...';
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
          jContent.innerHTML = _renderJournal(j.entries);
        } else {
          jContent.innerHTML = '<div class="ct-empty">Journal vide</div>';
        }
      } catch(e) { alert('❌ ' + e.message); }
    });
  }
}

function _allScenarioKeys() {
  return {
    nominal: 1, express: 1, late_cash: 1, customs_delay: 1,
    partial_delivery: 1, wrong_relais: 1, backorder: 1,
    abandoned: 1, cancelled: 1, stuck: 1, uncollected: 1,
    damaged: 1, return_refund: 1, payment_dispute: 1
  };
}

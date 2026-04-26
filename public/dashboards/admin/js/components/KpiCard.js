/**
 * KOMERCE Dashboard — KpiCard component
 * ════════════════════════════════════════════════════════════════════════
 * Rend un KPI avec :
 *   - icone + label
 *   - valeur formattee
 *   - delta (si applicable)
 *   - data_quality indicator (TOUJOURS visible — doctrine)
 */

(function (global) {
  'use strict';

  const ICONS = {
    ca_encaisse:        '💰',
    ca_vendu:           '💰',
    cmds_creees:        '🛒',
    cmds_actives:       '⚡',
    colis_transit:      '📦',
    alertes_critiques:  '⚠️',
    cmds_bloquees:      '🚫',
    taux_completude_scans: '📡',
    taux_completude_couts: '📊',
    cout_estime:        '🔮',
    cout_reel:          '🎯',
    marge_estimee:      '📈',
    marge_variable_reelle: '📊',
    marge_consolidee:   '🏆',
    cmds_cout_incomplet: '⏳',
    cout_moy_par_cmd:   '🧮',
    cmds_aujourdhui:    '🌅',
    paiements_en_attente: '⏱️',
    colis_preparation:  '📦',
    disponibles_relais: '📍',
    retards_critiques:  '🚨',
    taux_collecte_relais: '✅',
    workspaces_actifs:  '👥',
    sessions_ouvertes:  '🔓',
    taux_completion:    '🎯',
    montant_total_evenements: '💎',
    sessions_sans_commande: '🕊️',
    cmds_creees_workspace: '🎉',
    panier_moy_evenement: '🛍️',
    participants_moy:   '👤',
  };

  const ICON_COLORS = {
    ca_encaisse: 'green', ca_vendu: 'green',
    cmds_creees: 'blue', cmds_actives: 'amber',
    colis_transit: 'blue',
    alertes_critiques: 'red', cmds_bloquees: 'red', retards_critiques: 'red',
    taux_completude_scans: 'green', taux_completude_couts: 'orange',
    cout_estime: 'orange', cout_reel: 'blue',
    marge_estimee: 'orange', marge_variable_reelle: 'blue', marge_consolidee: 'green',
    cmds_cout_incomplet: 'orange', cout_moy_par_cmd: 'blue',
    paiements_en_attente: 'orange',
    workspaces_actifs: 'amber', sessions_ouvertes: 'blue',
  };

  function formatValue(value, unit) {
    if (value == null) return '—';
    if (unit === 'KMF') {
      return Number(value).toLocaleString('fr-FR');
    }
    if (unit === '%') return value.toFixed(1);
    if (unit === 'count') return Number(value).toLocaleString('fr-FR');
    return String(value);
  }

  function renderDelta(delta) {
    if (!delta || !delta.is_comparable) return '';
    const direction = delta.direction;
    const sign = direction === 'up' ? '↑' : (direction === 'down' ? '↓' : '→');
    const absVal = Math.abs(delta.value);
    return `
      <span class="kpi-card-delta is-${direction}">
        ${sign} ${absVal.toFixed(1)}${delta.unit}
        <span class="kpi-card-delta-vs">vs ${delta.vs_period}</span>
      </span>
    `;
  }

  function renderQuality(dq) {
    if (!dq) return '';
    const completeness = dq.completeness || 'complete';
    const itemsTotal = dq.items_total;
    const itemsWithData = dq.items_with_data;

    if (completeness === 'complete' && !dq.warning) return '';

    let dotClass = 'is-complete';
    let cls = '';
    let text = '';

    if (completeness === 'partial') {
      dotClass = 'is-partial';
      cls = 'is-partial';
      text = itemsTotal != null && itemsWithData != null
        ? `${itemsWithData}/${itemsTotal} commandes finalisées`
        : 'données partielles';
    } else if (completeness === 'provisional') {
      dotClass = 'is-provisional';
      text = 'estimation provisoire';
    } else if (completeness === 'incomplete') {
      dotClass = 'is-missing';
      cls = 'is-incomplete';
      text = 'données manquantes';
    }

    if (dq.warning) text = dq.warning;

    return `
      <div class="kpi-card-quality ${cls}">
        <span class="quality-dot ${dotClass}"></span>
        <span>${text}</span>
      </div>
    `;
  }

  /**
   * Render un KpiCard.
   * @param {object} kpi - format { key, label, value, unit, delta, data_quality, drill_to }
   * @returns {HTMLElement}
   */
  function render(kpi) {
    const div = document.createElement('div');
    div.className = 'kpi-card';
    if (kpi.drill_to) div.classList.add('is-clickable');

    const iconColor = ICON_COLORS[kpi.key] || 'blue';
    const icon = ICONS[kpi.key] || '📊';

    div.innerHTML = `
      <div class="kpi-card-header">
        <div class="kpi-card-icon is-${iconColor}">${icon}</div>
        <div class="kpi-card-label">${kpi.label}</div>
      </div>
      <div class="kpi-card-value">
        ${formatValue(kpi.value, kpi.unit)}
        ${kpi.unit && kpi.unit !== 'count' ? `<span class="kpi-card-value-unit">${kpi.unit}</span>` : ''}
      </div>
      ${renderDelta(kpi.delta)}
      ${renderQuality(kpi.data_quality)}
    `;

    if (kpi.drill_to) {
      div.addEventListener('click', () => {
        window.location.href = kpi.drill_to;
      });
    }

    return div;
  }

  /**
   * Render plusieurs KPIs dans un container.
   */
  function renderBar(container, kpis) {
    container.innerHTML = '';
    container.classList.add('kpi-bar');
    kpis.forEach(kpi => container.appendChild(render(kpi)));
  }

  /**
   * Render mini (pour view-block dans pilotage).
   */
  function renderMini(kpi) {
    const div = document.createElement('div');
    div.className = 'view-block-kpi-mini';
    div.innerHTML = `
      <div class="view-block-kpi-mini-value">${formatValue(kpi.value, kpi.unit)}${kpi.unit === 'KMF' ? ' KMF' : kpi.unit === '%' ? '%' : ''}</div>
      <div class="view-block-kpi-mini-label">${kpi.label}</div>
    `;
    return div;
  }

  global.KpiCard = { render, renderBar, renderMini, formatValue };
})(window);

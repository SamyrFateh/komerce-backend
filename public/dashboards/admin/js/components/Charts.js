/**
 * KOMERCE Dashboard — Charts (LineChart, DonutChart, Funnel)
 * ════════════════════════════════════════════════════════════════════════
 * Wrappers Chart.js avec presets Komerce (couleurs, formatage KMF).
 */

(function (global) {
  'use strict';

  const CHART_COLORS = {
    blue:   '#2563EB',
    green:  '#16A34A',
    orange: '#F59E0B',
    red:    '#DC2626',
    amber:  '#F4B860',
    navy:   '#0F1A2E',
    gray:   '#94A3B8',
    purple: '#9333EA',
    teal:   '#0D9488',
    pink:   '#EC4899',
    indigo: '#6366F1',
    lime:   '#65A30D',
    rose:   '#F43F5E',
    cyan:   '#06B6D4',
  };

  const STATUS_COLORS = {
    pending: '#F59E0B',
    confirmed: '#16A34A',
    ordered: '#2563EB',
    preparation: '#3B82F6',
    shipped: '#6366F1',
    in_transit: '#8B5CF6',
    available: '#F4B860',
    collected: '#16A34A',
    cancelled: '#DC2626',
    refunded: '#94A3B8',
    draft: '#94A3B8',
    arrived: '#F4B860',
  };

  const COST_TYPE_COLORS = {
    product_purchase: '#16A34A',
    sourcing: '#0D9488',
    hub: '#9333EA',
    packaging: '#EC4899',
    freight: '#2563EB',
    customs: '#DC2626',
    port_transitaire: '#6366F1',
    local_distribution: '#F59E0B',
    relay: '#F4B860',
    payment: '#06B6D4',
    risk_provision: '#94A3B8',
    fixed_overhead: '#0F1A2E',
    incident: '#F43F5E',
    marketing: '#65A30D',
  };

  function formatKMF(value) {
    if (value == null || isNaN(value)) return '—';
    if (value >= 1000000) return (value / 1000000).toFixed(1) + 'M';
    if (value >= 1000) return (value / 1000).toFixed(0) + 'k';
    return Math.round(value).toString();
  }

  function colorForSeries(key, idx) {
    if (key === 'orders' || key === 'cmds') return CHART_COLORS.blue;
    if (key === 'ca_kmf' || key === 'ca' || key === 'revenue') return CHART_COLORS.green;
    if (key === 'cost_est' || key === 'cost_estimated') return CHART_COLORS.orange;
    if (key === 'cost_real') return CHART_COLORS.red;
    if (key === 'margin') return CHART_COLORS.amber;
    const palette = Object.values(CHART_COLORS);
    return palette[idx % palette.length];
  }

  /**
   * LineChart — multi-series.
   * @param {HTMLElement} canvasContainer
   * @param {object} chart - { type:'multi-line', x: [...], series: [{key, label, values, color?}] }
   */
  function renderLineChart(canvasContainer, chart) {
    canvasContainer.innerHTML = '';
    const canvas = document.createElement('canvas');
    canvas.style.maxHeight = '300px';
    canvasContainer.appendChild(canvas);

    if (!chart || !chart.series || !chart.series.length) {
      canvasContainer.innerHTML = '<div class="empty-state">Pas de données</div>';
      return null;
    }

    const datasets = chart.series.map((s, idx) => ({
      label: s.label,
      data: s.values || [],
      borderColor: s.color || colorForSeries(s.key, idx),
      backgroundColor: (s.color || colorForSeries(s.key, idx)) + '20',
      borderWidth: 2,
      tension: 0.3,
      pointRadius: 3,
      pointHoverRadius: 5,
      fill: false,
    }));

    return new Chart(canvas, {
      type: 'line',
      data: {
        labels: chart.x || [],
        datasets,
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { intersect: false, mode: 'index' },
        plugins: {
          legend: {
            position: 'bottom',
            labels: { boxWidth: 12, padding: 14, font: { size: 12 } },
          },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const v = ctx.parsed.y;
                const label = ctx.dataset.label || '';
                if (label.toLowerCase().includes('kmf') || label.toLowerCase().includes('ca') || label.toLowerCase().includes('coût') || label.toLowerCase().includes('marge')) {
                  return `${label}: ${Number(v).toLocaleString('fr-FR')} KMF`;
                }
                return `${label}: ${v}`;
              },
            },
          },
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              callback: (v) => formatKMF(v),
              font: { size: 11 },
            },
            grid: { color: '#E2E8F0' },
          },
          x: {
            ticks: { font: { size: 11 } },
            grid: { display: false },
          },
        },
      },
    });
  }

  /**
   * DonutChart.
   * @param {HTMLElement} canvasContainer
   * @param {object} chart - { type:'donut', items: [{ status?, cost_type?, count?, amount_kmf?, pct, color? }] }
   * @param {object} options - { keyField: 'status'|'cost_type', valueField: 'count'|'amount_kmf', colorMap }
   */
  function renderDonutChart(canvasContainer, chart, options = {}) {
    canvasContainer.innerHTML = '';

    if (!chart || !chart.items || !chart.items.length) {
      canvasContainer.innerHTML = '<div class="empty-state">Pas de données</div>';
      return null;
    }

    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'display: flex; gap: 16px; align-items: center;';

    const canvasWrap = document.createElement('div');
    canvasWrap.style.cssText = 'width: 180px; height: 180px; flex-shrink: 0;';
    const canvas = document.createElement('canvas');
    canvasWrap.appendChild(canvas);

    const legend = document.createElement('div');
    legend.style.cssText = 'flex: 1; font-size: 13px; max-height: 200px; overflow-y: auto;';

    const keyField = options.keyField || (chart.items[0].status ? 'status' : (chart.items[0].cost_type ? 'cost_type' : 'key'));
    const valueField = options.valueField || (chart.items[0].count != null ? 'count' : 'amount_kmf');
    const colorMap = options.colorMap || (keyField === 'status' ? STATUS_COLORS : (keyField === 'cost_type' ? COST_TYPE_COLORS : {}));

    const labels = chart.items.map(it => it[keyField] || 'autre');
    const values = chart.items.map(it => Number(it[valueField] || 0));
    const colors = labels.map(lbl => colorMap[lbl] || CHART_COLORS.gray);

    const totalValue = values.reduce((a, b) => a + b, 0);

    new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data: values,
          backgroundColor: colors,
          borderWidth: 2,
          borderColor: '#FFFFFF',
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const lbl = ctx.label;
                const v = ctx.parsed;
                const pct = totalValue > 0 ? ((v / totalValue) * 100).toFixed(1) : 0;
                if (valueField === 'amount_kmf') {
                  return `${lbl}: ${Number(v).toLocaleString('fr-FR')} KMF (${pct}%)`;
                }
                return `${lbl}: ${v} (${pct}%)`;
              },
            },
          },
        },
        cutout: '60%',
      },
    });

    // Legend custom
    chart.items.forEach((it, idx) => {
      const row = document.createElement('div');
      row.style.cssText = 'display: flex; align-items: center; gap: 8px; padding: 4px 0;';
      const dot = document.createElement('div');
      dot.style.cssText = `width: 10px; height: 10px; border-radius: 50%; background: ${colors[idx]}; flex-shrink: 0;`;
      const label = document.createElement('span');
      label.style.cssText = 'flex: 1; color: var(--text-secondary);';
      label.textContent = it[keyField];
      const value = document.createElement('span');
      value.style.cssText = 'font-weight: 600; color: var(--text-primary);';
      value.textContent = valueField === 'amount_kmf'
        ? Number(it[valueField] || 0).toLocaleString('fr-FR')
        : it[valueField];
      const pct = document.createElement('span');
      pct.style.cssText = 'color: var(--text-tertiary); width: 50px; text-align: right;';
      pct.textContent = (it.pct != null ? it.pct.toFixed(1) : '—') + '%';
      row.appendChild(dot);
      row.appendChild(label);
      row.appendChild(value);
      row.appendChild(pct);
      legend.appendChild(row);
    });

    wrapper.appendChild(canvasWrap);
    wrapper.appendChild(legend);
    canvasContainer.appendChild(wrapper);
  }

  /**
   * Funnel chart (statuts pipeline).
   * @param {HTMLElement} container
   * @param {object} chart - { type:'funnel', stages: [{ key/status, count, pct? }] }
   */
  function renderFunnel(container, chart) {
    container.innerHTML = '';

    if (!chart || !chart.stages || !chart.stages.length) {
      container.innerHTML = '<div class="empty-state">Pas de données</div>';
      return;
    }

    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'display: flex; flex-direction: column; gap: 8px; padding: 4px;';

    const maxCount = Math.max(...chart.stages.map(s => Number(s.count || 0)));

    chart.stages.forEach((stage) => {
      const stageKey = stage.key || stage.status;
      const count = Number(stage.count || 0);
      const widthPct = maxCount > 0 ? (count / maxCount) * 100 : 0;

      const row = document.createElement('div');
      row.style.cssText = 'display: flex; align-items: center; gap: 12px;';

      const label = document.createElement('div');
      label.style.cssText = 'min-width: 130px; font-size: 13px; font-weight: 500;';
      label.textContent = stageKey || '—';

      const barWrap = document.createElement('div');
      barWrap.style.cssText = 'flex: 1; background: var(--bg-page); border-radius: 4px; overflow: hidden; height: 28px; position: relative;';

      const bar = document.createElement('div');
      const color = STATUS_COLORS[stageKey] || CHART_COLORS.blue;
      bar.style.cssText = `width: ${widthPct}%; height: 100%; background: ${color}; transition: width 0.3s ease; display: flex; align-items: center; padding: 0 8px; color: white; font-size: 12px; font-weight: 600;`;
      bar.textContent = count > 0 ? count : '';

      barWrap.appendChild(bar);

      const meta = document.createElement('div');
      meta.style.cssText = 'min-width: 80px; text-align: right; font-size: 12px; color: var(--text-secondary);';
      if (stage.pct != null) {
        meta.textContent = stage.pct.toFixed(1) + '%';
      } else if (maxCount > 0) {
        meta.textContent = ((count / maxCount) * 100).toFixed(0) + '%';
      }

      row.appendChild(label);
      row.appendChild(barWrap);
      row.appendChild(meta);
      wrapper.appendChild(row);
    });

    container.appendChild(wrapper);
  }

  global.Charts = {
    renderLineChart,
    renderDonutChart,
    renderFunnel,
    formatKMF,
    CHART_COLORS,
    STATUS_COLORS,
    COST_TYPE_COLORS,
  };
})(window);

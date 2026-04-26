/* ============================================================
   CT View — Détection d'Anomalies (problems)
   Auto-détecte 10 types d'anomalies opérationnelles
   ============================================================ */

CT.views.problems = function (main) {

  /* ── CSS ─────────────────────────────────────────────────── */
  const css = `
    .prob-wrap { font-family: 'Segoe UI', system-ui, sans-serif; color: #e2e8f0; min-height: 100vh; }

    /* Header */
    .prob-header { display: flex; justify-content: space-between; align-items: center;
                   padding: 18px 24px; background: #1e293b; border-bottom: 2px solid #334155; flex-wrap: wrap; gap: 12px; }
    .prob-header-left { display: flex; flex-direction: column; gap: 4px; }
    .prob-header-title { font-size: 1.4rem; font-weight: 700; color: #f1f5f9; }
    .prob-header-sub { font-size: .85rem; color: #94a3b8; }
    .prob-header-right { display: flex; align-items: center; gap: 12px; }
    .prob-scan-time { font-size: .8rem; color: #64748b; }
    .prob-refresh-btn { background: #334155; color: #e2e8f0; border: 1px solid #475569;
                        padding: 8px 18px; border-radius: 8px; cursor: pointer; font-size: .85rem;
                        display: flex; align-items: center; gap: 6px; transition: background .15s; }
    .prob-refresh-btn:hover { background: #475569; }
    .prob-refresh-btn.loading { opacity: .6; pointer-events: none; }
    .prob-auto-toggle { display: flex; align-items: center; gap: 6px; font-size: .8rem; color: #94a3b8; cursor: pointer; user-select: none; }
    .prob-auto-toggle input { accent-color: #3b82f6; cursor: pointer; }

    /* Summary bar */
    .prob-summary { display: flex; align-items: center; gap: 16px; padding: 14px 24px;
                    background: #1e293b; border-bottom: 1px solid #334155; flex-wrap: wrap; }
    .prob-total { font-size: 1.1rem; font-weight: 700; color: #f1f5f9; }
    .prob-sev-group { display: flex; gap: 14px; margin-left: auto; }
    .prob-sev-badge { font-size: .82rem; font-weight: 600; padding: 3px 12px; border-radius: 20px; }
    .prob-sev-badge[data-sev="critical"] { background: #450a0a; color: #fca5a5; }
    .prob-sev-badge[data-sev="warning"]  { background: #451a03; color: #fcd34d; }
    .prob-sev-badge[data-sev="info"]     { background: #172554; color: #93c5fd; }
    .prob-all-clear { font-size: 1rem; color: #4ade80; font-weight: 600; padding: 6px 0; }

    /* Body grid */
    .prob-body { display: grid; grid-template-columns: 1fr 320px; gap: 20px; padding: 20px 24px; }
    @media (max-width: 900px) { .prob-body { grid-template-columns: 1fr; } }

    /* Problem cards */
    .prob-cards { display: flex; flex-direction: column; gap: 12px; }
    .prob-card { background: #1e293b; border-radius: 12px; padding: 0; border-left: 4px solid #334155;
                 cursor: pointer; transition: box-shadow .15s, opacity .15s; overflow: hidden; }
    .prob-card:hover { box-shadow: 0 2px 12px rgba(0,0,0,.25); }
    .prob-card[data-severity="critical"] { border-left-color: #ef4444; }
    .prob-card[data-severity="warning"]  { border-left-color: #f59e0b; }
    .prob-card[data-severity="info"]     { border-left-color: #3b82f6; }
    .prob-card[data-count="0"]           { opacity: .45; cursor: default; }
    .prob-card[data-count="0"]:hover     { box-shadow: none; }

    .prob-card-head { display: flex; justify-content: space-between; align-items: center;
                      padding: 14px 16px; }
    .prob-card-title { font-size: .95rem; font-weight: 700; color: #f1f5f9; display: flex; align-items: center; gap: 8px; }
    .prob-card-count { font-size: .8rem; color: #64748b; font-weight: 400; }
    .prob-card-sev { padding: 2px 10px; border-radius: 12px; font-size: .72rem; font-weight: 700; text-transform: uppercase; }
    .prob-card-sev[data-sev="critical"] { background: #7f1d1d; color: #fca5a5; }
    .prob-card-sev[data-sev="warning"]  { background: #3b2100; color: #fbbf24; }
    .prob-card-sev[data-sev="info"]     { background: #1e3a5f; color: #93c5fd; }

    .prob-card-expand { font-size: .72rem; color: #64748b; padding: 0 16px 4px; transition: color .15s; }
    .prob-card.expanded .prob-card-expand { color: #94a3b8; }

    .prob-items { display: none; padding: 0 16px 14px; }
    .prob-card.expanded .prob-items { display: block; }
    .prob-item { font-size: .82rem; color: #cbd5e1; padding: 5px 0; border-bottom: 1px solid #334155; display: flex; align-items: baseline; gap: 6px; }
    .prob-item:last-child { border-bottom: none; }
    .prob-item-ref { font-weight: 600; color: #f1f5f9; white-space: nowrap; }
    .prob-item-name { color: #94a3b8; }
    .prob-item-meta { margin-left: auto; font-size: .78rem; color: #64748b; white-space: nowrap; }
    .prob-item-more { font-size: .8rem; color: #64748b; font-style: italic; padding: 4px 0; }
    .prob-card-desc { font-size: .82rem; color: #94a3b8; padding: 0 16px 6px; line-height: 1.4; }
    .prob-card-action { display: inline-block; font-size: .82rem; color: #3b82f6; padding: 0 16px 14px;
                        cursor: pointer; font-weight: 600; }
    .prob-card-action:hover { color: #60a5fa; text-decoration: underline; }

    /* Sidebar */
    .prob-sidebar { display: flex; flex-direction: column; gap: 16px; }
    .prob-score-card { background: #1e293b; border-radius: 12px; padding: 20px; text-align: center; }
    .prob-score-num { font-size: 3.5rem; font-weight: 800; line-height: 1; }
    .prob-score-num.green  { color: #4ade80; }
    .prob-score-num.yellow { color: #fbbf24; }
    .prob-score-num.red    { color: #f87171; }
    .prob-score-label { font-size: .85rem; color: #94a3b8; margin-top: 6px; }

    .prob-cats { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .prob-cat { background: #1e293b; border-radius: 10px; padding: 12px; text-align: center; border-left: 3px solid #334155; }
    .prob-cat[data-cat="finance"]  { border-left-color: #38bdf8; }
    .prob-cat[data-cat="appro"]    { border-left-color: #fbbf24; }
    .prob-cat[data-cat="logistic"] { border-left-color: #a78bfa; }
    .prob-cat[data-cat="client"]   { border-left-color: #4ade80; }
    .prob-cat[data-cat="data"]     { border-left-color: #f87171; }
    .prob-cat-num { font-size: 1.6rem; font-weight: 800; }
    .prob-cat[data-cat="finance"]  .prob-cat-num { color: #38bdf8; }
    .prob-cat[data-cat="appro"]    .prob-cat-num { color: #fbbf24; }
    .prob-cat[data-cat="logistic"] .prob-cat-num { color: #a78bfa; }
    .prob-cat[data-cat="client"]   .prob-cat-num { color: #4ade80; }
    .prob-cat[data-cat="data"]     .prob-cat-num { color: #f87171; }
    .prob-cat-label { font-size: .75rem; color: #94a3b8; margin-top: 2px; }

    .prob-rules-info { background: #1e293b; border-radius: 10px; padding: 14px; font-size: .78rem; color: #64748b; line-height: 1.7; }
    .prob-rules-info strong { color: #94a3b8; }

    /* Loading spinner */
    .prob-loading { text-align: center; padding: 60px 20px; color: #64748b; font-size: .95rem; }
    .prob-loading-spinner { display: inline-block; width: 24px; height: 24px; border: 3px solid #334155;
                            border-top-color: #3b82f6; border-radius: 50%; animation: prob-spin .7s linear infinite; }
    @keyframes prob-spin { to { transform: rotate(360deg); } }
  `;

  /* ── HTML ────────────────────────────────────────────────── */
  main.innerHTML = `
    <style>${css}</style>
    <div class="prob-wrap">

      <!-- Header -->
      <div class="prob-header">
        <div class="prob-header-left">
          <div class="prob-header-title">🚨 Détection d'Anomalies</div>
          <div class="prob-header-sub" data-prob="subtitle">Scan automatique — analyse en cours…</div>
        </div>
        <div class="prob-header-right">
          <div class="prob-scan-time" data-prob="scan-time"></div>
          <button class="prob-refresh-btn" data-prob="refresh">🔄 Actualiser</button>
          <label class="prob-auto-toggle">
            <input type="checkbox" data-prob="auto-toggle" checked>
            Auto (5 min)
          </label>
        </div>
      </div>

      <!-- Summary bar -->
      <div class="prob-summary" data-prob="summary">
        <div class="prob-loading"><span class="prob-loading-spinner"></span> Chargement…</div>
      </div>

      <!-- Body -->
      <div class="prob-body">

        <!-- Left: problem cards -->
        <div class="prob-cards" data-prob="cards">
          <div class="prob-loading"><span class="prob-loading-spinner"></span> Analyse des commandes…</div>
        </div>

        <!-- Right: sidebar -->
        <div class="prob-sidebar">
          <div class="prob-score-card">
            <div style="font-size:.8rem;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;margin-bottom:10px">🏥 Score Santé</div>
            <div class="prob-score-num" data-prob="score">—</div>
            <div class="prob-score-label" data-prob="score-label">Calcul…</div>
          </div>

          <div style="font-size:.8rem;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em">Par catégorie</div>
          <div class="prob-cats">
            <div class="prob-cat" data-cat="finance"><div class="prob-cat-num" data-prob="cnt-finance">0</div><div class="prob-cat-label">💳 Finance</div></div>
            <div class="prob-cat" data-cat="appro"><div class="prob-cat-num" data-prob="cnt-appro">0</div><div class="prob-cat-label">📦 Appro</div></div>
            <div class="prob-cat" data-cat="logistic"><div class="prob-cat-num" data-prob="cnt-logistic">0</div><div class="prob-cat-label">🚚 Logistique</div></div>
            <div class="prob-cat" data-cat="client"><div class="prob-cat-num" data-prob="cnt-client">0</div><div class="prob-cat-label">👤 Client</div></div>
            <div class="prob-cat" data-cat="data"><div class="prob-cat-num" data-prob="cnt-data">0</div><div class="prob-cat-label">⚙️ Données</div></div>
          </div>

          <div class="prob-rules-info">
            <strong>Détections actives :</strong><br>
            ✅ Commandes sans PO<br>
            ✅ Doubles paiements<br>
            ✅ Débordement quantité PO<br>
            ✅ PO reçue / commande bloquée<br>
            ✅ Préparation &gt; 4 jours<br>
            ✅ Transit &gt; 12 jours<br>
            ✅ Relais &gt; 7 jours sans retrait<br>
            ✅ SMS non envoyés<br>
            ✅ PO sans scan Hub<br>
            ✅ Cash non réconcilié
          </div>
        </div>

      </div>
    </div>
  `;

  /* ── Logic (IIFE) ────────────────────────────────────────── */
  (function () {

    /* ── Anomaly Rules ───────────────────────────────────── */
    var RULES = [
      {
        id: 'no_po', severity: 'critical', cat: 'finance', icon: '💳',
        title: 'Commandes sans PO',
        desc: 'Commandes confirmées sans bon d\'achat associé — l\'argent est encaissé mais la chaîne achat n\'a pas démarré.',
        detect: function (orders) {
          return orders.filter(function (o) {
            return o.status === 'confirmed' && !o.purchase_order && !o.purchase_order_id;
          });
        },
        actionLabel: 'Voir les commandes →',
        actionUrl: '/admin/orders?status=confirmed&no_po=1'
      },
      {
        id: 'double_payment', severity: 'critical', cat: 'finance', icon: '💳',
        title: 'Doubles paiements',
        desc: 'Plusieurs paiements détectés pour la même commande — double clic probable ou bug de paiement.',
        detect: function (orders) {
          return orders.filter(function (o) {
            return o.payment_status === 'paid' && o.payments && o.payments.length > 1;
          });
        },
        actionLabel: 'Vérifier les paiements →',
        actionUrl: '/admin/payments?filter=double'
      },
      {
        id: 'cash_unsettled', severity: 'critical', cat: 'finance', icon: '💰',
        title: 'Cash non réconcilié',
        desc: 'Paiement en cash collecté mais non soldé dans le système — argent en attente de réconciliation.',
        detect: function (orders) {
          return orders.filter(function (o) {
            return o.payment_method === 'cash' && o.payment_status !== 'settled' && o.payment_status !== 'paid';
          });
        },
        actionLabel: 'Solder les paiements →',
        actionUrl: '/admin/payments?filter=unsettled'
      },
      {
        id: 'po_overflow', severity: 'warning', cat: 'appro', icon: '📦',
        title: 'Débordement PO',
        desc: 'Quantité reçue supérieure à la quantité commandée — incohérence de données à vérifier.',
        detect: function (orders) {
          return orders.filter(function (o) {
            return o.purchase_order && o.purchase_order.received_qty > o.purchase_order.quantity;
          });
        },
        actionLabel: 'Corriger les BCs →',
        actionUrl: '/admin/purchase_orders?filter=overflow'
      },
      {
        id: 'po_received_stuck', severity: 'warning', cat: 'appro', icon: '📦',
        title: 'PO reçues mais commande en attente',
        desc: 'Colis arrivé au hub mais la commande est encore en statut purchasing — bug de transition probable.',
        detect: function (orders) {
          return orders.filter(function (o) {
            return o.status === 'purchasing' && o.purchase_order &&
              (o.purchase_order.status === 'received' || o.purchase_order.status === 'hub_received');
          });
        },
        actionLabel: 'Débloquer les commandes →',
        actionUrl: '/admin/orders?filter=po_stuck'
      },
      {
        id: 'available_long', severity: 'warning', cat: 'client', icon: '👤',
        title: 'Relais > 7 jours sans retrait',
        desc: 'Colis disponible en relais depuis plus de 7 jours — client possiblement injoignable.',
        detect: function (orders) {
          return orders.filter(function (o) {
            if (o.status !== 'available') return false;
            var days = _daysSince(o.updated_at || o.created_at);
            if (days > 7) { o._days = Math.floor(days); return true; }
            return false;
          });
        },
        actionLabel: 'Notifier les relais →',
        actionUrl: '/admin/orders?status=available&days_gt=7'
      },
      {
        id: 'prep_stuck', severity: 'info', cat: 'logistic', icon: '🚚',
        title: 'Préparation > 4 jours',
        desc: 'Commande en préparation depuis plus de 4 jours — action humaine manquante côté hub.',
        detect: function (orders) {
          return orders.filter(function (o) {
            if (o.status !== 'preparation') return false;
            var days = _daysSince(o.updated_at || o.created_at);
            if (days > 4) { o._days = Math.floor(days); return true; }
            return false;
          });
        },
        actionLabel: 'Voir les commandes bloquées →',
        actionUrl: '/admin/orders?status=preparation&days_gt=4'
      },
      {
        id: 'transit_long', severity: 'info', cat: 'logistic', icon: '🚚',
        title: 'Transit > 12 jours',
        desc: 'Colis en transit depuis plus de 12 jours — probablement perdu ou bloqué en douane.',
        detect: function (orders) {
          return orders.filter(function (o) {
            if (o.status !== 'shipped') return false;
            var days = _daysSince(o.updated_at || o.created_at);
            if (days > 12) { o._days = Math.floor(days); return true; }
            return false;
          });
        },
        actionLabel: 'Contacter transporteur →',
        actionUrl: '/admin/orders?status=shipped&days_gt=12'
      },
      {
        id: 'no_sms', severity: 'info', cat: 'client', icon: '📱',
        title: 'SMS non envoyés',
        desc: 'Commande en statut available mais le client n\'a pas reçu de notification SMS avec son code.',
        detect: function (orders) {
          return orders.filter(function (o) {
            return o.status === 'available' && o.sms_sent === false;
          });
        },
        actionLabel: 'Renvoyer les SMS →',
        actionUrl: '/admin/orders?status=available&sms_sent=false'
      },
      {
        id: 'no_hub_scan', severity: 'info', cat: 'data', icon: '⚙️',
        title: 'PO sans scan Hub',
        desc: 'Commandes actives sans scan hub enregistré — les colis ne peuvent pas progresser.',
        detect: function (orders) {
          return orders.filter(function (o) {
            return (o.status === 'purchasing' || o.status === 'preparation') && !o.hub_id && !o.hub_scan;
          });
        },
        actionLabel: 'Assigner les hubs →',
        actionUrl: '/admin/orders?filter=no_hub'
      }
    ];

    /* Severity sort order */
    var SEV_ORDER = { critical: 0, warning: 1, info: 2 };
    var SEV_LABELS = { critical: 'CRITIQUE', warning: 'ATTENTION', info: 'INFO' };
    var SEV_EMOJI = { critical: '🔴', warning: '🟠', info: '🟡' };

    /* ── Helpers ──────────────────────────────────────────── */

    function _daysSince(dateStr) {
      if (!dateStr) return 0;
      return (Date.now() - new Date(dateStr).getTime()) / 86400000;
    }

    function _q(sel) { return main.querySelector(sel); }
    function _qa(sel) { return main.querySelectorAll(sel); }
    function _d(key) { return main.querySelector('[data-prob="' + key + '"]'); }

    function _fmtKMF(val) {
      var n = Number(val);
      if (!n) return '';
      return n.toLocaleString('fr-FR') + ' KMF';
    }

    function _fmtTime(d) {
      return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }

    /* ── Fetch all orders ────────────────────────────────── */

    function _fetchOrders() {
      return fetch('/api/orders?limit=500', { credentials: 'include' })
        .then(function (r) {
          if (!r.ok) throw new Error('API ' + r.status);
          return r.json();
        })
        .then(function (data) {
          /* Support both { items: [] } and plain [] */
          return Array.isArray(data) ? data : (data.items || data.orders || data.data || []);
        });
    }

    /* ── Run all anomaly detections ──────────────────────── */

    function _runDetections(orders) {
      var results = [];
      RULES.forEach(function (rule) {
        var matched = [];
        try { matched = rule.detect(orders); } catch (e) { /* silent */ }
        results.push({ rule: rule, items: matched });
      });
      /* Sort by severity then by count desc */
      results.sort(function (a, b) {
        var sa = SEV_ORDER[a.rule.severity] || 9;
        var sb = SEV_ORDER[b.rule.severity] || 9;
        if (sa !== sb) return sa - sb;
        return b.items.length - a.items.length;
      });
      return results;
    }

    /* ── Render summary bar ──────────────────────────────── */

    function _renderSummary(results) {
      var totalCount = 0;
      var sevCounts = { critical: 0, warning: 0, info: 0 };

      results.forEach(function (r) {
        totalCount += r.items.length;
        sevCounts[r.rule.severity] = (sevCounts[r.rule.severity] || 0) + r.items.length;
      });

      var el = _d('summary');
      if (!el) return;

      if (totalCount === 0) {
        el.innerHTML = '<div class="prob-all-clear">✅ Aucun problème détecté — tout est en ordre</div>';
      } else {
        el.innerHTML =
          '<div class="prob-total">⚠️ ' + totalCount + ' problème' + (totalCount > 1 ? 's' : '') + ' détecté' + (totalCount > 1 ? 's' : '') + '</div>' +
          '<div class="prob-sev-group">' +
            (sevCounts.critical ? '<span class="prob-sev-badge" data-sev="critical">🔴 Critique : ' + sevCounts.critical + '</span>' : '') +
            (sevCounts.warning ? '<span class="prob-sev-badge" data-sev="warning">🟠 Attention : ' + sevCounts.warning + '</span>' : '') +
            (sevCounts.info ? '<span class="prob-sev-badge" data-sev="info">🟡 Info : ' + sevCounts.info + '</span>' : '') +
          '</div>';
      }

      /* Update subtitle */
      var sub = _d('subtitle');
      if (sub) {
        sub.textContent = totalCount === 0
          ? 'Scan automatique — aucune anomalie'
          : 'Scan automatique — ' + totalCount + ' problème' + (totalCount > 1 ? 's' : '') + ' détecté' + (totalCount > 1 ? 's' : '');
      }

      return { total: totalCount, sevCounts: sevCounts };
    }

    /* ── Render cards ────────────────────────────────────── */

    function _renderCards(results) {
      var container = _d('cards');
      if (!container) return;

      if (results.every(function (r) { return r.items.length === 0; })) {
        container.innerHTML =
          '<div class="prob-loading" style="color:#4ade80">✅ Aucun problème détecté<br><span style="font-size:.82rem;color:#64748b">Toutes les commandes sont en ordre</span></div>';
        return;
      }

      var html = '';
      results.forEach(function (r) {
        var rule = r.rule;
        var items = r.items;
        var count = items.length;
        var sevLabel = SEV_LABELS[rule.severity] || 'INFO';
        var emoji = SEV_EMOJI[rule.severity] || '🟡';

        /* Item list (max 8) */
        var itemsHtml = '';
        var shown = items.slice(0, 8);
        shown.forEach(function (o) {
          var ref = o.order_ref || o.reference || o.ref || o.id || '—';
          var name = o.client_name || o.customer_name || o.name || '';
          var amount = _fmtKMF(o.total || o.amount);
          var days = o._days || '';
          itemsHtml +=
            '<div class="prob-item">' +
              '<span>▸</span> ' +
              '<span class="prob-item-ref">' + ref + '</span> ' +
              (name ? '<span class="prob-item-name">— ' + name + '</span> ' : '') +
              '<span class="prob-item-meta">' +
                (amount ? amount : '') +
                (days ? ' (' + days + 'j)' : '') +
              '</span>' +
            '</div>';
        });
        if (items.length > 8) {
          itemsHtml += '<div class="prob-item-more">…et ' + (items.length - 8) + ' autre' + (items.length - 8 > 1 ? 's' : '') + '</div>';
        }

        html +=
          '<div class="prob-card" data-severity="' + rule.severity + '" data-count="' + count + '" data-rule="' + rule.id + '">' +
            '<div class="prob-card-head" data-action="toggle">' +
              '<div class="prob-card-title">' +
                emoji + ' ' + rule.title +
                ' <span class="prob-card-count">(' + count + ')</span>' +
              '</div>' +
              '<span class="prob-card-sev" data-sev="' + rule.severity + '">' + sevLabel + '</span>' +
            '</div>' +
            (count > 0 ? '<div class="prob-card-expand" data-action="toggle">▸ Cliquez pour voir les détails</div>' : '') +
            '<div class="prob-items">' +
              '<div class="prob-card-desc">' + rule.desc + '</div>' +
              itemsHtml +
              (count > 0 ? '<div class="prob-card-action" data-action="navigate" data-url="' + rule.actionUrl + '">' + rule.actionLabel + '</div>' : '') +
            '</div>' +
          '</div>';
      });

      container.innerHTML = html;
    }

    /* ── Render sidebar ──────────────────────────────────── */

    function _renderSidebar(results) {
      var totalCount = 0;
      var catCounts = { finance: 0, appro: 0, logistic: 0, client: 0, data: 0 };

      results.forEach(function (r) {
        var c = r.items.length;
        totalCount += c;
        if (catCounts[r.rule.cat] !== undefined) catCounts[r.rule.cat] += c;
      });

      /* Health score: 100 minus 8 pts per problem, min 0 */
      var score = Math.max(0, 100 - totalCount * 8);
      var scoreEl = _d('score');
      var labelEl = _d('score-label');

      if (scoreEl) {
        scoreEl.textContent = score + '/100';
        scoreEl.className = 'prob-score-num ' + (score >= 80 ? 'green' : score >= 50 ? 'yellow' : 'red');
      }
      if (labelEl) {
        if (score >= 80) labelEl.textContent = '✅ Système sain';
        else if (score >= 50) labelEl.textContent = '⚠️ Attention requise';
        else labelEl.textContent = '🚨 Action urgente nécessaire';
      }

      /* Category counts */
      Object.keys(catCounts).forEach(function (k) {
        var el = _d('cnt-' + k);
        if (el) el.textContent = catCounts[k];
      });
    }

    /* ── Main load ───────────────────────────────────────── */

    var _autoTimer = null;
    var _isLoading = false;

    function _probLoadData() {
      if (_isLoading) return;
      _isLoading = true;

      var btn = _d('refresh');
      if (btn) btn.classList.add('loading');

      _fetchOrders()
        .then(function (orders) {
          var results = _runDetections(orders);
          _renderSummary(results);
          _renderCards(results);
          _renderSidebar(results);

          /* Scan time */
          var timeEl = _d('scan-time');
          if (timeEl) timeEl.textContent = 'Dernier scan : ' + _fmtTime(new Date());
        })
        .catch(function (err) {
          console.warn('[CT Problems] API error, loading demo data:', err.message);
          _loadDemoData();
        })
        .finally(function () {
          _isLoading = false;
          var btn = _d('refresh');
          if (btn) btn.classList.remove('loading');
        });
    }

    /* ── Demo fallback data ──────────────────────────────── */

    function _loadDemoData() {
      var now = Date.now();
      var demoOrders = [
        /* No PO */
        { id: 'CMD-2024-0039', order_ref: 'CMD-2024-0039', status: 'confirmed', client_name: 'Mohamed Ali', total: 12500, payment_status: 'paid', payment_method: 'stripe', created_at: new Date(now - 86400000 * 2).toISOString(), updated_at: new Date(now - 86400000 * 2).toISOString() },
        { id: 'CMD-2024-0040', order_ref: 'CMD-2024-0040', status: 'confirmed', client_name: 'Ahmed Hassan', total: 8900, payment_status: 'paid', payment_method: 'stripe', created_at: new Date(now - 86400000).toISOString(), updated_at: new Date(now - 86400000).toISOString() },
        { id: 'CMD-2024-0041', order_ref: 'CMD-2024-0041', status: 'confirmed', client_name: 'Fatima Omar', total: 15000, payment_status: 'paid', payment_method: 'stripe', created_at: new Date(now - 3600000 * 6).toISOString(), updated_at: new Date(now - 3600000 * 6).toISOString() },
        /* Cash unsettled */
        { id: 'CMD-2024-0030', order_ref: 'CMD-2024-0030', status: 'collected', client_name: 'Ibrahim Madi', total: 22000, payment_status: 'pending', payment_method: 'cash', created_at: new Date(now - 86400000 * 3).toISOString(), updated_at: new Date(now - 86400000 * 3).toISOString() },
        { id: 'CMD-2024-0031', order_ref: 'CMD-2024-0031', status: 'collected', client_name: 'Zainab Combo', total: 9500, payment_status: 'pending', payment_method: 'cash', created_at: new Date(now - 86400000 * 5).toISOString(), updated_at: new Date(now - 86400000 * 5).toISOString() },
        /* Prep stuck > 4 days */
        { id: 'CMD-2024-0028', order_ref: 'CMD-2024-0028', status: 'preparation', client_name: 'Farid Hassan', total: 18000, payment_status: 'paid', payment_method: 'stripe', hub_id: 'hub-1', created_at: new Date(now - 86400000 * 6).toISOString(), updated_at: new Date(now - 86400000 * 6).toISOString() },
        /* Transit > 12 days */
        { id: 'CMD-2024-0022', order_ref: 'CMD-2024-0022', status: 'shipped', client_name: 'Saïd Abdou', total: 35000, payment_status: 'paid', payment_method: 'stripe', created_at: new Date(now - 86400000 * 15).toISOString(), updated_at: new Date(now - 86400000 * 15).toISOString() },
        /* Available > 7 days */
        { id: 'CMD-2024-0033', order_ref: 'CMD-2024-0033', status: 'available', client_name: 'Zakia Omar', total: 11000, payment_status: 'paid', payment_method: 'stripe', sms_sent: true, created_at: new Date(now - 86400000 * 9).toISOString(), updated_at: new Date(now - 86400000 * 9).toISOString() },
        { id: 'CMD-2024-0034', order_ref: 'CMD-2024-0034', status: 'available', client_name: 'Ibrahim Madi', total: 7500, payment_status: 'paid', payment_method: 'stripe', sms_sent: true, created_at: new Date(now - 86400000 * 10).toISOString(), updated_at: new Date(now - 86400000 * 10).toISOString() },
        /* SMS not sent */
        { id: 'CMD-2024-0036', order_ref: 'CMD-2024-0036', status: 'available', client_name: 'Amina Salim', total: 14000, payment_status: 'paid', payment_method: 'stripe', sms_sent: false, created_at: new Date(now - 86400000).toISOString(), updated_at: new Date(now - 86400000).toISOString() },
        /* No hub scan */
        { id: 'CMD-2024-0042', order_ref: 'CMD-2024-0042', status: 'purchasing', client_name: 'Nadia Ali', total: 6000, payment_status: 'paid', payment_method: 'stripe', created_at: new Date(now - 86400000 * 2).toISOString(), updated_at: new Date(now - 86400000 * 2).toISOString() },
        /* PO received but stuck in purchasing */
        { id: 'CMD-2024-0043', order_ref: 'CMD-2024-0043', status: 'purchasing', client_name: 'Ali Combo', total: 19000, payment_status: 'paid', payment_method: 'stripe', hub_id: 'hub-1', purchase_order: { status: 'received', quantity: 1, received_qty: 1 }, created_at: new Date(now - 86400000 * 3).toISOString(), updated_at: new Date(now - 86400000 * 3).toISOString() },
        /* Normal orders (no issues) */
        { id: 'CMD-2024-0050', order_ref: 'CMD-2024-0050', status: 'delivered', client_name: 'Hassan Ali', total: 25000, payment_status: 'settled', payment_method: 'cash', hub_id: 'hub-1', sms_sent: true, created_at: new Date(now - 86400000).toISOString(), updated_at: new Date(now - 86400000).toISOString() },
      ];

      var results = _runDetections(demoOrders);
      _renderSummary(results);
      _renderCards(results);
      _renderSidebar(results);

      var timeEl = _d('scan-time');
      if (timeEl) timeEl.textContent = 'Dernier scan : ' + _fmtTime(new Date()) + ' (démo)';
    }

    /* ── Event delegation ────────────────────────────────── */

    main.addEventListener('click', function (e) {
      var target = e.target;

      /* Refresh button */
      if (target.closest('[data-prob="refresh"]')) {
        e.preventDefault();
        _probLoadData();
        return;
      }

      /* Card toggle (expand/collapse) */
      var toggleEl = target.closest('[data-action="toggle"]');
      if (toggleEl) {
        var card = toggleEl.closest('.prob-card');
        if (card && card.getAttribute('data-count') !== '0') {
          card.classList.toggle('expanded');
          /* Update expand indicator */
          var expandEl = card.querySelector('.prob-card-expand');
          if (expandEl) {
            expandEl.textContent = card.classList.contains('expanded')
              ? '▾ Cliquez pour masquer'
              : '▸ Cliquez pour voir les détails';
          }
        }
        return;
      }

      /* Navigate action link */
      var navEl = target.closest('[data-action="navigate"]');
      if (navEl) {
        var url = navEl.getAttribute('data-url');
        if (url) window.open(url, '_blank');
        return;
      }
    });

    /* Auto-refresh toggle */
    main.addEventListener('change', function (e) {
      if (e.target.matches('[data-prob="auto-toggle"]')) {
        if (e.target.checked) {
          _startAutoRefresh();
        } else {
          _stopAutoRefresh();
        }
      }
    });

    function _startAutoRefresh() {
      _stopAutoRefresh();
      _autoTimer = setInterval(_probLoadData, 300000); /* 5 min */
    }

    function _stopAutoRefresh() {
      if (_autoTimer) {
        clearInterval(_autoTimer);
        _autoTimer = null;
      }
    }

    /* ── Init ────────────────────────────────────────────── */
    _probLoadData();

    /* Start auto-refresh (checkbox is checked by default) */
    _startAutoRefresh();

    /* Expose for external use */
    main._probRefresh = _probLoadData;
    main._probCleanup = function () {
      _stopAutoRefresh();
    };

  })();
};

/* ===================================================================
   Komerce Control Tower — ct-views.js v4.0 — Colis-Centric
   5 Dashboards métier : Global / Hub / Transit / Relais / Finance
   + Vue Commandes : toutes les entrées, statut optimiste inline
   Layout : 🔝 ACTION (haut) + 🔻 INFO/ALERTES (bas)
   =================================================================== */
window.CT = window.CT || {};
CT.views = {};
CT.html = {};

/* ---------------------------------------------------------------
   HTML Helpers (shared across all views)
   --------------------------------------------------------------- */
CT.html.formatKMF = function(amount) {
  if (amount == null || isNaN(amount)) return '0 KMF';
  return new Intl.NumberFormat('fr-FR').format(Math.round(amount)) + ' KMF';
};
CT.html.formatEUR = function(amount) {
  if (amount == null || isNaN(amount)) return '0,00 €';
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(amount);
};
CT.html.formatDate = function(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
};
CT.html.formatDateTime = function(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};
CT.html.statusLabel = function(status) {
  var map = {
    new: 'Nouveau', confirmed: 'Confirmé', ordered: 'Commandé',
    preparation: 'Préparation', shipped: 'Expédié', in_transit: 'En transit',
    available: 'Disponible', collected: 'Collecté', delivered: 'Livré',
    cancelled: 'Annulé', returned: 'Retourné', refunded: 'Remboursé',
    hub_received: 'Hub reçu', hub_dispatched: 'Hub expédié',
    relay_received: 'Relais reçu', relay_ready: 'Relais prêt'
  };
  return map[status] || status;
};
CT.html.badge = function(status) {
  return '<span class="ct-badge ' + (status || '') + '">' + CT.html.statusLabel(status) + '</span>';
};
CT.html.statusColor = function(status) {
  var map = {
    new: 'var(--ct-blue)', confirmed: 'var(--ct-green)', ordered: 'var(--ct-cyan)',
    preparation: 'var(--ct-purple)', shipped: 'var(--ct-amber)', in_transit: 'var(--ct-orange)',
    available: 'var(--ct-amber)', collected: 'var(--ct-green-dark)', delivered: 'var(--ct-green-dark)',
    cancelled: 'var(--ct-red)', returned: 'var(--ct-slate)'
  };
  return map[status] || 'var(--ct-text-muted)';
};

/* Next-status map for order advancement */
CT.html.NEXT_STATUS = {
  confirmed: 'ordered', ordered: 'preparation', preparation: 'shipped',
  shipped: 'in_transit', in_transit: 'available', available: 'collected'
};

/* Full next-status map (including cancel) */
CT.html.ALL_NEXT = {
  new:         ['confirmed', 'cancelled'],
  confirmed:   ['ordered', 'cancelled'],
  ordered:     ['preparation', 'cancelled'],
  preparation: ['shipped', 'cancelled'],
  shipped:     ['in_transit', 'cancelled'],
  in_transit:  ['available', 'cancelled'],
  available:   ['collected', 'cancelled'],
  collected:   [],
  cancelled:   ['refunded'],
  refunded:    []
};

/* ─── COLIS (PARCEL) — l'unité logistique réelle ─── */
/* Statuts parcels: draft → preparation → shipped → in_transit → available → collected */
CT.html.PARCEL_NEXT = {
  draft: 'preparation',
  preparation: 'shipped',
  shipped: 'in_transit',
  in_transit: 'available',
  available: 'collected'
};
CT.html.PARCEL_ALL_NEXT = {
  draft:       ['preparation', 'cancelled'],
  preparation: ['shipped', 'cancelled'],
  shipped:     ['in_transit', 'cancelled'],
  in_transit:  ['available', 'cancelled'],
  available:   ['collected', 'cancelled'],
  collected:   [],
  cancelled:   []
};
CT.html.parcelStatusLabel = function(status) {
  var map = {
    draft: 'Brouillon', preparation: 'Préparation', shipped: 'Expédié',
    in_transit: 'En transit', available: 'Au relais', collected: 'Collecté', cancelled: 'Annulé'
  };
  return map[status] || status;
};

/* Hex colors for status chips */
CT.html.STATUS_HEX = {
  new: '#3b82f6', confirmed: '#10b981', ordered: '#06b6d4',
  preparation: '#8b5cf6', shipped: '#f59e0b', in_transit: '#f97316',
  available: '#eab308', collected: '#059669', delivered: '#059669',
  cancelled: '#ef4444', refunded: '#94a3b8'
};

/* Age formatter */
CT.html._age = function(dateStr) {
  if (!dateStr) return '—';
  var diff = Date.now() - new Date(dateStr).getTime();
  var h = Math.floor(diff / 3600000);
  if (h < 1) return '<1h';
  if (h < 24) return h + 'h';
  return Math.floor(h / 24) + 'j';
};

/* ---------------------------------------------------------------
   Optimistic status chip — clickable badge with dropdown
   --------------------------------------------------------------- */
CT.html.statusChip = function(id, ref, status) {
  var nexts = CT.html.ALL_NEXT[status] || [];
  var chipId = 'chip-' + id;
  if (nexts.length === 0) {
    return '<span id="' + chipId + '" class="ct-badge ' + status + '">' + CT.html.statusLabel(status) + '</span>';
  }
  return '<span id="' + chipId + '" class="ct-badge ' + status + '" style="cursor:pointer;user-select:none" ' +
    'onclick="CT.html._openStatusMenu(event,\'' + id + '\',\'' + (ref||'') + '\',\'' + status + '\')">' +
    CT.html.statusLabel(status) + ' ▾</span>';
};

CT.html._openStatusMenu = function(e, id, ref, status) {
  e.stopPropagation();
  document.querySelectorAll('.ct-status-menu').forEach(function(m) { m.remove(); });
  var nexts = CT.html.ALL_NEXT[status] || [];
  if (nexts.length === 0) return;

  var menu = document.createElement('div');
  menu.className = 'ct-status-menu';
  menu.style.cssText = [
    'position:fixed;z-index:9999',
    'background:var(--ct-bg2,#1e293b)',
    'border:1px solid var(--ct-border,rgba(255,255,255,.1))',
    'border-radius:10px;padding:6px',
    'box-shadow:0 8px 24px rgba(0,0,0,.3)',
    'min-width:160px'
  ].join(';');

  nexts.forEach(function(next) {
    var item = document.createElement('div');
    var hex = CT.html.STATUS_HEX[next] || '#94a3b8';
    item.style.cssText = 'padding:8px 12px;border-radius:6px;cursor:pointer;font-size:.8rem;font-weight:600;display:flex;align-items:center;gap:8px;color:' + hex;
    item.innerHTML = '<span style="width:8px;height:8px;border-radius:50%;background:' + hex + ';flex-shrink:0"></span>→ ' + CT.html.statusLabel(next);
    item.addEventListener('mouseover', function() { item.style.background = 'rgba(255,255,255,.06)'; });
    item.addEventListener('mouseout', function() { item.style.background = ''; });
    item.addEventListener('click', function(ev) {
      ev.stopPropagation();
      menu.remove();
      CT.html._doStatusChange(id, ref, status, next);
    });
    menu.appendChild(item);
  });

  var chip = document.getElementById('chip-' + id);
  if (chip) {
    var rect = chip.getBoundingClientRect();
    menu.style.top = (rect.bottom + 4) + 'px';
    menu.style.left = rect.left + 'px';
  }
  document.body.appendChild(menu);

  setTimeout(function() {
    function closer(e2) {
      if (!menu.contains(e2.target)) {
        menu.remove();
        document.removeEventListener('click', closer);
      }
    }
    document.addEventListener('click', closer);
  }, 0);
};

CT.html._doStatusChange = async function(id, ref, currentStatus, nextStatus) {
  var chip = document.getElementById('chip-' + id);
  var nextsNew = CT.html.ALL_NEXT[nextStatus] || [];

  // Optimistic update
  if (chip) {
    chip.className = 'ct-badge ' + nextStatus;
    chip.style.opacity = '0.6';
    chip.innerHTML = CT.html.statusLabel(nextStatus) + (nextsNew.length > 0 ? ' ▾' : '');
    if (nextsNew.length > 0) {
      chip.setAttribute('onclick', 'CT.html._openStatusMenu(event,\'' + id + '\',\'' + ref + '\',\'' + nextStatus + '\')');
    } else {
      chip.removeAttribute('onclick');
      chip.style.cursor = 'default';
    }
  }

  try {
    await CT.api.updateOrderStatus(id, nextStatus);
    if (chip) {
      chip.style.opacity = '1';
      chip.style.outline = '2px solid #10b981';
      chip.style.outlineOffset = '2px';
      setTimeout(function() { if (chip) chip.style.outline = ''; }, 1500);
    }
    // Update row age highlight
    var row = chip ? chip.closest('tr') : null;
    if (row) {
      row.style.background = 'rgba(16,185,129,.07)';
      setTimeout(function() { if (row) row.style.background = ''; }, 1500);
    }
    CT.bus.emit('toast', ref + ' → ' + CT.html.statusLabel(nextStatus) + ' ✅', 'success');

    // Sync in-memory orders for commandes view
    if (CT.views.commandes && CT.views.commandes._orders) {
      var o = CT.views.commandes._orders.find(function(x) { return String(x.id) === String(id); });
      if (o) o.status = nextStatus;
    }
  } catch(e) {
    // Revert on error
    if (chip) {
      chip.className = 'ct-badge ' + currentStatus;
      chip.style.opacity = '1';
      chip.innerHTML = CT.html.statusLabel(currentStatus) + (CT.html.ALL_NEXT[currentStatus] || []).length > 0 ? ' ▾' : '';
      chip.setAttribute('onclick', 'CT.html._openStatusMenu(event,\'' + id + '\',\'' + ref + '\',\'' + currentStatus + '\')');
      chip.style.outline = '2px solid #ef4444';
      chip.style.outlineOffset = '2px';
      setTimeout(function() { if (chip) chip.style.outline = ''; }, 1500);
    }
    CT.bus.emit('toast', '❌ Erreur: ' + e.message, 'error');
  }
};

/* ---------------------------------------------------------------
   Parcel status chip — cliquable, appelle updateParcelStatus
   --------------------------------------------------------------- */
CT.html.parcelStatusChip = function(id, ref, status) {
  var nexts = CT.html.PARCEL_ALL_NEXT[status] || [];
  var chipId = 'pchip-' + id;
  var hex = CT.html.STATUS_HEX[status] || '#94a3b8';
  if (nexts.length === 0) {
    return '<span id="' + chipId + '" class="ct-badge ' + status + '">' + CT.html.parcelStatusLabel(status) + '</span>';
  }
  return '<span id="' + chipId + '" class="ct-badge ' + status + '" style="cursor:pointer;user-select:none" ' +
    'onclick="CT.html._openParcelMenu(event,\'' + id + '\',\'' + (ref||'') + '\',\'' + status + '\')">' +
    CT.html.parcelStatusLabel(status) + ' ▾</span>';
};

CT.html._openParcelMenu = function(e, id, ref, status) {
  e.stopPropagation();
  document.querySelectorAll('.ct-status-menu').forEach(function(m) { m.remove(); });
  var nexts = CT.html.PARCEL_ALL_NEXT[status] || [];
  if (nexts.length === 0) return;

  var menu = document.createElement('div');
  menu.className = 'ct-status-menu';
  menu.style.cssText = [
    'position:fixed;z-index:9999',
    'background:var(--ct-bg2,#1e293b)',
    'border:1px solid var(--ct-border,rgba(255,255,255,.1))',
    'border-radius:10px;padding:6px',
    'box-shadow:0 8px 24px rgba(0,0,0,.3)',
    'min-width:180px'
  ].join(';');

  nexts.forEach(function(next) {
    var item = document.createElement('div');
    var hex = CT.html.STATUS_HEX[next] || '#94a3b8';
    item.style.cssText = 'padding:8px 12px;border-radius:6px;cursor:pointer;font-size:.8rem;font-weight:600;display:flex;align-items:center;gap:8px;color:' + hex;
    item.innerHTML = '<span style="width:8px;height:8px;border-radius:50%;background:' + hex + ';flex-shrink:0"></span>→ ' + CT.html.parcelStatusLabel(next);
    item.addEventListener('mouseover', function() { item.style.background = 'rgba(255,255,255,.06)'; });
    item.addEventListener('mouseout', function() { item.style.background = ''; });
    item.addEventListener('click', function(ev) {
      ev.stopPropagation();
      menu.remove();
      CT.html._doParcelStatusChange(id, ref, status, next);
    });
    menu.appendChild(item);
  });

  var chip = document.getElementById('pchip-' + id);
  if (chip) {
    var rect = chip.getBoundingClientRect();
    menu.style.top = (rect.bottom + 4) + 'px';
    menu.style.left = rect.left + 'px';
  }
  document.body.appendChild(menu);

  setTimeout(function() {
    function closer(e2) {
      if (!menu.contains(e2.target)) { menu.remove(); document.removeEventListener('click', closer); }
    }
    document.addEventListener('click', closer);
  }, 0);
};

CT.html._doParcelStatusChange = async function(id, ref, currentStatus, nextStatus) {
  var chip = document.getElementById('pchip-' + id);
  var nextsNew = CT.html.PARCEL_ALL_NEXT[nextStatus] || [];

  // Mise à jour optimiste
  if (chip) {
    chip.className = 'ct-badge ' + nextStatus;
    chip.style.opacity = '0.6';
    chip.innerHTML = CT.html.parcelStatusLabel(nextStatus) + (nextsNew.length > 0 ? ' ▾' : '');
    if (nextsNew.length > 0) {
      chip.setAttribute('onclick', 'CT.html._openParcelMenu(event,\'' + id + '\',\'' + ref + '\',\'' + nextStatus + '\')');
    } else {
      chip.removeAttribute('onclick');
      chip.style.cursor = 'default';
    }
  }

  // Mettre à jour les KPI action cards (grosses étiquettes)
  var oldKpi = document.getElementById('kpi-val-' + currentStatus);
  var newKpi = document.getElementById('kpi-val-' + nextStatus);
  if (oldKpi) { var v = parseInt(oldKpi.textContent) || 0; oldKpi.textContent = Math.max(0, v - 1); }
  if (newKpi) { var v2 = parseInt(newKpi.textContent) || 0; newKpi.textContent = v2 + 1; }

  try {
    await CT.api.updateParcelStatus(id, nextStatus);
    if (chip) {
      chip.style.opacity = '1';
      chip.style.outline = '2px solid #10b981';
      chip.style.outlineOffset = '2px';
      setTimeout(function() { if (chip) chip.style.outline = ''; }, 1500);
    }
    var row = chip ? chip.closest('tr') : null;
    if (row) {
      row.style.background = 'rgba(16,185,129,.07)';
      setTimeout(function() { if (row) row.style.background = ''; }, 1500);
    }
    CT.bus.emit('toast', '📦 Colis ' + ref + ' → ' + CT.html.parcelStatusLabel(nextStatus) + ' ✅', 'success');
  } catch(e) {
    // Revert
    if (chip) {
      chip.className = 'ct-badge ' + currentStatus;
      chip.style.opacity = '1';
      chip.innerHTML = CT.html.parcelStatusLabel(currentStatus) + ((CT.html.PARCEL_ALL_NEXT[currentStatus] || []).length > 0 ? ' ▾' : '');
      chip.setAttribute('onclick', 'CT.html._openParcelMenu(event,\'' + id + '\',\'' + ref + '\',\'' + currentStatus + '\')');
      chip.style.outline = '2px solid #ef4444';
      chip.style.outlineOffset = '2px';
      setTimeout(function() { if (chip) chip.style.outline = ''; }, 1500);
    }
    // Revert KPI cards
    if (oldKpi) { var vr = parseInt(oldKpi.textContent) || 0; oldKpi.textContent = vr + 1; }
    if (newKpi) { var v2r = parseInt(newKpi.textContent) || 0; newKpi.textContent = Math.max(0, v2r - 1); }
    CT.bus.emit('toast', '❌ Erreur: ' + e.message, 'error');
  }
};

CT.html.advanceParcelBtn = function(id, ref, status) {
  var next = CT.html.PARCEL_NEXT[status];
  if (!next || !id) return '<span class="ct-muted" style="font-size:.75rem">—</span>';
  var label = CT.html.parcelStatusLabel(next);
  return '<button onclick="CT.html.advanceParcel(\'' + id + '\',\'' + (ref||'') + '\',\'' + status + '\', this)" ' +
    'style="padding:4px 10px;border:none;background:var(--ct-blue);color:#fff;border-radius:6px;font-size:.75rem;font-weight:700;cursor:pointer" ' +
    'title="→ ' + label + '">▶ ' + label + '</button>';
};

CT.html.advanceParcel = async function(id, ref, currentStatus, btn) {
  var next = CT.html.PARCEL_NEXT[currentStatus];
  if (!next) return;
  btn.disabled = true;
  btn.textContent = '⏳';

  try {
    await CT.api.updateParcelStatus(id, next);
    CT.bus.emit('toast', '📦 Colis ' + ref + ' → ' + CT.html.parcelStatusLabel(next) + ' ✅', 'success');

    // Mettre à jour chip si visible
    var chip = document.getElementById('pchip-' + id);
    if (chip) {
      var nextsNew = CT.html.PARCEL_ALL_NEXT[next] || [];
      chip.className = 'ct-badge ' + next;
      chip.innerHTML = CT.html.parcelStatusLabel(next) + (nextsNew.length > 0 ? ' ▾' : '');
      if (nextsNew.length > 0) {
        chip.setAttribute('onclick', 'CT.html._openParcelMenu(event,\'' + id + '\',\'' + ref + '\',\'' + next + '\')');
      }
      chip.style.outline = '2px solid #10b981';
      chip.style.outlineOffset = '2px';
      setTimeout(function() { if (chip) chip.style.outline = ''; }, 1500);
    }
    // Mettre à jour KPI cards
    var oldKpi = document.getElementById('kpi-val-' + currentStatus);
    var newKpi = document.getElementById('kpi-val-' + next);
    if (oldKpi) { var v = parseInt(oldKpi.textContent) || 0; oldKpi.textContent = Math.max(0, v - 1); }
    if (newKpi) { var v2 = parseInt(newKpi.textContent) || 0; newKpi.textContent = v2 + 1; }

    var newNext = CT.html.PARCEL_NEXT[next];
    if (newNext) {
      btn.disabled = false;
      btn.textContent = '▶ ' + CT.html.parcelStatusLabel(newNext);
      btn.setAttribute('onclick', 'CT.html.advanceParcel(\'' + id + '\',\'' + ref + '\',\'' + next + '\', this)');
    } else {
      btn.remove();
    }
  } catch(e) {
    CT.bus.emit('toast', '❌ Erreur: ' + e.message, 'error');
    btn.disabled = false;
    btn.textContent = '▶';
  }
};

/* ---------------------------------------------------------------
   Order detail modal — panneau latéral au clic sur une commande
   --------------------------------------------------------------- */
CT.html.showOrderDetail = async function(orderId, orderRef) {
  // Fermer si déjà ouvert
  var existing = document.getElementById('ct-detail-panel');
  if (existing) { existing.remove(); if (existing.dataset.orderId === String(orderId)) return; }

  // Créer le panneau
  var panel = document.createElement('div');
  panel.id = 'ct-detail-panel';
  panel.dataset.orderId = String(orderId);
  panel.style.cssText = [
    'position:fixed;top:0;right:0;width:min(480px,100vw);height:100vh',
    'background:var(--ct-bg1,#0f172a);border-left:1px solid var(--ct-border,rgba(255,255,255,.1))',
    'z-index:8000;display:flex;flex-direction:column',
    'box-shadow:-8px 0 32px rgba(0,0,0,.4)',
    'animation:slideInRight .2s ease'
  ].join(';');

  // Header
  var header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--ct-border,rgba(255,255,255,.1));flex-shrink:0';
  header.innerHTML = '<div><div style="font-weight:700;font-size:1rem">📋 Commande ' + (orderRef || orderId) + '</div>' +
    '<div style="font-size:.75rem;color:var(--ct-text-muted)">Détail complet</div></div>' +
    '<button onclick="document.getElementById(\'ct-detail-panel\').remove()" style="background:none;border:none;cursor:pointer;color:var(--ct-text-muted);font-size:1.2rem;padding:4px">✕</button>';
  panel.appendChild(header);

  // Body (scrollable)
  var body = document.createElement('div');
  body.style.cssText = 'flex:1;overflow-y:auto;padding:16px 20px';
  body.innerHTML = '<div style="color:var(--ct-text-muted);text-align:center;padding:40px 0">Chargement...</div>';
  panel.appendChild(body);

  document.body.appendChild(panel);

  // Ajouter animation CSS si pas déjà là
  if (!document.getElementById('ct-slide-style')) {
    var style = document.createElement('style');
    style.id = 'ct-slide-style';
    style.textContent = '@keyframes slideInRight{from{transform:translateX(100%)}to{transform:translateX(0)}}';
    document.head.appendChild(style);
  }

  // Cliquer en dehors pour fermer
  setTimeout(function() {
    function closer(e) {
      var p = document.getElementById('ct-detail-panel');
      if (p && !p.contains(e.target)) { p.remove(); document.removeEventListener('click', closer); }
    }
    document.addEventListener('click', closer);
  }, 200);

  // Charger les données
  try {
    var order = await CT.api.hubOrderDetail(orderId);
    var html = '';

    // Client
    html += '<div class="ct-card" style="margin-bottom:12px">';
    html += '<div class="ct-card-title">👤 Client</div>';
    html += '<div style="font-size:.85rem">';
    html += '<div style="font-weight:600">' + (order.client_name || '—') + '</div>';
    if (order.client_phone) html += '<div style="color:var(--ct-text-muted)">' + order.client_phone + '</div>';
    if (order.relais_name) html += '<div style="margin-top:4px">📍 Relais : <strong>' + order.relais_name + '</strong>' + (order.relais_island ? ' (' + order.relais_island + ')' : '') + '</div>';
    html += '</div></div>';

    // Infos commande
    html += '<div class="ct-card" style="margin-bottom:12px">';
    html += '<div class="ct-card-title">📦 Commande</div>';
    html += '<div style="font-size:.85rem;display:grid;grid-template-columns:1fr 1fr;gap:6px">';
    html += '<div><span style="color:var(--ct-text-muted)">Statut</span><br>' + CT.html.badge(order.status) + '</div>';
    html += '<div><span style="color:var(--ct-text-muted)">Total</span><br><strong>' + CT.html.formatKMF(order.total_kmf) + '</strong></div>';
    html += '<div><span style="color:var(--ct-text-muted)">Paiement</span><br>' + (order.payment_mode || '—') + (order.payment_status === 'paid' ? ' <span style="color:#10b981">✓</span>' : '') + '</div>';
    html += '<div><span style="color:var(--ct-text-muted)">Île</span><br>' + (order.destination_island || '—') + '</div>';
    html += '</div></div>';

    // Colis + Articles imbriqués — vue encapsulation
    var allItems = order.items || [];
    var parcels = order.parcels || [];

    // Associer les items aux colis (via id dans p.items)
    var assignedItemIds = {};
    parcels.forEach(function(p) {
      if (p.items && p.items.length) {
        p.items.forEach(function(it) { assignedItemIds[it.id] = true; });
      }
    });
    var floatingItems = allItems.filter(function(it) { return !assignedItemIds[it.id]; });

    function renderItem(item) {
      var stockColor = item.stock_status === 'ok' ? '#10b981' : item.stock_status === 'partial' ? '#f59e0b' : '#ef4444';
      var s = '<div style="display:flex;align-items:center;gap:8px;padding:5px 0 5px 12px;border-left:2px solid rgba(255,255,255,.08)">';
      if (item.image_url) s += '<img src="' + item.image_url + '" style="width:32px;height:32px;border-radius:4px;object-fit:cover;flex-shrink:0">';
      else s += '<div style="width:32px;height:32px;border-radius:4px;background:rgba(255,255,255,.06);flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:.9rem">📦</div>';
      s += '<div style="flex:1;min-width:0">';
      s += '<div style="font-size:.8rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + (item.product_name || '—') + '</div>';
      s += '<div style="font-size:.72rem;color:var(--ct-text-muted)">×' + item.quantity + '  ·  ' + CT.html.formatKMF(item.price_kmf) + '</div>';
      s += '</div>';
      s += '<span style="font-size:.7rem;color:' + stockColor + ';font-weight:700;flex-shrink:0">' + (item.stock_status === 'ok' ? '✓' : item.stock_status === 'partial' ? '⚠' : '✗') + '</span>';
      s += '</div>';
      return s;
    }

    if (parcels.length) {
      html += '<div class="ct-card" style="margin-bottom:12px">';
      html += '<div class="ct-card-title">📮 Colis (' + parcels.length + ')</div>';
      parcels.forEach(function(p, idx) {
        var pItems = (p.items && p.items.length) ? p.items : (parcels.length === 1 ? allItems : []);
        if (idx > 0) html += '<div style="margin-top:10px;border-top:1px solid var(--ct-border,rgba(255,255,255,.08));padding-top:10px"></div>';
        // Header colis
        html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">';
        html += '<span class="ct-font-mono" style="font-size:.82rem;font-weight:700;color:var(--ct-blue)">🗃 ' + (p.reference || 'Colis #' + (idx+1)) + '</span>';
        html += CT.html.parcelStatusChip(p.id, p.reference, p.status);
        html += '</div>';
        var meta = [];
        if (p.weight_kg) meta.push(p.weight_kg + ' kg');
        if (p.destination_island) meta.push('🏝 ' + p.destination_island);
        if (meta.length) html += '<div style="font-size:.72rem;color:var(--ct-text-muted);margin-bottom:6px">' + meta.join(' · ') + '</div>';
        // Articles imbriqués
        if (pItems.length) {
          pItems.forEach(function(item) { html += renderItem(item); });
        } else {
          html += '<div style="font-size:.75rem;color:var(--ct-text-muted);padding-left:12px">Aucun article enregistré</div>';
        }
        // Bouton avancer colis
        var advBtn = CT.html.advanceParcelBtn(p.id, p.reference, p.status);
        if (advBtn.indexOf('button') !== -1) html += '<div style="margin-top:8px">' + advBtn + '</div>';
      });
      // Items flottants (non affectés à un colis)
      if (floatingItems.length) {
        html += '<div style="margin-top:10px;border-top:1px dashed rgba(255,255,255,.1);padding-top:8px">';
        html += '<div style="font-size:.72rem;color:#f59e0b;margin-bottom:4px">⚠ Articles non assignés à un colis</div>';
        floatingItems.forEach(function(item) { html += renderItem(item); });
        html += '</div>';
      }
      html += '</div>';
    } else if (allItems.length) {
      // Pas encore de colis — afficher les articles directement
      html += '<div class="ct-card" style="margin-bottom:12px">';
      html += '<div class="ct-card-title">🛍️ Articles (' + allItems.length + ') <span style="font-size:.7rem;color:var(--ct-text-muted);font-weight:400">— aucun colis créé</span></div>';
      allItems.forEach(function(item) { html += renderItem(item); });
      html += '</div>';
    }

    // Timeline
    if (order.timeline && order.timeline.length) {
      html += '<div class="ct-card" style="margin-bottom:12px">';
      html += '<div class="ct-card-title">🗺️ Timeline</div>';
      order.timeline.forEach(function(t) {
        html += '<div style="display:flex;gap:10px;padding:5px 0;font-size:.78rem">';
        html += '<span style="color:var(--ct-text-muted);flex-shrink:0">' + CT.html.formatDateTime(t.created_at) + '</span>';
        html += '<span style="font-weight:600">' + (CT.html.statusLabel(t.step) || t.step) + '</span>';
        if (t.scanned_by_name) html += '<span style="color:var(--ct-text-muted)">par ' + t.scanned_by_name + '</span>';
        html += '</div>';
      });
      html += '</div>';
    }

    // Commentaires
    if (order.comments && order.comments.length) {
      html += '<div class="ct-card">';
      html += '<div class="ct-card-title">💬 Commentaires</div>';
      order.comments.slice(0, 5).forEach(function(c) {
        html += '<div style="padding:5px 0;border-bottom:1px solid var(--ct-border,rgba(255,255,255,.06));font-size:.78rem">';
        html += '<span style="color:var(--ct-text-muted)">' + CT.html.formatDateTime(c.created_at) + '</span> · ';
        html += '<span style="font-weight:600">' + (c.author_name || 'Hub') + '</span><br>';
        html += c.text || '';
        html += '</div>';
      });
      html += '</div>';
    }

    body.innerHTML = html || '<div style="color:var(--ct-text-muted);text-align:center;padding:40px 0">Aucun détail disponible</div>';
  } catch(e) {
    body.innerHTML = '<div style="color:#ef4444;padding:20px;text-align:center">❌ Erreur : ' + e.message + '</div>';
  }
};

/* ---------------------------------------------------------------
   advanceOrder — fixed: no more full view reload
   --------------------------------------------------------------- */
CT.html.advanceOrder = async function(id, ref, currentStatus, btn) {
  var next = CT.html.NEXT_STATUS[currentStatus];
  if (!next) return;
  btn.disabled = true;
  btn.textContent = '⏳';

  try {
    await CT.api.updateOrderStatus(id, next);
    CT.bus.emit('toast', ref + ' → ' + CT.html.statusLabel(next) + ' ✅', 'success');

    // Update chip if commandes view is loaded
    var chip = document.getElementById('chip-' + id);
    if (chip) {
      var nextsNew = CT.html.ALL_NEXT[next] || [];
      chip.className = 'ct-badge ' + next;
      chip.innerHTML = CT.html.statusLabel(next) + (nextsNew.length > 0 ? ' ▾' : '');
      if (nextsNew.length > 0) {
        chip.setAttribute('onclick', 'CT.html._openStatusMenu(event,\'' + id + '\',\'' + ref + '\',\'' + next + '\')');
      }
      chip.style.outline = '2px solid #10b981';
      chip.style.outlineOffset = '2px';
      setTimeout(function() { if (chip) chip.style.outline = ''; }, 1500);
    }

    // Update button to next possible action (no reload)
    var newNext = CT.html.NEXT_STATUS[next];
    if (newNext) {
      btn.disabled = false;
      btn.textContent = '▶ ' + CT.html.statusLabel(newNext);
      btn.setAttribute('onclick', 'CT.html.advanceOrder(\'' + id + '\',\'' + ref + '\',\'' + next + '\', this)');
    } else {
      btn.remove();
    }

    // Sync commandes view memory
    if (CT.views.commandes && CT.views.commandes._orders) {
      var o = CT.views.commandes._orders.find(function(x) { return String(x.id) === String(id); });
      if (o) o.status = next;
    }
  } catch(e) {
    CT.bus.emit('toast', '❌ Erreur: ' + e.message, 'error');
    btn.disabled = false;
    btn.textContent = '▶';
  }
};

/* Layout helpers */
CT.html.loading = function() { return '<div class="ct-loading">Chargement...</div>'; };
CT.html.error = function(msg) { return '<div class="ct-error">' + (msg || 'Erreur inconnue') + '</div>'; };
CT.html.empty = function(icon, msg) { return '<div class="ct-empty"><div class="ct-empty-icon">' + (icon || '📭') + '</div>' + (msg || 'Aucune donnée') + '</div>'; };

CT.html.kpiCard = function(label, value, icon, color) {
  return '<div class="ct-kpi-card ' + (color || '') + '">' +
    '<div class="ct-kpi-icon">' + (icon || '') + '</div>' +
    '<div class="ct-kpi-value">' + value + '</div>' +
    '<div class="ct-kpi-label">' + label + '</div>' +
  '</div>';
};

CT.html.actionCard = function(label, value, icon, color, onClick, statusKey) {
  var cls = 'ct-action-card ' + (color || '');
  var click = onClick ? ' onclick="' + onClick + '"' : '';
  var cursor = onClick ? ' style="cursor:pointer"' : '';
  var kpiId = statusKey ? ' id="kpi-val-' + statusKey + '"' : '';
  return '<div class="' + cls + '"' + click + cursor + '>' +
    '<div class="ct-action-icon">' + (icon || '') + '</div>' +
    '<div class="ct-action-value"' + kpiId + '>' + value + '</div>' +
    '<div class="ct-action-label">' + label + '</div>' +
  '</div>';
};

CT.html.zoneAction = function(title, content) {
  return '<div class="ct-zone ct-zone-action">' +
    '<div class="ct-zone-header"><span class="ct-zone-tag action">🔝 ACTION</span> ' + title + '</div>' +
    '<div class="ct-zone-body">' + content + '</div></div>';
};

CT.html.zoneInfo = function(title, content) {
  return '<div class="ct-zone ct-zone-info">' +
    '<div class="ct-zone-header"><span class="ct-zone-tag info">🔻 SURVEILLANCE</span> ' + title + '</div>' +
    '<div class="ct-zone-body">' + content + '</div></div>';
};

CT.html.alertItem = function(icon, text, count, level) {
  level = level || 'info';
  return '<div class="ct-alert-item ' + level + '">' +
    '<span>' + icon + ' ' + text + '</span>' +
    '<span class="ct-alert-count">' + count + '</span>' +
  '</div>';
};

CT.html.table = function(headers, rows) {
  var html = '<div class="ct-table-wrap"><table class="ct-table"><thead><tr>';
  headers.forEach(function(h) { html += '<th>' + h + '</th>'; });
  html += '</tr></thead><tbody>';
  if (!rows || rows.length === 0) {
    html += '<tr><td colspan="' + headers.length + '" class="ct-text-center ct-muted">Aucune donnée</td></tr>';
  } else {
    rows.forEach(function(row) {
      html += '<tr>';
      row.forEach(function(cell) { html += '<td>' + (cell != null ? cell : '—') + '</td>'; });
      html += '</tr>';
    });
  }
  html += '</tbody></table></div>';
  return html;
};

CT.html.scenarioCard = function(scenario) {
  var html = '<div class="ct-scenario-card" id="card-' + scenario.id + '">';
  html += '<div class="ct-scenario-card-header">';
  html += '<span class="ct-scenario-card-icon">' + scenario.icon + '</span>';
  html += '<span class="ct-scenario-card-name">' + scenario.name + '</span>';
  html += '</div>';
  html += '<div class="ct-scenario-card-desc">' + scenario.description + '</div>';
  if (scenario.fields && scenario.fields.length > 0) {
    html += '<div class="ct-scenario-fields">';
    scenario.fields.forEach(function(f) {
      html += '<div class="ct-scenario-field">';
      html += '<label for="field-' + scenario.id + '-' + f.key + '">' + f.label + '</label>';
      if (f.type === 'select') {
        html += '<select id="field-' + scenario.id + '-' + f.key + '" data-key="' + f.key + '">';
        (f.options || []).forEach(function(opt) {
          var val = typeof opt === 'object' ? opt.value : opt;
          var lbl = typeof opt === 'object' ? opt.label : opt;
          var sel = (f.default && f.default === val) ? ' selected' : '';
          html += '<option value="' + val + '"' + sel + '>' + lbl + '</option>';
        });
        html += '</select>';
      } else if (f.type === 'textarea') {
        html += '<textarea id="field-' + scenario.id + '-' + f.key + '" data-key="' + f.key + '" rows="3">' + (f.default || '') + '</textarea>';
      } else {
        var inputType = f.type === 'number' ? 'number' : 'text';
        html += '<input type="' + inputType + '" id="field-' + scenario.id + '-' + f.key + '" data-key="' + f.key + '" value="' + (f.default || '') + '">';
      }
      html += '</div>';
    });
    html += '</div>';
  }
  html += '<div class="ct-scenario-actions">';
  html += '<button class="ct-btn ct-btn-primary" id="btn-' + scenario.id + '">▶ Exécuter</button>';
  html += '</div>';
  html += '<div class="ct-scenario-result" id="result-' + scenario.id + '"></div>';
  html += '</div>';
  return html;
};

/* Chart management */
CT._charts = {};
CT.html.destroyCharts = function() {
  Object.keys(CT._charts).forEach(function(key) {
    if (CT._charts[key]) { try { CT._charts[key].destroy(); } catch(e) {} }
    delete CT._charts[key];
  });
};

/* Helper: build advance button */
CT.html.advanceBtn = function(id, ref, status) {
  var next = CT.html.NEXT_STATUS[status];
  if (!next || !id) return '<span class="ct-muted" style="font-size:.75rem">—</span>';
  var label = CT.html.statusLabel(next);
  return '<button onclick="CT.html.advanceOrder(\'' + id + '\',\'' + (ref||'') + '\',\'' + status + '\', this)" ' +
    'style="padding:4px 10px;border:none;background:var(--ct-green);color:#fff;border-radius:6px;font-size:.75rem;font-weight:700;cursor:pointer" ' +
    'title="→ ' + label + '">▶ ' + label + '</button>';
};

/* WhatsApp link helpers */
CT.html.whatsappLink = function(phone, ref, status) {
  var baseUrl = window.location.origin;
  var suiviUrl = baseUrl + '/suivi.html?ref=' + ref;
  var messages = {
    confirmed: '✅ Commande Komerce ' + ref + ' confirmée !\nSuivez-la ici : ' + suiviUrl,
    ordered: '📋 Commande ' + ref + ' en approvisionnement\n' + suiviUrl,
    preparation: '🛍️ Commande ' + ref + ' en préparation à Dubai\n' + suiviUrl,
    shipped: '📦 Colis ' + ref + ' expédié !\n' + suiviUrl,
    in_transit: '🚢 Colis ' + ref + ' en route vers les Comores\n' + suiviUrl,
    available: '🎉 Colis ' + ref + ' disponible au relais !\nRetrait : ' + suiviUrl,
    collected: '✅ Colis ' + ref + ' récupéré ! Merci 🙏'
  };
  var msg = messages[status] || 'Commande Komerce ' + ref + '\n' + suiviUrl;
  var cleanPhone = (phone || '').replace(/[^0-9+]/g, '');
  if (cleanPhone) return 'https://wa.me/' + cleanPhone.replace('+', '') + '?text=' + encodeURIComponent(msg);
  return 'https://wa.me/?text=' + encodeURIComponent(msg);
};
CT.html.whatsappBtn = function(phone, ref, status, compact) {
  var link = CT.html.whatsappLink(phone, ref, status);
  if (compact) return '<a href="' + link + '" target="_blank" rel="noopener" ' +
    'style="display:inline-flex;align-items:center;gap:3px;padding:4px 8px;background:#25d366;color:#fff;border-radius:6px;font-size:.7rem;font-weight:700;text-decoration:none" ' +
    'title="WhatsApp">📱</a>';
  return '<a href="' + link + '" target="_blank" rel="noopener" ' +
    'style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;background:#25d366;color:#fff;border-radius:6px;font-size:.75rem;font-weight:700;text-decoration:none" ' +
    'title="Envoyer WhatsApp">📱 WA</a>';
};


/* ===============================================================
   🧠 VIEW: GLOBAL (CEO / PILOTAGE)
   =============================================================== */
CT.views.global = {
  label: 'Global',
  icon: '🧠',
  load: async function(el) {
    el.innerHTML = CT.html.loading();
    CT.html.destroyCharts();
    try {
      var [ops, pipeline, retards, finance] = await Promise.all([
        CT.api.dashboard('ops'),
        CT.api.dashboard('pipeline'),
        CT.api.dashboard('retards'),
        CT.api.dashboard('finance')
      ]);
      var act = ops.activite || {};
      var sla = ops.sla || {};
      var alertes = ops.alertes || {};
      var pipe = pipeline.pipeline || {};
      var kpiFin = finance.kpi || {};
      var html = '';

      // ─── 🔝 ACTION ───
      var actionContent = '<div class="ct-action-grid">';
      actionContent += CT.html.actionCard('Commandes à risque', (sla.late || 0) + (sla.blocked || 0), '🚨', 'red');
      actionContent += CT.html.actionCard('Bloquées', act.commandes_bloquees || 0, '⛔', 'red');
      actionContent += CT.html.actionCard('Cash en attente', alertes.cash_pending || 0, '💰', 'amber');
      actionContent += CT.html.actionCard('Anomalies', alertes.anomalies || 0, '⚠️', 'orange');
      actionContent += '</div>';

      // Retards summary
      var retTotal = retards.total || 0;
      if (retTotal > 0) {
        actionContent += '<div class="ct-card ct-mt-md"><div class="ct-card-title">⏰ Retards actifs : ' + retTotal + '</div>';
        var parNiveau = retards.par_niveau || {};
        Object.keys(parNiveau).forEach(function(key) {
          var n = parNiveau[key];
          if (n.count > 0) {
            actionContent += CT.html.alertItem('⏰', n.label || key, n.count, 'warning');
          }
        });
        actionContent += '</div>';
      }
      html += CT.html.zoneAction('Ce qui nécessite ton attention', actionContent);

      // ─── 🔻 INFO ───
      var infoContent = '';

      // Funnel logistique
      infoContent += '<div class="ct-card"><div class="ct-card-title">📦 Funnel logistique</div>';
      infoContent += '<div class="ct-funnel">';
      var funnelSteps = ['confirmed','ordered','preparation','shipped','in_transit','available','collected'];
      var maxCount = 0;
      funnelSteps.forEach(function(s) { var c = pipe[s] ? pipe[s].count : 0; if (c > maxCount) maxCount = c; });
      funnelSteps.forEach(function(s) {
        var count = pipe[s] ? pipe[s].count : 0;
        var pct = maxCount > 0 ? Math.max(10, (count / maxCount) * 100) : 10;
        infoContent += '<div class="ct-funnel-step">';
        infoContent += '<span class="ct-funnel-label">' + CT.html.statusLabel(s) + '</span>';
        infoContent += '<div class="ct-funnel-bar"><div class="ct-funnel-fill" style="width:' + pct + '%;background:' + CT.html.statusColor(s) + '"></div></div>';
        infoContent += '<span class="ct-funnel-count">' + count + '</span>';
        infoContent += '</div>';
      });
      infoContent += '</div></div>';

      // KPI clés
      infoContent += '<div class="ct-kpi-row">';
      infoContent += CT.html.kpiCard('Commandes actives', act.commandes_en_cours || 0, '📦', 'blue');
      infoContent += CT.html.kpiCard("Livrées aujourd'hui", act.livrees_aujourd_hui || 0, '✅', 'green');
      infoContent += CT.html.kpiCard('Livrées 30j', act.livrees_30j || 0, '📊', 'cyan');
      infoContent += CT.html.kpiCard('CA 30j', CT.html.formatKMF(kpiFin.ca_kmf), '💰', 'amber');
      infoContent += '</div>';

      // SLA donut
      var totalSla = (sla.on_time || 0) + (sla.warning || 0) + (sla.late || 0);
      if (totalSla > 0) {
        infoContent += '<div class="ct-grid-2">';
        infoContent += '<div class="ct-card"><div class="ct-card-title">⏱️ SLA Performance</div>';
        infoContent += '<div class="ct-chart-container"><canvas id="chart-sla"></canvas></div>';
        infoContent += '<div class="ct-mt-md" style="text-align:center;font-size:0.85rem">';
        infoContent += '<span style="color:var(--ct-green)">● À temps: ' + sla.on_time + '</span> &nbsp; ';
        infoContent += '<span style="color:var(--ct-amber)">● Attention: ' + sla.warning + '</span> &nbsp; ';
        infoContent += '<span style="color:var(--ct-red)">● Retard: ' + sla.late + '</span>';
        infoContent += '</div></div>';

        // Délais moyens
        var delais = ops.delais || {};
        infoContent += '<div class="ct-card"><div class="ct-card-title">📏 Délais moyens</div>';
        infoContent += '<div class="ct-stat-grid">';
        infoContent += '<div class="ct-stat-item"><div class="ct-stat-value">' + (delais.avg_preparation_jours || 0) + 'j</div><div class="ct-stat-label">Préparation</div></div>';
        infoContent += '<div class="ct-stat-item"><div class="ct-stat-value">' + (delais.avg_livraison_totale_jours || 0) + 'j</div><div class="ct-stat-label">Livraison totale</div></div>';
        infoContent += '</div></div>';
        infoContent += '</div>';
      }

      html += CT.html.zoneInfo('Indicateurs et suivi', infoContent);
      el.innerHTML = html;

      // Render SLA chart
      if (totalSla > 0 && typeof Chart !== 'undefined') {
        var ctx = document.getElementById('chart-sla');
        if (ctx) {
          CT._charts.sla = new Chart(ctx.getContext('2d'), {
            type: 'doughnut',
            data: { labels: ['À temps','Attention','Retard'], datasets: [{ data: [sla.on_time||0, sla.warning||0, sla.late||0], backgroundColor: ['#10b981','#f59e0b','#ef4444'], borderWidth: 0 }] },
            options: { responsive: true, cutout: '65%', plugins: { legend: { display: false } } }
          });
        }
      }
    } catch(e) { el.innerHTML = CT.html.error(e.message); }
  }
};

/* ===============================================================
   🏭 VIEW: HUB (DUBAI / LOGISTIQUE) — COLIS-CENTRIC
   Le hub manipule des COLIS. 3 zones :
   1. Commandes à optimiser (pas encore de colis)
   2. Colis à emballer (draft/preparation)
   3. Colis à expédier (shipped)
   =============================================================== */
CT.views.hub = {
  label: 'Hub Dubaï',
  icon: '🏭',
  load: async function(el) {
    el.innerHTML = CT.html.loading();
    CT.html.destroyCharts();
    try {
      var [hubData, ops] = await Promise.all([
        CT.api.dashboard('hub-dubai'),
        CT.api.dashboard('ops')
      ]);
      var kpi = hubData.kpi || {};
      var alertes = ops.alertes || {};
      var delais = ops.delais || {};
      var aOptimiser = hubData.a_optimiser || [];
      var aEmballer = hubData.a_emballer || [];
      var aExpedier = hubData.a_expedier || [];
      var html = '';

      // ─── 🔝 ACTION HUB ───
      var actionContent = '<div class="ct-action-grid">';
      actionContent += CT.html.actionCard('À optimiser', kpi.a_optimiser || 0, '🛒', 'blue');
      actionContent += CT.html.actionCard('Colis à emballer', kpi.a_emballer || 0, '📦', 'purple', null, 'preparation');
      actionContent += CT.html.actionCard('Colis à expédier', kpi.a_expedier || 0, '🚚', 'amber', null, 'shipped');
      actionContent += CT.html.actionCard('Poids total', (kpi.total_poids_kg || 0) + ' kg', '⚖️', 'cyan');
      actionContent += '</div>';

      // ── Commandes à optimiser (pas encore de colis)
      if (aOptimiser.length > 0) {
        actionContent += '<div class="ct-card ct-mt-md"><div class="ct-card-title">🛒 Commandes à optimiser (' + aOptimiser.length + ') <span style="font-size:.72rem;color:var(--ct-text-muted);font-weight:400">— pas encore de colis créé</span></div>';
        var h0 = ['Réf. commande', 'Statut', 'Client', 'Articles', 'Montant', 'Âge'];
        var r0 = aOptimiser.map(function(o) {
          return [
            '<span class="ct-font-mono" style="font-weight:700;color:var(--ct-blue)">' + (o.reference || '—') + '</span>',
            CT.html.statusChip(o.id, o.reference, o.status),
            o.client_nom || '—',
            o.nb_articles || 0,
            CT.html.formatKMF(o.total_kmf),
            '<span style="color:' + (o.jours > 3 ? 'var(--ct-red)' : 'var(--ct-text)') + ';font-weight:600">' + (o.jours || 0) + 'j</span>'
          ];
        });
        actionContent += CT.html.table(h0, r0);
        actionContent += '</div>';
      }

      // ── Colis à emballer
      if (aEmballer.length > 0) {
        actionContent += '<div class="ct-card ct-mt-md"><div class="ct-card-title">📦 Colis à emballer (' + aEmballer.length + ')</div>';
        var h1 = ['Colis', 'Commande', 'Statut', 'Type', 'Poids', 'Client', 'Action'];
        var r1 = aEmballer.map(function(p) {
          var typeBadge = p.type === 'partial' ? '<span style="color:#f59e0b;font-size:.7rem;font-weight:700">PARTIEL</span>' :
                         p.type === 'backorder' ? '<span style="color:#ef4444;font-size:.7rem;font-weight:700">BACKORDER</span>' :
                         '<span style="color:var(--ct-text-muted);font-size:.7rem">standard</span>';
          return [
            '<span class="ct-font-mono" style="font-weight:700;font-size:.82rem;color:var(--ct-blue)">' + (p.reference || '—') + '</span>',
            '<span class="ct-font-mono" style="font-size:.75rem;color:var(--ct-text-muted)">' + (p.order_reference || '—') + '</span>',
            CT.html.parcelStatusChip(p.id, p.reference, p.status),
            typeBadge,
            p.weight_kg ? p.weight_kg + ' kg' : '—',
            p.client_nom || '—',
            CT.html.advanceParcelBtn(p.id, p.reference, p.status)
          ];
        });
        actionContent += CT.html.table(h1, r1);
        actionContent += '</div>';
      }

      // ── Colis à expédier
      if (aExpedier.length > 0) {
        actionContent += '<div class="ct-card ct-mt-md"><div class="ct-card-title">🚚 Colis à expédier (' + aExpedier.length + ')</div>';
        var h2 = ['Colis', 'Commande', 'Statut', 'Poids', 'Scellé', 'Action'];
        var r2 = aExpedier.map(function(p) {
          return [
            '<span class="ct-font-mono" style="font-weight:700;font-size:.82rem;color:var(--ct-blue)">' + (p.reference || '—') + '</span>',
            '<span class="ct-font-mono" style="font-size:.75rem;color:var(--ct-text-muted)">' + (p.order_reference || '—') + '</span>',
            CT.html.parcelStatusChip(p.id, p.reference, p.status),
            p.weight_kg ? p.weight_kg + ' kg' : '—',
            p.seal_code ? '<span style="color:#10b981;font-size:.75rem">🔒 ' + p.seal_code + '</span>' : '<span style="color:var(--ct-text-muted);font-size:.75rem">—</span>',
            CT.html.advanceParcelBtn(p.id, p.reference, p.status)
          ];
        });
        actionContent += CT.html.table(h2, r2);
        actionContent += '</div>';
      }

      if (aOptimiser.length === 0 && aEmballer.length === 0 && aExpedier.length === 0) {
        actionContent += CT.html.empty('📦', 'Aucun colis en attente — le hub est à jour ! 🎉');
      }

      html += CT.html.zoneAction('File de travail opérateur', actionContent);

      // ─── 🔻 INFO HUB ───
      var infoContent = '';

      var hasAlerts = (alertes.anomalies || 0) > 0 || (alertes.low_stock || 0) > 0;
      if (hasAlerts) {
        infoContent += '<div class="ct-card">';
        infoContent += '<div class="ct-card-title">⚠️ Alertes</div>';
        if (alertes.anomalies > 0) infoContent += CT.html.alertItem('⚠️', 'Anomalies détectées', alertes.anomalies, 'danger');
        if (alertes.low_stock > 0) infoContent += CT.html.alertItem('📦', 'Stock bas', alertes.low_stock, 'warning');
        infoContent += '</div>';
      }

      infoContent += '<div class="ct-card"><div class="ct-card-title">📊 Suivi opérationnel</div>';
      infoContent += '<div class="ct-stat-grid">';
      infoContent += '<div class="ct-stat-item"><div class="ct-stat-value">' + (delais.avg_preparation_jours || 0) + 'j</div><div class="ct-stat-label">Temps moyen préparation</div></div>';
      infoContent += '<div class="ct-stat-item"><div class="ct-stat-value">' + (kpi.total_poids_kg || 0) + ' kg</div><div class="ct-stat-label">Poids total en hub</div></div>';
      infoContent += '</div></div>';

      html += CT.html.zoneInfo('Alertes et suivi', infoContent);
      el.innerHTML = html;
    } catch(e) { el.innerHTML = CT.html.error(e.message); }
  }
};

/* ===============================================================
   🚢 VIEW: TRANSIT — LES COLIS (unité logistique)
   Les commandes sont encapsulées dans des colis.
   C'est le COLIS qui avance : shipped → in_transit → available → collected
   =============================================================== */
CT.views.transit = {
  label: 'Transit',
  icon: '🚢',
  _parcels: [],
  _filter: 'all',

  load: async function(el) {
    el.innerHTML = CT.html.loading();
    CT.html.destroyCharts();
    try {
      // Transit dashboard parcel-first + liste colis actifs
      var [transitData, parcelsRes] = await Promise.all([
        CT.api.transitDashboard(),
        CT.api.transitParcels({ limit: 200 })
      ]);
      var parcelsKpi = transitData.kpi || {};
      var delais = transitData.delays || {};
      var allParcels = parcelsRes.data || [];

      this._parcels = allParcels; // déjà filtrés côté API (actifs uniquement)
      this._filter = 'all';
      this._alertsData = transitData.alerts || {};
      this._byIsland = transitData.by_island || [];
      this._render(el, parcelsKpi, delais);
    } catch(e) { el.innerHTML = CT.html.error(e.message); }
  },

  _render: function(el, parcelsKpi, delais) {
    this._parcelsKpi = parcelsKpi;
    this._delais = delais;
    var self = this;
    parcelsKpi = parcelsKpi || {};
    delais = delais || {};

    var html = '';

    // ─── 🔝 ACTION : KPI colis ───
    var actionContent = '<div class="ct-action-grid">';
    actionContent += CT.html.actionCard('En préparation', parcelsKpi.preparation || 0, '🛒', 'purple', null, 'preparation');
    actionContent += CT.html.actionCard('Expédiés', parcelsKpi.shipped || 0, '📦', 'amber', null, 'shipped');
    actionContent += CT.html.actionCard('En transit', parcelsKpi.in_transit || 0, '🚢', 'orange', null, 'in_transit');
    actionContent += CT.html.actionCard('Au relais', parcelsKpi.at_relay || 0, '📍', 'green', null, 'available');
    actionContent += '</div>';

    // ─── ⚠ ALERTES actives ───
    var alertsData = this._alertsData || {};
    if (alertsData.total > 0) {
      var alertColor = alertsData.high > 0 ? '#ef4444' : alertsData.medium > 0 ? '#f59e0b' : '#64748b';
      actionContent += '<div style="background:' + alertColor + '15;border-left:3px solid ' + alertColor + ';border-radius:6px;padding:8px 12px;margin-bottom:10px;display:flex;align-items:center;gap:8px">' +
        '<span style="font-size:1.1rem">⚠️</span>' +
        '<span style="font-size:.83rem;font-weight:600;color:' + alertColor + '">' + alertsData.total + ' alerte(s) active(s)</span>' +
        (alertsData.high > 0 ? '<span style="background:#ef4444;color:#fff;font-size:.7rem;padding:1px 6px;border-radius:8px">' + alertsData.high + ' critique(s)</span>' : '') +
        '<button onclick="CT.views.transit._loadAlerts()" style="margin-left:auto;background:' + alertColor + ';color:#fff;border:none;border-radius:6px;padding:3px 10px;font-size:.75rem;cursor:pointer">Voir</button>' +
        '</div>';
    }

    // Filtres
    var filteredParcels = this._filter === 'all'
      ? this._parcels
      : this._parcels.filter(function(p) { return p.status === self._filter; });

    var filterStatuses = ['all','preparation','shipped','in_transit','available'];
    var filterLabels = { all:'Tous', preparation:'Préparation', shipped:'Expédié', in_transit:'En transit', available:'Au relais' };

    actionContent += '<div style="display:flex;gap:6px;flex-wrap:wrap;margin:12px 0 8px">';
    filterStatuses.forEach(function(s) {
      var count = s === 'all' ? self._parcels.length : self._parcels.filter(function(p) { return p.status === s; }).length;
      var active = s === self._filter;
      var hex = CT.html.STATUS_HEX[s] || '#64748b';
      actionContent += '<button onclick="CT.views.transit._setFilter(\'' + s + '\')" ' +
        'style="padding:4px 12px;border:none;border-radius:20px;font-size:.75rem;font-weight:600;cursor:pointer;' +
        'background:' + (active ? hex : 'var(--ct-bg3)') + ';color:' + (active ? '#fff' : 'var(--ct-text)') + ';transition:all .15s">' +
        filterLabels[s] + ' <span style="opacity:.7">(' + count + ')</span></button>';
    });
    actionContent += '</div>';

    // Table des colis
    if (filteredParcels.length === 0) {
      actionContent += CT.html.empty('📦', 'Aucun colis dans ce statut');
    } else {
      actionContent += '<div class="ct-card ct-mt-md"><div class="ct-card-title">📦 Colis (' + filteredParcels.length + ') — cliquez sur une ligne pour voir la commande</div>';
      var tbl = '<div class="ct-table-wrap"><table class="ct-table"><thead><tr>';
      ['Colis', 'Commande', 'Statut', 'Art.', 'Dest.', 'Créé le', 'Action'].forEach(function(h) { tbl += '<th>' + h + '</th>'; });
      tbl += '</tr></thead><tbody>';
      filteredParcels.forEach(function(p) {
        var orderRef = p.order_reference || '—';
        var orderId = p.order_id || '';
        var clickable = orderId ? ' style="cursor:pointer" onclick="CT.html.showOrderDetail(\'' + orderId + '\',\'' + orderRef + '\')"' : '';
        tbl += '<tr' + clickable + ' title="Cliquer pour voir la commande ' + orderRef + '">';
        // Retard badge
        var delayBadge = '';
        if (p.delay_status === 'late') {
          delayBadge = '<span style="background:#ef4444;color:#fff;font-size:.65rem;padding:1px 5px;border-radius:8px;margin-left:4px">RETARD</span>';
        } else if (p.delay_status === 'warning') {
          delayBadge = '<span style="background:#f59e0b;color:#fff;font-size:.65rem;padding:1px 5px;border-radius:8px;margin-left:4px">⚠</span>';
        }
        tbl += '<td><span class="ct-font-mono" style="font-weight:700;font-size:.82rem;color:var(--ct-blue)">' + (p.reference || '—') + '</span>' + delayBadge + '</td>';
        tbl += '<td><span class="ct-font-mono" style="font-size:.75rem;color:var(--ct-text-muted)">' + orderRef + '</span></td>';
        tbl += '<td>' + CT.html.parcelStatusChip(p.id, p.reference, p.status) + '</td>';
        tbl += '<td><span style="font-size:.8rem">' + (p.items_count || 0) + '</span></td>';
        tbl += '<td><span style="font-size:.78rem">' + (p.destination_island || p.routing_mode || '—') + '</span></td>';
        tbl += '<td><span style="font-size:.75rem;color:var(--ct-text-muted)">' + CT.html.formatDate(p.created_at) + '</span></td>';
        tbl += '<td>' + CT.html.advanceParcelBtn(p.id, p.reference, p.status) + '</td>';
        tbl += '</tr>';
      });
      tbl += '</tbody></table></div>';
      actionContent += tbl + '</div>';
    }

    html += CT.html.zoneAction('Colis en mouvement', actionContent);

    // ─── 🔻 INFO ───
    var infoContent = '';
    infoContent += '<div class="ct-card"><div class="ct-card-title">⏱️ Délais moyens</div>';
    infoContent += '<div class="ct-stat-grid">';
    infoContent += '<div class="ct-stat-item"><div class="ct-stat-value">' + (delais.avg_preparation_jours || 0) + 'j</div><div class="ct-stat-label">Préparation</div></div>';
    infoContent += '<div class="ct-stat-item"><div class="ct-stat-value">' + (delais.avg_livraison_totale_jours || 0) + 'j</div><div class="ct-stat-label">Livraison totale</div></div>';
    infoContent += '</div></div>';

    html += CT.html.zoneInfo('Performance', infoContent);
    el.innerHTML = html;
  },

  _setFilter: function(f) {
    this._filter = f;
    var el = document.getElementById('content-area');
    if (el) this._render(el, null, null);
  }
};

/* ===============================================================
   🏝️ VIEW: RELAIS — COLIS-CENTRIC
   Le relais reçoit et remet des COLIS.
   2 zones : colis en transit → colis à remettre
   =============================================================== */
CT.views.relais = {
  label: 'Relais',
  icon: '🏝️',
  load: async function(el) {
    el.innerHTML = CT.html.loading();
    CT.html.destroyCharts();
    try {
      var [relaisData, ops] = await Promise.all([
        CT.api.dashboard('relais'),
        CT.api.dashboard('ops')
      ]);
      var enTransit = relaisData.en_transit || [];
      var aRemettre = relaisData.a_remettre || [];
      var kpi = relaisData.kpi || {};
      var alertes = ops.alertes || {};
      var html = '';

      // ─── 🔝 ACTION ───
      var actionContent = '<div class="ct-action-grid">';
      actionContent += CT.html.actionCard('Colis à remettre', kpi.a_remettre || 0, '📦', 'green', null, 'available');
      actionContent += CT.html.actionCard('Cash à encaisser', kpi.cash_pending || 0, '💰', 'amber');
      actionContent += CT.html.actionCard('En transit', kpi.en_transit || 0, '🚢', 'blue', null, 'in_transit');
      actionContent += CT.html.actionCard('Total colis', (kpi.en_transit || 0) + (kpi.a_remettre || 0), '📊', 'purple');
      actionContent += '</div>';

      // ── Colis à remettre (au relais, client peut venir chercher)
      if (aRemettre.length > 0) {
        actionContent += '<div class="ct-card ct-mt-md"><div class="ct-card-title">📦 Colis à remettre aux clients (' + aRemettre.length + ')</div>';
        var h1 = ['Colis', 'Commande', 'Statut', 'Client', 'Tél.', 'Relais', 'Attente', '📱'];
        var r1 = aRemettre.map(function(p) {
          var pickupInfo = p.pickup_code
            ? '<div style="font-size:.65rem;color:#10b981;font-weight:700">🔑 ' + p.pickup_code + '</div>'
            : '';
          return [
            '<span class="ct-font-mono" style="font-weight:700;font-size:.82rem;color:var(--ct-blue)">' + (p.reference || '—') + '</span>' + pickupInfo,
            '<span class="ct-font-mono" style="font-size:.75rem;color:var(--ct-text-muted)">' + (p.order_reference || '—') + '</span>',
            CT.html.parcelStatusChip(p.id, p.reference, p.status),
            p.client_nom || '—',
            p.client_phone || '—',
            p.relais_nom || '—',
            '<span style="color:' + ((p.heures_attente||0) > 48 ? 'var(--ct-red)' : 'var(--ct-text)') + ';font-weight:600">' + (p.heures_attente || 0) + 'h</span>',
            CT.html.whatsappBtn(p.client_phone, p.order_reference || p.reference, 'available', false)
          ];
        });
        actionContent += CT.html.table(h1, r1);
        actionContent += '</div>';
      }

      // ── Colis en transit (en route vers le relais)
      if (enTransit.length > 0) {
        actionContent += '<div class="ct-card ct-mt-md"><div class="ct-card-title">🚢 Colis en transit (' + enTransit.length + ')</div>';
        var h2 = ['Colis', 'Commande', 'Statut', 'Client', 'Relais', 'Île', 'Action'];
        var r2 = enTransit.map(function(p) {
          return [
            '<span class="ct-font-mono" style="font-weight:700;font-size:.82rem;color:var(--ct-blue)">' + (p.reference || '—') + '</span>',
            '<span class="ct-font-mono" style="font-size:.75rem;color:var(--ct-text-muted)">' + (p.order_reference || '—') + '</span>',
            CT.html.parcelStatusChip(p.id, p.reference, p.status),
            p.client_nom || '—',
            p.relais_nom || '—',
            p.ile || '—',
            CT.html.advanceParcelBtn(p.id, p.reference, p.status)
          ];
        });
        actionContent += CT.html.table(h2, r2);
        actionContent += '</div>';
      }

      if (aRemettre.length === 0 && enTransit.length === 0) {
        actionContent += CT.html.empty('📭', 'Aucun colis en attente au relais');
      }

      html += CT.html.zoneAction('Actions terrain', actionContent);

      // ─── 🔻 INFO ───
      var infoContent = '';
      var critiques = aRemettre.filter(function(p) { return (p.heures_attente || 0) > 72; });
      var importants = aRemettre.filter(function(p) { var h = p.heures_attente || 0; return h > 24 && h <= 72; });
      if (critiques.length > 0 || importants.length > 0) {
        infoContent += '<div class="ct-card">';
        infoContent += '<div class="ct-card-title">⚠️ Alertes</div>';
        if (critiques.length > 0) infoContent += CT.html.alertItem('🔴', 'Colis non collectés > 72h', critiques.length, 'danger');
        if (importants.length > 0) infoContent += CT.html.alertItem('🟠', 'Colis en attente > 24h', importants.length, 'warning');
        infoContent += '</div>';
      }

      infoContent += '<div class="ct-card"><div class="ct-card-title">📊 Suivi relais</div>';
      infoContent += '<div class="ct-stat-grid">';
      infoContent += '<div class="ct-stat-item"><div class="ct-stat-value">' + aRemettre.length + '</div><div class="ct-stat-label">Colis au relais</div></div>';
      infoContent += '<div class="ct-stat-item"><div class="ct-stat-value">' + enTransit.length + '</div><div class="ct-stat-label">En transit</div></div>';
      var avgAttente = 0;
      if (aRemettre.length > 0) {
        var total = 0;
        aRemettre.forEach(function(p) { total += p.heures_attente || 0; });
        avgAttente = Math.round(total / aRemettre.length);
      }
      infoContent += '<div class="ct-stat-item"><div class="ct-stat-value">' + avgAttente + 'h</div><div class="ct-stat-label">Délai moyen retrait</div></div>';
      infoContent += '</div></div>';

      html += CT.html.zoneInfo('Alertes et suivi', infoContent);
      el.innerHTML = html;
    } catch(e) { el.innerHTML = CT.html.error(e.message); }
  }
};

/* ===============================================================
   💰 VIEW: FINANCE
   =============================================================== */
CT.views.finance = {
  label: 'Finance',
  icon: '💰',
  load: async function(el) {
    el.innerHTML = CT.html.loading();
    CT.html.destroyCharts();
    try {
      var [finance, ops] = await Promise.all([
        CT.api.dashboard('finance'),
        CT.api.dashboard('ops')
      ]);
      var kpi = finance.kpi || {};
      var paiements = finance.paiements || {};
      var marges = finance.marges || {};
      var alertes = ops.alertes || {};
      var cashData = paiements.cash || {};
      var stripeData = paiements.stripe || {};
      var topProduits = finance.top_produits || [];
      var parCategorie = finance.par_categorie || [];
      var html = '';

      var actionContent = '<div class="ct-action-grid">';
      actionContent += CT.html.actionCard('Cash en attente', alertes.cash_pending || 0, '💰', 'amber');
      actionContent += CT.html.actionCard('Paiements cash', cashData.count || 0, '💵', 'green');
      actionContent += CT.html.actionCard('Paiements Stripe', stripeData.count || 0, '💳', 'blue');
      actionContent += CT.html.actionCard('Annulées', kpi.nb_annulees || 0, '❌', 'red');
      actionContent += '</div>';

      actionContent += '<div class="ct-grid-2 ct-mt-md">';
      actionContent += '<div class="ct-card"><div class="ct-card-title">💵 Cash Relais</div>';
      actionContent += '<div class="ct-stat-grid">';
      actionContent += '<div class="ct-stat-item"><div class="ct-stat-value">' + (cashData.count || 0) + '</div><div class="ct-stat-label">Transactions</div></div>';
      actionContent += '<div class="ct-stat-item"><div class="ct-stat-value">' + CT.html.formatKMF(cashData.total_kmf) + '</div><div class="ct-stat-label">Total KMF</div></div>';
      actionContent += '</div></div>';

      actionContent += '<div class="ct-card"><div class="ct-card-title">💳 Stripe EUR</div>';
      actionContent += '<div class="ct-stat-grid">';
      actionContent += '<div class="ct-stat-item"><div class="ct-stat-value">' + (stripeData.count || 0) + '</div><div class="ct-stat-label">Transactions</div></div>';
      actionContent += '<div class="ct-stat-item"><div class="ct-stat-value">' + CT.html.formatEUR(stripeData.total_eur) + '</div><div class="ct-stat-label">Total EUR</div></div>';
      actionContent += '</div></div>';
      actionContent += '</div>';

      html += CT.html.zoneAction('Paiements et encaissements', actionContent);

      var infoContent = '';
      infoContent += '<div class="ct-kpi-row">';
      infoContent += CT.html.kpiCard('CA (KMF)', CT.html.formatKMF(kpi.ca_kmf), '💵', 'green');
      infoContent += CT.html.kpiCard('CA (EUR)', CT.html.formatEUR(kpi.ca_eur), '💶', 'blue');
      infoContent += CT.html.kpiCard('Commandes', kpi.nb_commandes || 0, '📦', 'purple');
      infoContent += CT.html.kpiCard('Panier moyen', CT.html.formatKMF(kpi.panier_moyen_kmf), '🛒', 'amber');
      infoContent += '</div>';

      infoContent += '<div class="ct-card"><div class="ct-card-title">📈 Marges</div>';
      infoContent += '<div class="ct-stat-grid">';
      infoContent += '<div class="ct-stat-item"><div class="ct-stat-value">' + CT.html.formatKMF(marges.marge_reelle_kmf || 0) + '</div><div class="ct-stat-label">Marge réelle</div></div>';
      infoContent += '<div class="ct-stat-item"><div class="ct-stat-value">' + CT.html.formatKMF(marges.cout_logistique_kmf || 0) + '</div><div class="ct-stat-label">Coût logistique</div></div>';
      infoContent += '<div class="ct-stat-item"><div class="ct-stat-value">' + (marges.taux_marge_pct != null ? marges.taux_marge_pct + '%' : '—') + '</div><div class="ct-stat-label">Taux marge</div></div>';
      infoContent += '</div>';
      if (marges.nb_sans_cost > 0) {
        infoContent += '<div class="ct-muted" style="margin-top:8px;font-size:0.8rem">⚠️ ' + marges.nb_sans_cost + ' commandes sans coût renseigné</div>';
      }
      infoContent += '</div>';

      infoContent += '<div class="ct-grid-2">';
      if (parCategorie.length > 0) {
        infoContent += '<div class="ct-card"><div class="ct-card-title">📂 CA par catégorie</div>';
        infoContent += '<div class="ct-chart-container" style="max-width:100%"><canvas id="chart-categories"></canvas></div></div>';
      }
      if (topProduits.length > 0) {
        infoContent += '<div class="ct-card"><div class="ct-card-title">🏆 Top Produits</div>';
        var tpH = ['Produit', 'Qté', 'CA (KMF)'];
        var tpR = topProduits.map(function(p) { return [p.name || '—', p.count || 0, CT.html.formatKMF(p.revenue_kmf)]; });
        infoContent += CT.html.table(tpH, tpR);
        infoContent += '</div>';
      }
      infoContent += '</div>';

      html += CT.html.zoneInfo('Indicateurs financiers', infoContent);
      el.innerHTML = html;

      if (parCategorie.length > 0 && typeof Chart !== 'undefined') {
        var ctx = document.getElementById('chart-categories');
        if (ctx) {
          var colors = ['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#f97316','#64748b'];
          CT._charts.categories = new Chart(ctx.getContext('2d'), {
            type: 'bar',
            data: {
              labels: parCategorie.map(function(c){ return c.category || 'Autre'; }),
              datasets: [{ label: 'CA (KMF)', data: parCategorie.map(function(c){ return c.revenue_kmf || 0; }), backgroundColor: colors.slice(0, parCategorie.length), borderRadius: 6 }]
            },
            options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
          });
        }
      }
    } catch(e) { el.innerHTML = CT.html.error(e.message); }
  }
};

/* ===============================================================
   📋 VIEW: COMMANDES (TOUTES LES COMMANDES — STATUT OPTIMISTE)
   =============================================================== */
CT.views.commandes = {
  label: 'Commandes',
  icon: '📋',
  _orders: [],
  _filter: 'all',
  _search: '',

  load: async function(el) {
    el.innerHTML = CT.html.loading();
    CT.html.destroyCharts();
    try {
      var result = await CT.api.adminOrders({ limit: 500 });
      // API may return array directly or { orders: [...] } or { data: [...] }
      this._orders = Array.isArray(result) ? result : (result.orders || result.data || []);
      this._filter = 'all';
      this._search = '';
      this._render(el);
    } catch(e) {
      el.innerHTML = CT.html.error(e.message);
    }
  },

  _filtered: function() {
    var self = this;
    var orders = this._filter === 'all'
      ? this._orders
      : this._orders.filter(function(o) { return o.status === self._filter; });
    if (this._search) {
      var q = this._search.toLowerCase();
      orders = orders.filter(function(o) {
        return (o.reference || '').toLowerCase().includes(q) ||
               (o.recipient_name || o.client_name || '').toLowerCase().includes(q);
      });
    }
    return orders;
  },

  _render: function(el) {
    var self = this;
    var allStatuses = ['all','new','confirmed','ordered','preparation','shipped','in_transit','available','collected','cancelled','refunded'];
    var statusLabels = {
      all:'Tous', new:'Nouveau', confirmed:'Confirmé', ordered:'Commandé',
      preparation:'Préparation', shipped:'Expédié', in_transit:'En transit',
      available:'Disponible', collected:'Collecté', cancelled:'Annulé', refunded:'Remboursé'
    };

    var orders = this._filtered();
    var total = this._orders.length;

    var html = '<div class="ct-zone ct-zone-action" style="margin-bottom:0">';
    html += '<div class="ct-zone-header" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">';
    html += '<span><span class="ct-zone-tag action">📋 COMMANDES</span> ' + total + ' commandes — <span style="color:var(--ct-text-muted);font-size:.85rem">' + orders.length + ' affichées</span></span>';
    html += '<button onclick="CT.views.commandes.load(document.getElementById(\'content-area\'))" style="padding:4px 12px;border:1px solid var(--ct-border);border-radius:6px;background:var(--ct-bg3);color:var(--ct-text);font-size:.8rem;cursor:pointer">🔄 Rafraîchir</button>';
    html += '</div>';
    html += '<div class="ct-zone-body">';

    // Search bar
    html += '<div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap">';
    html += '<input id="cmd-search" type="text" placeholder="🔍 Rechercher ref, client..." value="' + (this._search || '') + '" ' +
      'oninput="CT.views.commandes._search=this.value;CT.views.commandes._render(document.getElementById(\'content-area\'))" ' +
      'style="flex:1;min-width:200px;padding:6px 12px;border:1px solid var(--ct-border);border-radius:8px;background:var(--ct-bg3);color:var(--ct-text);font-size:.85rem">';
    html += '</div>';

    // Filter chips
    html += '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">';
    allStatuses.forEach(function(s) {
      var count = s === 'all' ? total : self._orders.filter(function(o) { return o.status === s; }).length;
      if (s !== 'all' && count === 0) return;
      var active = s === self._filter;
      var hex = CT.html.STATUS_HEX[s] || '#64748b';
      var bg = active ? hex : 'var(--ct-bg3)';
      var color = active ? '#fff' : 'var(--ct-text)';
      html += '<button onclick="CT.views.commandes._setFilter(\'' + s + '\')" ' +
        'style="padding:4px 12px;border:none;border-radius:20px;font-size:.75rem;font-weight:600;cursor:pointer;' +
        'background:' + bg + ';color:' + color + ';transition:all .15s">' +
        statusLabels[s] + ' <span style="opacity:.7">(' + count + ')</span></button>';
    });
    html += '</div>';

    // Table — lignes cliquables → panneau détail commande
    if (orders.length === 0) {
      html += CT.html.empty('🔍', 'Aucune commande trouvée');
    } else {
      html += '<div style="font-size:.75rem;color:var(--ct-text-muted);margin-bottom:6px">💡 Cliquez sur une ligne pour voir ses colis et sa timeline</div>';
      var tbl = '<div class="ct-table-wrap"><table class="ct-table"><thead><tr>';
      ['Réf.', 'Destinataire', 'Montant', 'Statut', 'Île', 'Paiement', 'Âge', '📱'].forEach(function(h) { tbl += '<th>' + h + '</th>'; });
      tbl += '</tr></thead><tbody>';
      orders.forEach(function(o) {
        var payBadge = o.payment_status === 'paid'
          ? '<span style="color:#10b981;font-size:.7rem;font-weight:700">✓ Payé</span>'
          : '<span style="color:var(--ct-text-muted);font-size:.7rem">' + (o.payment_method || o.payment_mode || '—') + '</span>';
        tbl += '<tr style="cursor:pointer" onclick="CT.html.showOrderDetail(\'' + o.id + '\',\'' + (o.reference||'') + '\')" title="Voir colis et détail">';
        tbl += '<td><span class="ct-font-mono" style="font-weight:700;font-size:.8rem;color:var(--ct-blue)">' + (o.reference || '—') + '</span></td>';
        tbl += '<td><span style="font-size:.85rem">' + (o.recipient_name || o.client_name || '—') + '</span></td>';
        tbl += '<td><span style="font-weight:600;font-size:.85rem">' + CT.html.formatKMF(o.total_amount || o.total_kmf) + '</span></td>';
        tbl += '<td>' + CT.html.statusChip(o.id, o.reference, o.status) + '</td>';
        tbl += '<td><span style="font-size:.8rem">' + (o.destination_island || '—') + '</span></td>';
        tbl += '<td>' + payBadge + '</td>';
        tbl += '<td><span style="font-size:.75rem;color:var(--ct-text-muted)">' + CT.html._age(o.updated_at || o.created_at) + '</span></td>';
        tbl += '<td onclick="event.stopPropagation()">' + CT.html.whatsappBtn(o.client_phone || o.recipient_phone, o.reference, o.status, true) + '</td>';
        tbl += '</tr>';
      });
      tbl += '</tbody></table></div>';
      html += tbl;
    }

    html += '</div></div>';
    el.innerHTML = html;
  },

  _setFilter: function(f) {
    this._filter = f;
    var el = document.getElementById('content-area');
    if (el) this._render(el);
  }
};

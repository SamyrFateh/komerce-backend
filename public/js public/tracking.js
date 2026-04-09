/* ============================================================
   KOMERCE — Suivi commande
   ============================================================ */

async function searchTracking() {
  var ref = $('tracking-input').value.trim();
  if (!ref) { toast('Veuillez entrer une référence.', 'error'); return; }
  var result = $('tracking-result');
  result.style.display = 'block';
  result.innerHTML = '';
  var loading = document.createElement('p');
  loading.style.cssText = 'text-align:center;color:var(--muted);padding:16px;';
  loading.textContent = 'Recherche en cours…';
  result.appendChild(loading);
  try {
    var data = await apiGet('/api/orders/' + encodeURIComponent(ref));
    result.innerHTML = '';
    var order = data.order || data;

    /* Determine effective status — prefer parcel-based if available */
    var parcels = order.parcels || [];
    var effectiveStatus = (order.status || 'confirmed').toLowerCase();
    if (parcels.length > 0) {
      var statusOrder = TRACKING_STEPS.map(function(s) { return s.key; });
      var minIdx = statusOrder.length;
      parcels.forEach(function(p) {
        var idx = statusOrder.indexOf((p.status || '').toLowerCase());
        if (idx >= 0 && idx < minIdx) minIdx = idx;
      });
      if (minIdx < statusOrder.length) effectiveStatus = statusOrder[minIdx];
    }

    var refDiv = document.createElement('div');
    refDiv.style.cssText = 'font-weight:700;margin-bottom:16px;font-size:1rem;';
    refDiv.textContent = 'Commande : ' + sanitize(order.reference || ref);
    result.appendChild(refDiv);

    /* Parcel count hint */
    if (parcels.length > 1) {
      var hint = document.createElement('div');
      hint.style.cssText = 'font-size:0.8rem;color:var(--muted);margin-bottom:12px;';
      hint.textContent = '📦 ' + parcels.length + ' colis pour cette commande';
      result.appendChild(hint);
    }

    var timeline = document.createElement('div');
    timeline.className = 'timeline';
    var reachedCurrent = false;
    TRACKING_STEPS.forEach(function(step) {
      var stepDiv = document.createElement('div');
      stepDiv.className = 'timeline-step';
      if (!reachedCurrent) {
        if (step.key === effectiveStatus) { stepDiv.classList.add('current'); reachedCurrent = true; }
        else { stepDiv.classList.add('done'); }
      }
      var dot = document.createElement('div');
      dot.className = 'timeline-dot';
      dot.textContent = step.icon;
      stepDiv.appendChild(dot);
      var label = document.createElement('div');
      label.className = 'timeline-label';
      label.textContent = step.label;
      stepDiv.appendChild(label);
      timeline.appendChild(stepDiv);
    });
    result.appendChild(timeline);
  } catch (e) {
    result.innerHTML = '';
    var err = document.createElement('div');
    err.className = 'tracking-error';
    err.textContent = 'Commande non trouvée. Vérifiez votre référence.';
    result.appendChild(err);
  }
}

/* ──────────────────────────────────────
   INIT
   ────────────────────────────────────── */
/* ── Clear entire cart ── */

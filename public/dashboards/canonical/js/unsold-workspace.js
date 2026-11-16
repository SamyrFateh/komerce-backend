/**
 * @komerce-arch
 * @role          unsold-admin-screen
 * @domain        unsold-resolution
 * @layer         ui-workspace
 * @criticality   medium
 * @inputs        /api/unsold (liste, stats, PATCH, resolve, whatsapp, scan)
 * @outputs       gestes admin sur invendus ; refus F3 affichés
 * @depends       routes/unsold.js (inchangée)
 * @used-by       /dashboards/canonical/unsold.html
 * @db-read       none
 * @db-write      none
 * @doctrine      f3_no_liquidation_of_paid_order, ui_never_grants_more_than_server
 * @impact-areas  admin-dashboard, unsold
 * @version       2026-11
 */
'use strict';
(function bootUnsold(global) {
  const RESOLVE_LABEL = Object.freeze({
    sold_whatsapp: 'Vendu par WhatsApp', sold_reseller: 'Vendu à un revendeur',
    donated: 'Donné', destroyed: 'Détruit',
  });

  // Message clair pour chaque refus serveur (F3 : jamais de liquidation d'une commande payée).
  function refusalMessage(status, body) {
    const code = body && body.code;
    if (status === 409 && code === 'UNSOLD_NO_SHOW_NOT_CERTIFIED') {
      return 'Refusé (409) : pas de liquidation automatique d’un colis non retiré. '
        + 'Un colis payé reste la propriété du client tant que son code de retrait peut fonctionner : intervention du marché requise.';
    }
    if (status === 404) {
      return 'Refusé : invendu introuvable, déjà résolu, ou commande payée (jamais liquidable).';
    }
    if (status === 400) return 'Refusé : ' + ((body && body.error) || 'requête invalide') + '.';
    if (status === 401 || status === 403) return 'Accès réservé à l’administrateur.';
    return 'Erreur serveur (' + status + ').';
  }

  // Une ligne n'est actionnable que si elle est « available » et non payée.
  // La route filtre déjà les commandes payées ; on double la garde côté écran.
  function isActionable(row) {
    return !!row && row.status === 'available' && row.payment_status !== 'paid';
  }

  async function call(method, url, body) {
    const res = await global.fetch(url, {
      method, credentials: 'same-origin',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch (_e) { data = {}; }
    return { ok: res.ok, status: res.status, data };
  }

  const fmt = (n) => (n == null ? '—' : new Intl.NumberFormat('fr-FR').format(Math.round(Number(n))) + ' KMF');

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { refusalMessage, isActionable, RESOLVE_LABEL };
  }
  const doc = global.document;
  const root = doc && doc.getElementById('unsold-root');
  if (!root) return;

  function el(tag, cls, text) {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = String(text);
    return n;
  }

  const feedback = el('p', 'unsold-feedback');
  feedback.setAttribute('role', 'status');
  feedback.setAttribute('data-unsold-feedback', '');
  const body = el('div', 'unsold-body');

  function say(msg, isError) {
    feedback.textContent = msg;
    feedback.className = 'unsold-feedback' + (isError ? ' unsold-feedback--error' : '');
  }

  function rowActions(row) {
    const td = el('td', 'unsold-actions');
    if (!isActionable(row)) { td.appendChild(el('small', null, 'Aucune action')); return td; }
    const price = el('input'); price.type = 'number'; price.min = '0'; price.value = row.unsold_price_kmf;
    price.setAttribute('aria-label', 'Prix soldé'); price.setAttribute('data-unsold-price', '');
    const channel = el('select'); channel.setAttribute('aria-label', 'Canal'); channel.setAttribute('data-unsold-channel', '');
    ['whatsapp', 'reseller', 'both'].forEach((c) => {
      const o = el('option', null, c); o.value = c; if (row.channel === c) o.selected = true; channel.appendChild(o);
    });
    const save = el('button', null, 'Enregistrer'); save.type = 'button'; save.setAttribute('data-unsold-save', '');
    save.onclick = async () => {
      const r = await call('PATCH', '/api/unsold/' + encodeURIComponent(row.id),
        { unsold_price_kmf: Number(price.value), channel: channel.value });
      say(r.ok ? 'Invendu mis à jour.' : refusalMessage(r.status, r.data), !r.ok);
      if (r.ok) load();
    };
    const wa = el('button', null, 'Message WhatsApp'); wa.type = 'button'; wa.setAttribute('data-unsold-whatsapp', '');
    wa.onclick = async () => {
      const r = await call('GET', '/api/unsold/' + encodeURIComponent(row.id) + '/whatsapp');
      if (!r.ok) return say(refusalMessage(r.status, r.data), true);
      say('', false);
      const pre = el('pre', 'unsold-wa', r.data.message); pre.setAttribute('data-unsold-wa-message', '');
      td.appendChild(pre);
    };
    const status = el('select'); status.setAttribute('aria-label', 'Résolution'); status.setAttribute('data-unsold-resolve-status', '');
    Object.keys(RESOLVE_LABEL).forEach((k) => { const o = el('option', null, RESOLVE_LABEL[k]); o.value = k; status.appendChild(o); });
    const resolved = el('input'); resolved.type = 'number'; resolved.min = '0'; resolved.placeholder = 'Prix obtenu';
    resolved.setAttribute('aria-label', 'Prix obtenu'); resolved.setAttribute('data-unsold-resolved-price', '');
    const res = el('button', null, 'Résoudre'); res.type = 'button'; res.setAttribute('data-unsold-resolve', '');
    res.onclick = async () => {
      const r = await call('POST', '/api/unsold/' + encodeURIComponent(row.id) + '/resolve', {
        status: status.value,
        resolved_price_kmf: resolved.value === '' ? null : Number(resolved.value),
      });
      say(r.ok ? 'Invendu résolu : ' + RESOLVE_LABEL[status.value] + '.' : refusalMessage(r.status, r.data), !r.ok);
      if (r.ok) load();
    };
    [price, channel, save, wa, status, resolved, res].forEach((n) => td.appendChild(n));
    return td;
  }

  function render(rows, stats) {
    body.textContent = '';
    const kpis = el('p', 'unsold-kpis',
      'Articles actifs : ' + (stats.total_actifs || 0) + ' · Valeur liquidation : ' + fmt(stats.valeur_liquidation_kmf));
    kpis.setAttribute('data-unsold-kpis', '');
    body.appendChild(kpis);
    if (!rows.length) { body.appendChild(el('p', 'unsold-empty', 'Aucun invendu à traiter.')); return; }
    const table = el('table', 'unsold-table');
    const head = el('tr');
    ['Commande', 'Produit', 'Prix initial', 'Prix soldé', 'Remise', 'Canal', 'Jours', 'Actions']
      .forEach((h) => head.appendChild(el('th', null, h)));
    table.appendChild(head);
    rows.forEach((row) => {
      const tr = el('tr'); tr.setAttribute('data-unsold-row', row.id);
      [row.order_ref, row.product_name, fmt(row.original_price_kmf), fmt(row.unsold_price_kmf),
        (row.remise_pct != null ? row.remise_pct + ' %' : '—'), row.channel,
        row.jours_en_stock != null ? Math.floor(Number(row.jours_en_stock)) : '—']
        .forEach((v) => tr.appendChild(el('td', null, v)));
      tr.appendChild(rowActions(row));
      table.appendChild(tr);
    });
    body.appendChild(table);
  }

  async function load() {
    const [list, stats] = await Promise.all([call('GET', '/api/unsold'), call('GET', '/api/unsold/stats/summary')]);
    if (!list.ok) { say(refusalMessage(list.status, list.data), true); return; }
    render(Array.isArray(list.data) ? list.data : [], stats.ok ? stats.data : {});
  }

  const scan = el('button', null, 'Lancer le scan automatique des colis non retirés');
  scan.type = 'button'; scan.setAttribute('data-unsold-scan', '');
  scan.onclick = async () => {
    const r = await call('POST', '/api/unsold/scan');
    say(refusalMessage(r.status, r.data), !r.ok);
  };

  root.textContent = '';
  root.appendChild(el('p', 'canonical-eyebrow', 'KOMERCE · OPÉRATIONS'));
  root.appendChild(el('h1', null, 'Invendus'));
  root.appendChild(el('p', 'unsold-doctrine',
    'Garde F3 : une commande payée n’est jamais liquidée ni revendue. Seuls les invendus non payés sont listés et actionnables.'));
  root.appendChild(scan);
  root.appendChild(feedback);
  root.appendChild(body);
  load();
})(typeof window !== 'undefined' ? window : globalThis);

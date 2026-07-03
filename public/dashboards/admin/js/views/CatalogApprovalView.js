/**
 * @komerce-arch
 * @role          admin-catalog-approval-view
 * @domain        admin-dashboard
 * @layer         ui-page
 * @criticality   high
 * @inputs        approval_queue_items, categories
 * @outputs       catalog_approval_page_dom (file d'approbation, approve/reject/override)
 * @depends       utils.js
 * @used-by       none
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      kmc_api_only
 * @impact-areas  catalog, admin-dashboard
 * @version       2026-07
 */

'use strict';
/**
 * KOMERCE Dashboard — Vue /admin/catalog-approval (K-4)
 * ════════════════════════════════════════════════════════════════════════
 * File d'approbation catalogue — étage ⑥ (DOCTRINE_CATALOGUE.md §6) :
 * un écran, trois actions. Chaque fiche générée par le pipeline (K-3,
 * content_source connector_raw|ai_enriched) arrive candidate et inactive.
 * C'est ici, et seulement ici, qu'elle peut être publiée.
 *
 *   Approuver → publie tel quel.
 *   Rejeter   → ne publie jamais, raison obligatoire, tracée dans `alerts`.
 *   Corriger  → pose des overrides tracés (name/description/category/
 *               fragility/emoji, doctrine §5) PUIS publie dans le même geste.
 *
 * API : GET  /api/admin/catalog/approval-queue
 *       POST /api/admin/catalog/approval-queue/:id/approve
 *       POST /api/admin/catalog/approval-queue/:id/reject   { reason }
 *       POST /api/admin/catalog/approval-queue/:id/override { fields, reason }
 */

(function (global) {
  'use strict';

  const API_QUEUE = '/api/admin/catalog/approval-queue';
  const API_CATEGORIES = '/api/categories';

  const PAGE_SIZE = 20;

  // Whitelist miroir de services/catalog-overrides.js (OVERRIDABLE_FIELDS) —
  // c'est le contrat backend qui fait foi ; le formulaire ne doit jamais
  // proposer un champ que le backend refuserait (422 OVERRIDE_FIELD_NOT_ALLOWED).
  const OVERRIDABLE_FIELDS = ['name', 'description', 'category', 'fragility', 'emoji'];
  const ALLOWED_FRAGILITIES = ['fragile', 'electronique', 'sensible_chaleur', 'sensible_humidite'];

  // ─── Helpers ────────────────────────────────────────────────────────────

  function toast(msg, type = 'success') {
    const t = document.createElement('div');
    t.className = `toast toast-${type}`;
    t.textContent = msg;
    Object.assign(t.style, {
      position: 'fixed', bottom: '24px', right: '24px', zIndex: 9999,
      background: type === 'success' ? 'var(--success,#22c55e)' : 'var(--danger,#ef4444)',
      color: '#fff', padding: '10px 18px', borderRadius: '8px',
      fontSize: '14px', boxShadow: '0 4px 12px rgba(0,0,0,.15)',
      transition: 'opacity .4s',
    });
    document.body.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 400); }, 3000);
  }

  function fmtKmf(n) {
    if (n === null || n === undefined) return '—';
    return Number(n).toLocaleString('fr-FR') + ' KMF';
  }

  function confidenceBadge(c) {
    if (c === null || c === undefined) return '<span style="color:var(--text-secondary,#6b7280);">—</span>';
    const pct = Math.round(Number(c) * 100);
    const color = pct >= 80 ? '#16a34a' : pct >= 50 ? '#d97706' : '#dc2626';
    return `<span style="font-weight:700;color:${color};">${pct}%</span>`;
  }

  function sourceLabel(s) {
    return s === 'connector_raw' ? 'Connecteur (brut)' : s === 'ai_enriched' ? 'Enrichi IA' : esc(s || '—');
  }

  async function apiFetch(path, opts = {}) {
    const res = await fetch(API_QUEUE + path, {
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      ...opts,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      const e = new Error(err.error || `HTTP ${res.status}`);
      e.code = err.code;
      throw e;
    }
    return res.json();
  }

  let _categoriesCache = null;
  async function loadCategories() {
    if (_categoriesCache) return _categoriesCache;
    const res = await fetch(API_CATEGORIES, { credentials: 'include' }); // kmc-api-allow: référentiel catégories, endpoint distinct de API_QUEUE
    if (!res.ok) return [];
    _categoriesCache = await res.json().catch(() => []);
    return _categoriesCache;
  }

  // ─── Modal générique (overlay + form) ──────────────────────────────────

  function modal(title, bodyHTML, onSubmit) {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1000;display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = `
      <div style="background:var(--bg-surface,#fff);border-radius:12px;padding:24px;width:640px;max-width:96vw;max-height:90vh;overflow-y:auto;position:relative;">
        <button id="ca-modal-close" style="position:absolute;top:12px;right:16px;background:none;border:none;font-size:20px;cursor:pointer;">✕</button>
        <h2 style="margin:0 0 20px;font-size:18px;">${esc(title)}</h2>
        <form id="ca-modal-form">
          ${bodyHTML}
          <div id="ca-modal-error" style="color:var(--danger,#ef4444);font-size:13px;margin-top:8px;"></div>
          <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:20px;">
            <button type="button" id="ca-modal-cancel" class="btn btn-secondary">Annuler</button>
            <button type="submit" class="btn btn-primary">Confirmer</button>
          </div>
        </form>
      </div>`;
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.querySelector('#ca-modal-close').addEventListener('click', close);
    overlay.querySelector('#ca-modal-cancel').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    const form = overlay.querySelector('#ca-modal-form');
    const errBox = overlay.querySelector('#ca-modal-error');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errBox.textContent = '';
      const submitBtn = form.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      try {
        await onSubmit(new FormData(form));
        close();
      } catch (err) {
        errBox.textContent = err.message;
        submitBtn.disabled = false;
      }
    });

    return overlay;
  }

  // ─── Rejet (raison obligatoire) ─────────────────────────────────────────

  function showRejectModal(item, onRefresh) {
    modal(
      `Rejeter « ${item.name} »`,
      `
        <label style="display:block;font-size:13px;font-weight:600;margin-bottom:6px;">Raison du rejet *</label>
        <textarea name="reason" required rows="3" class="form-input" style="width:100%;"
                  placeholder="Ex : photo non conforme, doublon, hors périmètre..."></textarea>
      `,
      async (fd) => {
        const reason = (fd.get('reason') || '').trim();
        if (!reason) throw new Error('Raison obligatoire');
        await apiFetch(`/${item.id}/reject`, { method: 'POST', body: JSON.stringify({ reason }) });
        toast('Fiche rejetée');
        await onRefresh();
      }
    );
  }

  // ─── Correction + approbation (overrides tracés, doctrine §5) ──────────

  async function showOverrideModal(item, onRefresh) {
    const cats = await loadCategories().catch(() => []);
    const catOptions = cats.length
      ? cats.map(c => `<option value="${escAttr(c.key)}" ${c.key === item.category ? 'selected' : ''}>${esc(c.label || c.key)}</option>`).join('')
      : `<option value="${escAttr(item.category || '')}" selected>${esc(item.category || '—')}</option>`;

    const fragilityOptions = ['<option value="">(aucune)</option>']
      .concat(ALLOWED_FRAGILITIES.map(f => `<option value="${f}" ${f === item.fragility ? 'selected' : ''}>${f}</option>`))
      .join('');

    modal(
      `Corriger « ${item.name} »`,
      `
        <p style="font-size:12px;color:var(--text-secondary,#6b7280);margin:0 0 16px;">
          Chaque champ modifié devient un override tracé, réappliqué après chaque re-raffinage.
          Seuls les champs effectivement changés sont envoyés.
        </p>
        <label style="display:block;font-size:13px;font-weight:600;margin-bottom:6px;">Nom</label>
        <input name="name" type="text" class="form-input" style="width:100%;margin-bottom:14px;" value="${escAttr(item.name || '')}">

        <label style="display:block;font-size:13px;font-weight:600;margin-bottom:6px;">Description</label>
        <textarea name="description" rows="4" class="form-input" style="width:100%;margin-bottom:14px;">${esc(item.description || '')}</textarea>

        <label style="display:block;font-size:13px;font-weight:600;margin-bottom:6px;">Catégorie</label>
        <select name="category" class="form-input" style="width:100%;margin-bottom:14px;">${catOptions}</select>

        <label style="display:block;font-size:13px;font-weight:600;margin-bottom:6px;">Fragilité</label>
        <select name="fragility" class="form-input" style="width:100%;margin-bottom:14px;">${fragilityOptions}</select>

        <label style="display:block;font-size:13px;font-weight:600;margin-bottom:6px;">Emoji</label>
        <input name="emoji" type="text" maxlength="4" class="form-input" style="width:100px;margin-bottom:14px;" value="${escAttr(item.emoji || '')}">

        <label style="display:block;font-size:13px;font-weight:600;margin-bottom:6px;">Raison de la correction</label>
        <input name="reason" type="text" class="form-input" style="width:100%;" placeholder="Ex : traduction, faute, mauvaise catégorie...">
      `,
      async (fd) => {
        const fields = {};
        for (const f of OVERRIDABLE_FIELDS) {
          const raw = (fd.get(f) || '').toString();
          const before = (item[f] || '').toString();
          if (raw.trim() !== before.trim()) fields[f] = raw.trim();
        }
        if (!Object.keys(fields).length) {
          throw new Error('Aucun champ modifié');
        }
        const reason = (fd.get('reason') || '').trim() || undefined;
        const body = await apiFetch(`/${item.id}/override`, {
          method: 'POST',
          body: JSON.stringify({ fields, reason }),
        });
        toast(`Corrigé et approuvé (${(body.overridden || []).join(', ')})`);
        await onRefresh();
      }
    );
  }

  // ─── Approbation directe ────────────────────────────────────────────────

  async function approve(item, onRefresh) {
    if (!window.confirm(`Approuver « ${item.name} » tel quel ?`)) return;
    try {
      await apiFetch(`/${item.id}/approve`, { method: 'POST' });
      toast('Fiche approuvée et publiée');
      await onRefresh();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  // ─── Ligne de la file ────────────────────────────────────────────────────

  function renderRow(item, onRefresh) {
    const row = document.createElement('tr');
    row.style.cssText = 'border-top:1px solid var(--border,#e5e7eb);';
    if (item.needs_review) row.style.background = 'rgba(217,119,6,.06)';

    row.innerHTML = `
      <td style="padding:10px 12px;max-width:280px;">
        <div style="font-weight:600;">${esc(item.emoji || '')} ${esc(item.name)}</div>
        <div style="font-size:12px;color:var(--text-secondary,#6b7280);margin-top:2px;">${esc(item.category || '—')}</div>
      </td>
      <td style="padding:10px 12px;text-align:right;">${fmtKmf(item.price_kmf)}</td>
      <td style="padding:10px 12px;text-align:center;">${item.stock ?? '—'}</td>
      <td style="padding:10px 12px;text-align:center;">${confidenceBadge(item.enrichment_confidence)}</td>
      <td style="padding:10px 12px;text-align:center;">
        ${item.needs_review
          ? '<span style="background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:10px;font-size:12px;font-weight:600;">À relire</span>'
          : '<span style="color:var(--text-secondary,#6b7280);font-size:12px;">—</span>'}
      </td>
      <td style="padding:10px 12px;font-size:12px;color:var(--text-secondary,#6b7280);">${sourceLabel(item.content_source)}</td>
      <td style="padding:10px 12px;text-align:right;white-space:nowrap;">
        <button class="btn btn-sm btn-primary" data-act="approve">✅ Approuver</button>
        <button class="btn btn-sm btn-secondary" data-act="override">✏️ Corriger</button>
        <button class="btn btn-sm btn-danger" data-act="reject">✖ Rejeter</button>
      </td>
    `;

    row.querySelector('[data-act="approve"]').addEventListener('click', () => approve(item, onRefresh));
    row.querySelector('[data-act="reject"]').addEventListener('click', () => showRejectModal(item, onRefresh));
    row.querySelector('[data-act="override"]').addEventListener('click', () =>
      showOverrideModal(item, onRefresh).catch(err => toast(err.message, 'error')));

    return row;
  }

  // ─── Vue principale ──────────────────────────────────────────────────────

  let _currentPage = 1;

  async function CatalogApprovalView(container) {
    container.innerHTML = '<div style="padding:20px;color:var(--text-secondary,#6b7280);">Chargement…</div>';

    container.innerHTML = `
      <div style="padding:24px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;flex-wrap:wrap;gap:12px;">
          <h1 style="margin:0;font-size:22px;">✅ File d'approbation catalogue</h1>
        </div>
        <p style="color:var(--text-secondary,#6b7280);font-size:13px;margin:0 0 20px;">
          Étage ⑥ — seul point de validation humaine avant publication d'une fiche générée par le pipeline
          (connecteur ou IA). Rien ne passe en boutique sans avoir transité ici.
        </p>
        <div id="ca-table-wrap"></div>
        <div id="ca-pagination" style="margin-top:16px;display:flex;gap:8px;align-items:center;"></div>
      </div>`;

    const tableWrap  = container.querySelector('#ca-table-wrap');
    const pagination = container.querySelector('#ca-pagination');

    async function loadPage(page = 1) {
      _currentPage = page;
      const offset = (page - 1) * PAGE_SIZE;
      tableWrap.innerHTML = '<div style="padding:20px;color:var(--text-secondary,#6b7280);">Chargement…</div>';

      let data;
      try {
        data = await apiFetch(`?${new URLSearchParams({ limit: PAGE_SIZE, offset })}`);
      } catch (err) {
        const d = document.createElement('div');
        d.style.cssText = 'padding:20px;color:var(--danger,#ef4444);';
        d.textContent = `Erreur : ${err.message}`; // textContent — pas d'innerHTML, évite XSS
        tableWrap.replaceChildren(d);
        return;
      }

      const items = data.items || [];
      const total = data.total || 0;
      const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

      if (!items.length) {
        tableWrap.innerHTML = '<div style="padding:32px;text-align:center;color:var(--text-secondary,#6b7280);">🎉 File vide — rien à approuver pour le moment.</div>';
        pagination.innerHTML = '';
        return;
      }

      const table = document.createElement('table');
      table.style.cssText = 'width:100%;border-collapse:collapse;font-size:13px;';
      table.innerHTML = `
        <thead>
          <tr style="background:var(--bg-secondary,#f9fafb);text-align:left;">
            <th style="padding:10px 12px;">Produit</th>
            <th style="padding:10px 12px;text-align:right;">Prix</th>
            <th style="padding:10px 12px;text-align:center;">Stock</th>
            <th style="padding:10px 12px;text-align:center;">Confiance IA</th>
            <th style="padding:10px 12px;text-align:center;">Statut</th>
            <th style="padding:10px 12px;">Source</th>
            <th style="padding:10px 12px;text-align:right;">Actions</th>
          </tr>
        </thead>
        <tbody id="ca-tbody"></tbody>`;

      const tbody = table.querySelector('#ca-tbody');
      items.forEach(item => tbody.appendChild(renderRow(item, () => loadPage(_currentPage))));

      tableWrap.innerHTML = '';
      tableWrap.appendChild(table);

      pagination.innerHTML = `<span style="font-size:13px;color:var(--text-secondary,#6b7280);">${total} candidat(s) — Page ${page}/${totalPages}</span>`;
      if (page > 1) {
        const prev = document.createElement('button');
        prev.className = 'btn btn-sm btn-secondary';
        prev.textContent = '← Précédent';
        prev.addEventListener('click', () => loadPage(page - 1));
        pagination.appendChild(prev);
      }
      if (page < totalPages) {
        const next = document.createElement('button');
        next.className = 'btn btn-sm btn-secondary';
        next.textContent = 'Suivant →';
        next.addEventListener('click', () => loadPage(page + 1));
        pagination.appendChild(next);
      }
    }

    await loadPage(1);
  }

  global.CatalogApprovalView = { render: CatalogApprovalView };

}(window));

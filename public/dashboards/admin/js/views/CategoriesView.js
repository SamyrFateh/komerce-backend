/**
 * KOMERCE Dashboard — Vue /admin/categories
 * ════════════════════════════════════════════════════════════════════════
 * Gestion CRUD des catégories et sous-catégories boutique.
 * API: GET/POST/PUT/DELETE /api/admin/boutique-categories
 */

(function (global) {
  'use strict';

  const API = '/api/admin/boutique-categories';

  // ─── Helpers ──────────────────────────────────────────────────────────────

  async function apiFetch(path, opts = {}) {
    const res = await fetch(API + path, {
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      ...opts,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.status === 204 ? null : res.json();
  }

  function toast(msg, type = 'success') {
    const t = document.createElement('div');
    t.className = `toast toast-${type}`;
    t.textContent = msg;
    Object.assign(t.style, {
      position: 'fixed', bottom: '24px', right: '24px', zIndex: 9999,
      background: type === 'success' ? 'var(--success, #22c55e)' : 'var(--danger, #ef4444)',
      color: '#fff', padding: '10px 18px', borderRadius: '8px',
      fontSize: '14px', boxShadow: '0 4px 12px rgba(0,0,0,.15)',
      transition: 'opacity .4s',
    });
    document.body.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 400); }, 3000);
  }

  function confirm(msg) {
    return window.confirm(msg);
  }

  // ─── Rendu catégorie (ligne) ───────────────────────────────────────────────

  function renderCatRow(cat, onRefresh) {
    const row = document.createElement('div');
    row.className = 'cat-row card';
    row.style.cssText = 'margin-bottom:12px;padding:16px;';

    row.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
        <span style="font-size:22px;">${cat.section_emoji || '📦'}</span>
        <div style="flex:1;min-width:120px;">
          <strong>${cat.label}</strong>
          <span style="color:var(--text-secondary);font-size:12px;margin-left:8px;">${cat.key}</span>
          ${!cat.is_active ? '<span style="color:var(--danger,#ef4444);font-size:12px;margin-left:8px;">[inactif]</span>' : ''}
        </div>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-sm btn-secondary" data-action="edit-cat" data-key="${cat.key}">✏️ Modifier</button>
          <button class="btn btn-sm ${cat.is_active ? 'btn-warning' : 'btn-success'}" data-action="toggle-cat" data-key="${cat.key}">
            ${cat.is_active ? '🚫 Désactiver' : '✅ Activer'}
          </button>
        </div>
      </div>
      <div style="margin-top:12px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
          <strong style="font-size:13px;color:var(--text-secondary);">Sous-catégories (${(cat.subcategories || []).length})</strong>
          <button class="btn btn-sm btn-primary" data-action="add-subcat" data-key="${cat.key}">+ Ajouter</button>
        </div>
        <div class="subcats-list" data-cat="${cat.key}">
          ${(cat.subcategories || []).map(s => renderSubcatChip(s, cat.key)).join('')}
        </div>
      </div>
    `;

    row.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      const key    = btn.dataset.key;
      const subKey = btn.dataset.sub;

      try {
        if (action === 'edit-cat')    await showEditCatModal(cat, onRefresh);
        if (action === 'toggle-cat')  await toggleCat(key, cat.is_active, onRefresh);
        if (action === 'add-subcat')  await showAddSubcatModal(key, onRefresh);
        if (action === 'edit-subcat') await showEditSubcatModal(key, subKey, cat.subcategories, onRefresh);
        if (action === 'del-subcat')  await deleteSubcat(key, subKey, onRefresh);
      } catch (err) {
        toast(err.message, 'error');
      }
    });

    return row;
  }

  function renderSubcatChip(s, catKey) {
    return `<span style="display:inline-flex;align-items:center;gap:6px;background:var(--bg-secondary,#f4f4f5);
      border-radius:20px;padding:4px 10px;margin:3px;font-size:13px;">
      ${s.icon || '✨'} ${s.label}
      <button class="btn-icon" style="background:none;border:none;cursor:pointer;padding:0;margin-left:4px;"
        data-action="edit-subcat" data-key="${catKey}" data-sub="${s.key}" title="Modifier">✏️</button>
      <button class="btn-icon" style="background:none;border:none;cursor:pointer;padding:0;"
        data-action="del-subcat" data-key="${catKey}" data-sub="${s.key}" title="Supprimer">🗑</button>
    </span>`;
  }

  // ─── Modals ───────────────────────────────────────────────────────────────

  function modal(title, bodyHtml, onSubmit) {
    const overlay = document.createElement('div');
    overlay.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1000;
      display:flex;align-items:center;justify-content:center;`;

    overlay.innerHTML = `
      <div style="background:var(--bg-card,#fff);border-radius:12px;padding:24px;width:480px;max-width:95vw;max-height:90vh;overflow-y:auto;">
        <h3 style="margin:0 0 16px;">${title}</h3>
        <form id="modal-form">${bodyHtml}</form>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">
          <button type="button" id="modal-cancel" class="btn btn-secondary">Annuler</button>
          <button type="submit" form="modal-form" class="btn btn-primary">Enregistrer</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    overlay.querySelector('#modal-cancel').addEventListener('click', () => overlay.remove());
    overlay.querySelector('#modal-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await onSubmit(new FormData(e.target));
        overlay.remove();
      } catch (err) {
        toast(err.message, 'error');
      }
    });

    return overlay;
  }

  async function showAddCatModal(onRefresh) {
    modal('Nouvelle catégorie', `
      <label>Clé (unique, ex: Bijoux)<br><input name="key" required class="form-input" style="width:100%;"></label><br><br>
      <label>Label affiché<br><input name="label" required class="form-input" style="width:100%;"></label><br><br>
      <label>Label court<br><input name="short_label" class="form-input" style="width:100%;"></label><br><br>
      <label>Emoji section<br><input name="section_emoji" class="form-input" value="📦" style="width:80px;"></label><br><br>
      <label>Clés DB (valeurs products.category, séparées par virgule)<br>
        <input name="db_keys" class="form-input" style="width:100%;" placeholder="ex: Mode,Beauté"></label><br><br>
      <label>Ordre d'affichage<br><input name="display_order" type="number" class="form-input" value="99" style="width:80px;"></label><br><br>
      <label><input name="show_in_rail" type="checkbox" checked> Afficher dans le rail</label><br>
      <label><input name="show_in_sections" type="checkbox" checked> Afficher comme section</label>
    `, async (fd) => {
      const dbKeysRaw = (fd.get('db_keys') || '').trim();
      const dbKeys = dbKeysRaw ? dbKeysRaw.split(',').map(k => k.trim()).filter(Boolean) : [];
      await apiFetch('/', {
        method: 'POST',
        body: JSON.stringify({
          key:            fd.get('key').trim(),
          label:          fd.get('label').trim(),
          short_label:    fd.get('short_label').trim() || undefined,
          section_emoji:  fd.get('section_emoji').trim() || '📦',
          db_keys:        dbKeys,
          display_order:  parseInt(fd.get('display_order') || '99'),
          show_in_rail:   fd.get('show_in_rail') === 'on',
          show_in_sections: fd.get('show_in_sections') === 'on',
        }),
      });
      toast('Catégorie créée !');
      await onRefresh();
    });
  }

  async function showEditCatModal(cat, onRefresh) {
    modal(`Modifier "${cat.label}"`, `
      <label>Label affiché<br><input name="label" value="${cat.label}" required class="form-input" style="width:100%;"></label><br><br>
      <label>Label court<br><input name="short_label" value="${cat.short_label || ''}" class="form-input" style="width:100%;"></label><br><br>
      <label>Emoji section<br><input name="section_emoji" value="${cat.section_emoji || '📦'}" class="form-input" style="width:80px;"></label><br><br>
      <label>Clés DB (séparées par virgule)<br>
        <input name="db_keys" value="${(cat.db_keys || []).join(',')}" class="form-input" style="width:100%;"></label><br><br>
      <label>Ordre d'affichage<br><input name="display_order" type="number" value="${cat.display_order || 99}" class="form-input" style="width:80px;"></label><br><br>
      <label><input name="show_in_rail" type="checkbox" ${cat.show_in_rail ? 'checked' : ''}> Afficher dans le rail</label><br>
      <label><input name="show_in_sections" type="checkbox" ${cat.show_in_sections ? 'checked' : ''}> Afficher comme section</label>
    `, async (fd) => {
      const dbKeysRaw = (fd.get('db_keys') || '').trim();
      const dbKeys = dbKeysRaw ? dbKeysRaw.split(',').map(k => k.trim()).filter(Boolean) : [];
      await apiFetch(`/${encodeURIComponent(cat.key)}`, {
        method: 'PUT',
        body: JSON.stringify({
          label:          fd.get('label').trim(),
          short_label:    fd.get('short_label').trim() || undefined,
          section_emoji:  fd.get('section_emoji').trim() || '📦',
          db_keys:        dbKeys,
          display_order:  parseInt(fd.get('display_order') || '99'),
          show_in_rail:   fd.get('show_in_rail') === 'on',
          show_in_sections: fd.get('show_in_sections') === 'on',
        }),
      });
      toast('Catégorie modifiée !');
      await onRefresh();
    });
  }

  async function toggleCat(key, isActive, onRefresh) {
    const verb = isActive ? 'désactiver' : 'activer';
    if (!confirm(`Confirmer : ${verb} la catégorie "${key}" ?`)) return;
    await apiFetch(`/${encodeURIComponent(key)}`, {
      method: 'PUT',
      body: JSON.stringify({ is_active: !isActive }),
    });
    toast(isActive ? 'Catégorie désactivée.' : 'Catégorie activée.');
    await onRefresh();
  }

  async function showAddSubcatModal(catKey, onRefresh) {
    modal(`Nouvelle sous-catégorie — ${catKey}`, `
      <label>Clé (ex: Hijab)<br><input name="key" required class="form-input" style="width:100%;"></label><br><br>
      <label>Label affiché<br><input name="label" required class="form-input" style="width:100%;"></label><br><br>
      <label>Icône (emoji)<br><input name="icon" class="form-input" value="✨" style="width:80px;"></label><br><br>
      <label>Ordre d'affichage<br><input name="display_order" type="number" class="form-input" value="99" style="width:80px;"></label>
    `, async (fd) => {
      await apiFetch(`/${encodeURIComponent(catKey)}/subcategories`, {
        method: 'POST',
        body: JSON.stringify({
          key:           fd.get('key').trim(),
          label:         fd.get('label').trim(),
          icon:          fd.get('icon').trim() || '✨',
          display_order: parseInt(fd.get('display_order') || '99'),
        }),
      });
      toast('Sous-catégorie ajoutée !');
      await onRefresh();
    });
  }

  async function showEditSubcatModal(catKey, subKey, subcats, onRefresh) {
    const sub = (subcats || []).find(s => s.key === subKey) || {};
    modal(`Modifier "${subKey}"`, `
      <label>Label affiché<br><input name="label" value="${sub.label || subKey}" required class="form-input" style="width:100%;"></label><br><br>
      <label>Icône (emoji)<br><input name="icon" value="${sub.icon || '✨'}" class="form-input" style="width:80px;"></label><br><br>
      <label>Ordre d'affichage<br><input name="display_order" type="number" value="${sub.display_order || 99}" class="form-input" style="width:80px;"></label>
    `, async (fd) => {
      await apiFetch(`/${encodeURIComponent(catKey)}/subcategories/${encodeURIComponent(subKey)}`, {
        method: 'PUT',
        body: JSON.stringify({
          label:         fd.get('label').trim(),
          icon:          fd.get('icon').trim() || '✨',
          display_order: parseInt(fd.get('display_order') || '99'),
        }),
      });
      toast('Sous-catégorie modifiée !');
      await onRefresh();
    });
  }

  async function deleteSubcat(catKey, subKey, onRefresh) {
    if (!confirm(`Supprimer la sous-catégorie "${subKey}" ?`)) return;
    await apiFetch(`/${encodeURIComponent(catKey)}/subcategories/${encodeURIComponent(subKey)}`, {
      method: 'DELETE',
    });
    toast('Sous-catégorie supprimée.');
    await onRefresh();
  }

  // ─── Render principal ─────────────────────────────────────────────────────

  async function render(rootEl) {
    rootEl.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;flex-wrap:wrap;gap:12px;">
        <div>
          <h1 class="page-title">Catégories boutique</h1>
          <p class="page-subtitle">Gérez les catégories et sous-catégories affichées dans la boutique.</p>
        </div>
        <button id="btn-add-cat" class="btn btn-primary">+ Nouvelle catégorie</button>
      </div>
      <div id="cats-container"><div class="loading-state"><span class="loader"></span> Chargement...</div></div>
    `;

    const container = rootEl.querySelector('#cats-container');

    async function refresh() {
      container.innerHTML = '<div class="loading-state"><span class="loader"></span></div>';
      try {
        const cats = await apiFetch('');
        container.innerHTML = '';
        if (!cats || cats.length === 0) {
          container.innerHTML = '<div class="empty-state">Aucune catégorie — migration 061 jouée ?</div>';
          return;
        }
        cats.forEach(cat => container.appendChild(renderCatRow(cat, refresh)));
      } catch (err) {
        container.innerHTML = `<div class="error-state">Erreur: ${err.message}</div>`;
      }
    }

    rootEl.querySelector('#btn-add-cat').addEventListener('click', () => {
      showAddCatModal(refresh).catch(err => toast(err.message, 'error'));
    });

    await refresh();
  }

  global.CategoriesView = { render };

})(window);

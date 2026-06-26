/**
 * @komerce-arch
 * @role          admin-products-view
 * @domain        admin-dashboard
 * @layer         ui-page
 * @criticality   medium
 * @inputs        products list, categories, product card config
 * @outputs       products_page_dom (grille produits, création, édition, images)
 * @depends       api-client.js, filters-store.js, utils.js, product-card-model.admin.js
 * @used-by       none
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      kmc_api_only
 * @impact-areas  catalog, products, boutique, admin-dashboard
 * @version       2026-06
 */

'use strict';
/**
 * KOMERCE Dashboard — Vue /admin/products
 * ════════════════════════════════════════════════════════════════════════
 * Gestion CRUD des produits boutique depuis le dashboard admin.
 * API: GET/POST/PUT/DELETE /api/products
 *      GET /api/categories (dropdowns taxonomie)
 *
 * Lots couverts:
 *   L1-T1 : liste paginée + modal formulaire (name/price_kmf/stock/image_url/is_active)
 *   L1-T2 : <select> category alimenté par /api/categories
 *   L1-T3 : <select> subcategory dynamique selon category choisie
 *   L1-T4 : validation client avant soumission (category/subcategory dans payload)
 *   L2-T1 : panneau preview mini-carte mis à jour live
 *   L2-T2 : fallback image placeholder dans la preview
 *   L2-T3 : badges promo / nouveau / premium dans la preview
 *   L4-T1..T5 : onglet Diagnostic produits non classés
 */

(function (global) {
  'use strict';

  const API_PRODUCTS   = '/api/products';
  const API_CATEGORIES = '/api/categories';

  const PAGE_SIZE = 50;

  // ─── Cache catégories ──────────────────────────────────────────────────────

  let _categoriesPayload = null; // tableau brut /api/categories

  async function loadCategories() {
    if (_categoriesPayload) return _categoriesPayload;
    const res = await fetch(API_CATEGORIES, { credentials: 'include' }); // kmc-api-allow: référentiel catégories, endpoint distinct de API_PRODUCTS (apiFetch hardcodé)
    if (!res.ok) throw new Error('Impossible de charger les catégories');
    _categoriesPayload = await res.json();
    return _categoriesPayload;
  }

  function validCategoryKeys(cats) {
    const keys = new Set();
    cats.forEach(c => {
      keys.add(c.key);
      if (Array.isArray(c.db_keys)) c.db_keys.forEach(k => keys.add(k));
    });
    return keys;
  }

  function subcatsForCategory(cats, catKey) {
    const cat = cats.find(c => c.key === catKey || (Array.isArray(c.db_keys) && c.db_keys.includes(catKey)));
    return cat ? (cat.subcategories || []) : [];
  }

  // ─── Helpers UI ───────────────────────────────────────────────────────────

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

  function fmt(n) {
    if (n == null) return '—';
    return Number(n).toLocaleString('fr-FR') + ' KMF';
  }

  // ─── Preview mini-carte (L2) ───────────────────────────────────────────────

  /**
   * Construit le HTML de preview carte produit via KProductCardModel.resolve().
   * Si le resolver n'est pas chargé (script manquant), bascule sur le rendu minimal.
   *
   * @param {Object} p       - Données produit brutes (formulaire ou objet produit)
   * @param {Object} [catObj] - Objet catégorie complet depuis /api/categories
   */
  function buildPreviewHTML(p, catObj) {
    // ── Résolution via KProductCardModel (no-code card config) ────────────────
    let model;
    if (window.KProductCardModel) {
      model = window.KProductCardModel.resolve(p || {}, catObj || {});
    } else {
      // Fallback défensif si le script n'est pas chargé
      model = {
        imageUrl:   p && p.image_url || '/images/placeholder-product.png',
        title:      p && p.name      || '(sans nom)',
        subtitle:   p && (p.subcategory || p.category) || '',
        priceLabel: p && p.price_kmf ? fmt(p.price_kmf) : '—',
        badges:     (p && p.promo_pct > 0) ? [{ type: 'promo', label: '-' + p.promo_pct + '%' }] : [],
        themeToken:  null,
        accentToken: null,
        isAvailable: true,
      };
    }

    // ── Rendu des badges ──────────────────────────────────────────────────────
    const badgesHTML = model.badges.map(function (b) {
      const cls = b.type === 'promo' ? 'k-card--badge k-card--badge-promo'
              : b.type === 'stock' ? 'k-card--badge k-card--badge-stock'
              : 'k-card--badge';
      return '<span class="' + cls + '">' + b.label + '</span>';
    }).join('');

    // ── Style thème (si token dispo) ──────────────────────────────────────────
    const accentStyle = model.accentToken
      ? 'color:' + model.accentToken + ';'
      : 'color:var(--primary,#6366f1);';

    // ── Sous-titre ────────────────────────────────────────────────────────────
    const subtitleHTML = model.subtitle
      ? '<div style="font-size:var(--fs-xs);color:var(--text-secondary,#6b7280);margin-top:4px;">' + model.subtitle + '</div>'
      : '';

    return (
      '<div class="k-card" style="max-width:220px;border:1px solid var(--border,#e5e7eb);border-radius:12px;overflow:hidden;font-size:13px;">' +
        '<div style="position:relative;background:#f3f4f6;height:160px;display:flex;align-items:center;justify-content:center;">' +
          '<img src="' + model.imageUrl + '" alt="" style="max-height:160px;max-width:100%;object-fit:contain;"' +
               ' onerror="this.src=\'/images/placeholder-product.png\'">' +
          '<div style="position:absolute;top:8px;left:8px;display:flex;flex-direction:column;gap:4px;">' +
            badgesHTML +
          '</div>' +
        '</div>' +
        '<div style="padding:10px;">' +
          '<div style="font-weight:600;margin-bottom:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' +
            model.title +
          '</div>' +
          '<div style="font-weight:700;' + accentStyle + '">' +
            model.priceLabel +
          '</div>' +
          subtitleHTML +
        '</div>' +
      '</div>'
    );
  }

  // ─── Modal générique ───────────────────────────────────────────────────────

  /**
   * @param {string}   title
   * @param {string}   bodyHTML
   * @param {Function} onSubmit
   * @param {Object}   [opts]
   * @param {Function} [opts.getCategoryByKey]  - (key: string) => catObj | null
   */
  function modal(title, bodyHTML, onSubmit, opts) {
    const getCategoryByKey = (opts && typeof opts.getCategoryByKey === 'function')
      ? opts.getCategoryByKey
      : function () { return null; };

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1000;display:flex;align-items:center;justify-content:center;';

    overlay.innerHTML = `
      <div style="background:var(--bg-surface,#fff);border-radius:12px;padding:24px;width:760px;max-width:96vw;max-height:90vh;overflow-y:auto;position:relative;">
        <button id="modal-close" style="position:absolute;top:12px;right:16px;background:none;border:none;font-size:20px;cursor:pointer;">✕</button>
        <h2 style="margin:0 0 20px;font-size:18px;">${title}</h2>
        <div style="display:flex;gap:24px;align-items:flex-start;">
          <form id="product-form" style="flex:1;">
            ${bodyHTML}
            <div id="form-error" style="color:var(--danger,#ef4444);font-size:13px;margin-top:8px;display:none;"></div>
            <div style="margin-top:20px;display:flex;gap:10px;">
              <button type="submit" class="btn btn-primary">Enregistrer</button>
              <button type="button" id="modal-cancel" class="btn btn-secondary">Annuler</button>
            </div>
          </form>
          <div id="product-preview" style="flex:0 0 auto;padding-top:4px;">
            <div style="font-size:var(--fs-sm);color:var(--text-secondary,#6b7280);margin-bottom:8px;font-weight:600;">APERÇU</div>
            <div id="preview-card">${buildPreviewHTML({}, null)}</div>
          </div>
        </div>
      </div>`;

    document.body.appendChild(overlay);

    const form = overlay.querySelector('#product-form');
    const errEl = overlay.querySelector('#form-error');
    const previewEl = overlay.querySelector('#preview-card');

    // Live preview — résout l'objet catégorie complet pour transmettre image_url / theme_token
    function refreshPreview() {
      const fd = new FormData(form);
      const product = {
        name:        fd.get('name')        || '',
        price_kmf:   fd.get('price_kmf')   || '',
        image_url:   fd.get('image_url')   || '',
        category:    fd.get('category')    || '',
        subcategory: fd.get('subcategory') || '',
        promo_pct:   parseFloat(fd.get('promo_pct')) || 0,
		stock:       fd.get('stock') !== '' ? parseInt(fd.get('stock'), 10) : undefined,
      };
      const catObj = getCategoryByKey(product.category) || {};
      previewEl.innerHTML = buildPreviewHTML(product, catObj);
    }

    form.addEventListener('input', refreshPreview);
    form.addEventListener('change', refreshPreview);
    // Appel initial : en édition, la preview s'affiche dès l'ouverture sans attendre un input.
    refreshPreview();

    function close() { overlay.remove(); }
    overlay.querySelector('#modal-close').addEventListener('click', close);
    overlay.querySelector('#modal-cancel').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errEl.style.display = 'none';
      try {
        await onSubmit(new FormData(form));
        close();
      } catch (err) {
        errEl.textContent = err.message;
        errEl.style.display = 'block';
      }
    });

    return overlay;
  }

  // ─── Construction HTML du formulaire produit ───────────────────────────────

  function buildFormHTML(cats, p = {}) {
    // Options category
    const catOptions = cats.map(c =>
      `<option value="${c.key}" ${p.category === c.key ? 'selected' : ''}>${c.label} (${c.key})</option>`
    ).join('');

    // Options subcategory initiales (selon catégorie courante si edit)
    const initSubs = p.category ? subcatsForCategory(cats, p.category) : [];
    const subOptions = initSubs.map(s =>
      `<option value="${s.key}" ${p.subcategory === s.key ? 'selected' : ''}>${s.label}</option>`
    ).join('');

    return `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <label style="grid-column:1/-1;">Nom du produit *<br>
          <input name="name" required class="form-input" style="width:100%;" value="${p.name || ''}">
        </label>

        <label>Prix KMF *<br>
          <input name="price_kmf" type="number" min="0" required class="form-input" style="width:100%;" value="${p.price_kmf || ''}">
        </label>
        <label>Stock<br>
          <input name="stock" type="number" min="0" class="form-input" style="width:100%;" value="${p.stock != null ? p.stock : ''}">
        </label>

        <label>Catégorie *<br>
          <select name="category" required class="form-input" style="width:100%;" id="sel-category">
            <option value="">-- Choisir --</option>
            ${catOptions}
          </select>
        </label>
        <label>Sous-catégorie<br>
          <select name="subcategory" class="form-input" style="width:100%;" id="sel-subcategory">
            <option value="">-- (optionnel) --</option>
            ${subOptions}
          </select>
        </label>

        <label style="grid-column:1/-1;">URL image<br>
          <input name="image_url" type="url" class="form-input" style="width:100%;" value="${p.image_url || ''}" placeholder="https://...">
        </label>

        <label>Promo %<br>
          <input name="promo_pct" type="number" min="0" max="100" class="form-input" style="width:100%;" value="${p.promo_pct || 0}">
        </label>
        <label>Prix AED<br>
          <input name="price_aed" type="number" min="0" class="form-input" style="width:100%;" value="${p.price_aed || ''}">
        </label>

        <div style="display:flex;flex-direction:column;gap:8px;padding-top:4px;">
          <label><input name="is_active" type="checkbox" ${p.is_active !== false ? 'checked' : ''}> Actif (visible boutique)</label>        </div>
      </div>`;
  }

  // ─── Validation client (L1-T4) ─────────────────────────────────────────────

  function validateCategoryChoice(fd, cats) {
    const catKey = fd.get('category');
    if (!catKey) throw new Error('La catégorie est obligatoire.');

    const validKeys = validCategoryKeys(cats);
    if (!validKeys.has(catKey)) {
      throw new Error(`Catégorie invalide : "${catKey}". Choisissez dans la liste.`);
    }

    const subKey = fd.get('subcategory');
    if (subKey) {
      const subs = subcatsForCategory(cats, catKey);
      const validSubs = new Set(subs.map(s => s.key));
      if (!validSubs.has(subKey)) {
        throw new Error(`Sous-catégorie invalide : "${subKey}" pour la catégorie "${catKey}".`);
      }
    }
  }

  // ─── Wiring dynamique subcategory (L1-T3) ──────────────────────────────────

  function wireSubcategoryDropdown(overlayEl, cats) {
    const selCat = overlayEl.querySelector('#sel-category');
    const selSub = overlayEl.querySelector('#sel-subcategory');
    if (!selCat || !selSub) return;

    selCat.addEventListener('change', () => {
      const subs = subcatsForCategory(cats, selCat.value);
      selSub.innerHTML = '<option value="">-- (optionnel) --</option>' +
        subs.map(s => `<option value="${s.key}">${s.label}</option>`).join('');
    });
  }

  // ─── CRUD ─────────────────────────────────────────────────────────────────

  async function apiFetch(path, opts = {}) {
    const res = await fetch(API_PRODUCTS + path, {
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      ...opts,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
  }

  function formDataToProduct(fd) {
    return {
      name:       fd.get('name').trim(),
      price_kmf:  parseFloat(fd.get('price_kmf')),
      price_aed:  fd.get('price_aed') ? parseFloat(fd.get('price_aed')) : undefined,
      stock:      fd.get('stock') !== '' ? parseInt(fd.get('stock'), 10) : undefined,
      image_url:  fd.get('image_url') || undefined,
      category:   fd.get('category'),
      subcategory: fd.get('subcategory') || undefined,
      promo_pct:  parseFloat(fd.get('promo_pct')) || 0,
      is_active:  fd.get('is_active') === 'on',    };
  }

  async function showCreateModal(cats, onRefresh) {
    const overlay = modal(
      'Nouveau produit',
      buildFormHTML(cats),
      async (fd) => {
        validateCategoryChoice(fd, cats);
        await apiFetch('', { method: 'POST', body: JSON.stringify(formDataToProduct(fd)) });
        toast('Produit créé !');
        await onRefresh();
      },
      { getCategoryByKey: (key) => cats.find(c =>
          c.key === key ||
          (Array.isArray(c.db_keys) && c.db_keys.includes(key))
        ) || null
      }
    );
    wireSubcategoryDropdown(overlay, cats);
  }

  async function showEditModal(product, cats, onRefresh) {
    const overlay = modal(
      `Modifier "${product.name}"`,
      buildFormHTML(cats, product),
      async (fd) => {
        validateCategoryChoice(fd, cats);
        await apiFetch(`/${product.id}`, { method: 'PUT', body: JSON.stringify(formDataToProduct(fd)) });
        toast('Produit modifié !');
        await onRefresh();
      },
      { getCategoryByKey: (key) => cats.find(c =>
          c.key === key ||
          (Array.isArray(c.db_keys) && c.db_keys.includes(key))
        ) || null
      }
    );
    wireSubcategoryDropdown(overlay, cats);
  }

  async function toggleActive(product, onRefresh) {
    const verb = product.is_active ? 'désactiver' : 'activer';
    if (!window.confirm(`Confirmer : ${verb} "${product.name}" ?`)) return;
    await apiFetch(`/${product.id}`, {
      method: 'PUT',
      body: JSON.stringify({ is_active: !product.is_active }),
    });
    toast(`Produit ${product.is_active ? 'désactivé' : 'activé'}`);
    await onRefresh();
  }

  // ─── Rendu liste ──────────────────────────────────────────────────────────

  function renderProductRow(p, cats, onRefresh) {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td style="padding:10px 12px;max-width:220px;">
        <div style="display:flex;align-items:center;gap:10px;">
          <img src="${p.image_url || '/images/placeholder-product.png'}"
               onerror="this.src='/images/placeholder-product.png'"
               style="width:40px;height:40px;object-fit:contain;border-radius:6px;background:#f3f4f6;">
          <div>
            <div style="font-weight:600;font-size:13px;">${p.name}</div>
            <div style="font-size:var(--fs-xs);color:var(--text-secondary,#6b7280);">${p.category || '—'}${p.subcategory ? ' › ' + p.subcategory : ''}</div>
          </div>
        </div>
      </td>
      <td style="padding:10px 12px;text-align:right;font-weight:600;">${fmt(p.price_kmf)}</td>
      <td style="padding:10px 12px;text-align:center;">${p.stock != null ? p.stock : '—'}</td>
      <td style="padding:10px 12px;text-align:center;">
        <span style="padding:2px 8px;border-radius:12px;font-size:var(--fs-sm);background:${p.is_active ? 'var(--success-bg,#dcfce7)' : 'var(--danger-bg,#fee2e2)'};color:${p.is_active ? 'var(--success,#16a34a)' : 'var(--danger,#dc2626)'};">
          ${p.is_active ? 'Actif' : 'Inactif'}
        </span>
      </td>
      <td style="padding:10px 12px;text-align:right;">
        <button class="btn btn-sm btn-secondary" data-action="edit" style="margin-right:6px;">✏️</button>
        <button class="btn btn-sm ${p.is_active ? 'btn-warning' : 'btn-success'}" data-action="toggle">
          ${p.is_active ? '🚫' : '✅'}
        </button>
      </td>`;

    row.querySelector('[data-action="edit"]').addEventListener('click', () =>
      showEditModal(p, cats, onRefresh).catch(err => toast(err.message, 'error')));
    row.querySelector('[data-action="toggle"]').addEventListener('click', () =>
      toggleActive(p, onRefresh).catch(err => toast(err.message, 'error')));

    return row;
  }

  // ─── Onglet Diagnostic (L4) ────────────────────────────────────────────────

  async function renderDiagnostic(container, cats) {
    container.innerHTML = '<div style="padding:20px;color:var(--text-secondary,#6b7280);">Chargement du diagnostic…</div>';

    const [prodRes] = await Promise.all([
      apiFetch('?limit=500'),
    ]);

    const products = prodRes.products || [];
    const validCatKeys = validCategoryKeys(cats);

    // Calculs
    const withoutValidCat = products.filter(p => !p.category || !validCatKeys.has(p.category));
    const withoutImage    = products.filter(p => p.is_active && (!p.image_url || p.image_url.trim() === ''));
    const withBadSub      = products.filter(p => {
      if (!p.is_active || !p.subcategory) return false;
      const subs = subcatsForCategory(cats, p.category);
      if (!subs.length) return false;
      return !subs.find(s => s.key === p.subcategory);
    });
    const totalActive = products.filter(p => p.is_active).length;

    container.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:28px;">
        ${[
          ['Sans catégorie valide', withoutValidCat.length, '#fee2e2', '#dc2626'],
          ['Actifs sans image',     withoutImage.length,    '#fef3c7', '#d97706'],
          ['Sous-cat. invalide',    withBadSub.length,      '#ede9fe', '#7c3aed'],
          ['Total actifs',          totalActive,            '#dcfce7', '#16a34a'],
        ].map(([label, count, bg, color]) => `
          <div style="background:${bg};border-radius:10px;padding:16px;text-align:center;">
            <div style="font-size:28px;font-weight:700;color:${color};">${count}</div>
            <div style="font-size:var(--fs-sm);color:${color};margin-top:4px;">${label}</div>
          </div>`).join('')}
      </div>

      ${withoutValidCat.length ? `
        <h3 style="margin-bottom:12px;">⚠️ Catégorie invalide (${withoutValidCat.length})</h3>
        <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
          <thead><tr style="background:var(--bg-secondary,#f9fafb);font-size:var(--fs-sm);text-align:left;">
            <th style="padding:8px 12px;">Produit</th>
            <th style="padding:8px 12px;">Catégorie actuelle</th>
          </tr></thead>
          <tbody>
            ${withoutValidCat.map(p => `
              <tr style="border-top:1px solid var(--border,#e5e7eb);">
                <td style="padding:8px 12px;">${p.name}</td>
                <td style="padding:8px 12px;color:var(--danger,#dc2626);">${p.category || '(vide)'}</td>
              </tr>`).join('')}
          </tbody>
        </table>` : '<p style="color:var(--success,#16a34a);">✅ Toutes les catégories sont valides.</p>'}

      ${withoutImage.length ? `
        <h3 style="margin-bottom:12px;">🖼️ Actifs sans image (${withoutImage.length})</h3>
        <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
          <thead><tr style="background:var(--bg-secondary,#f9fafb);font-size:var(--fs-sm);text-align:left;">
            <th style="padding:8px 12px;">Produit</th>
            <th style="padding:8px 12px;">Catégorie</th>
          </tr></thead>
          <tbody>
            ${withoutImage.map(p => `
              <tr style="border-top:1px solid var(--border,#e5e7eb);">
                <td style="padding:8px 12px;">${p.name}</td>
                <td style="padding:8px 12px;">${p.category || '—'}</td>
              </tr>`).join('')}
          </tbody>
        </table>` : '<p style="color:var(--success,#16a34a);">✅ Tous les produits actifs ont une image.</p>'}

      ${withBadSub.length ? `
        <h3 style="margin-bottom:12px;">🔍 Sous-catégorie invalide (${withBadSub.length})</h3>
        <table style="width:100%;border-collapse:collapse;">
          <thead><tr style="background:var(--bg-secondary,#f9fafb);font-size:var(--fs-sm);text-align:left;">
            <th style="padding:8px 12px;">Produit</th>
            <th style="padding:8px 12px;">Catégorie</th>
            <th style="padding:8px 12px;">Sous-catégorie</th>
          </tr></thead>
          <tbody>
            ${withBadSub.map(p => `
              <tr style="border-top:1px solid var(--border,#e5e7eb);">
                <td style="padding:8px 12px;">${p.name}</td>
                <td style="padding:8px 12px;">${p.category}</td>
                <td style="padding:8px 12px;color:var(--warning,#d97706);">${p.subcategory}</td>
              </tr>`).join('')}
          </tbody>
        </table>` : ''}
    `;
  }

  // ─── Vue principale ────────────────────────────────────────────────────────

  let _currentPage  = 1;
  let _searchQuery  = '';
  let _activeCats   = null;

  async function ProductsView(container) {
    container.innerHTML = '<div style="padding:20px;color:var(--text-secondary,#6b7280);">Chargement…</div>';

    let cats;
    try {
      cats = await loadCategories();
      _activeCats = cats;
    } catch (err) {
      (() => {
          const d = document.createElement('div');
          d.style.cssText = 'padding:20px;color:var(--danger,#ef4444)';
          d.textContent = `Erreur : ${err.message}`; // FRESH-104: textContent évite XSS
          container.replaceChildren(d);
        })();
      return;
    }

    // ── Shell
    container.innerHTML = `
      <div style="padding:24px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px;">
          <h1 style="margin:0;font-size:22px;">🛍️ Produits boutique</h1>
          <button id="btn-new-product" class="btn btn-primary">+ Nouveau produit</button>
        </div>

        <!-- Onglets -->
        <div style="display:flex;gap:0;border-bottom:2px solid var(--border,#e5e7eb);margin-bottom:20px;">
          <button id="tab-list"  class="tab-btn tab-active" style="padding:8px 20px;border:none;background:none;cursor:pointer;font-weight:600;border-bottom:2px solid var(--primary,#6366f1);margin-bottom:-2px;">Liste</button>
          <button id="tab-diag" class="tab-btn"             style="padding:8px 20px;border:none;background:none;cursor:pointer;color:var(--text-secondary,#6b7280);">Diagnostic</button>
        </div>

        <!-- Onglet Liste -->
        <div id="tab-content-list">
          <div style="display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap;">
            <input id="search-input" type="search" placeholder="Rechercher…" class="form-input"
                   style="width:260px;" value="${_searchQuery}">
          </div>
          <div id="products-table-wrap"></div>
          <div id="products-pagination" style="margin-top:16px;display:flex;gap:8px;align-items:center;"></div>
        </div>

        <!-- Onglet Diagnostic -->
        <div id="tab-content-diag" style="display:none;">
          <div id="diagnostic-content"></div>
        </div>
      </div>`;

    const tableWrap  = container.querySelector('#products-table-wrap');
    const pagination = container.querySelector('#products-pagination');
    const searchInput = container.querySelector('#search-input');
    const diagContent = container.querySelector('#diagnostic-content');

    // Onglets
    container.querySelector('#tab-list').addEventListener('click', () => {
      container.querySelector('#tab-content-list').style.display = '';
      container.querySelector('#tab-content-diag').style.display = 'none';
      container.querySelector('#tab-list').style.borderBottom = '2px solid var(--primary,#6366f1)';
      container.querySelector('#tab-list').style.fontWeight = '600';
      container.querySelector('#tab-list').style.color = '';
      container.querySelector('#tab-diag').style.borderBottom = '';
      container.querySelector('#tab-diag').style.fontWeight = '';
      container.querySelector('#tab-diag').style.color = 'var(--text-secondary,#6b7280)';
    });
    container.querySelector('#tab-diag').addEventListener('click', async () => {
      container.querySelector('#tab-content-list').style.display = 'none';
      container.querySelector('#tab-content-diag').style.display = '';
      container.querySelector('#tab-diag').style.borderBottom = '2px solid var(--primary,#6366f1)';
      container.querySelector('#tab-diag').style.fontWeight = '600';
      container.querySelector('#tab-diag').style.color = '';
      container.querySelector('#tab-list').style.borderBottom = '';
      container.querySelector('#tab-list').style.fontWeight = '';
      container.querySelector('#tab-list').style.color = 'var(--text-secondary,#6b7280)';
      await renderDiagnostic(diagContent, cats).catch(err => {
        (() => {
              const d = document.createElement('div');
              d.style.color = 'var(--danger,#ef4444)';
              d.textContent = `Erreur diagnostic : ${err.message}`; // FRESH-104: textContent
              diagContent.replaceChildren(d);
            })();
      });
    });

    // Chargement liste
    async function loadPage(page = 1) {
      _currentPage = page;
      const offset = (page - 1) * PAGE_SIZE;
      const qs = new URLSearchParams({ limit: PAGE_SIZE, offset });
      if (_searchQuery) qs.set('search', _searchQuery);

      tableWrap.innerHTML = '<div style="padding:20px;color:var(--text-secondary,#6b7280);">Chargement…</div>';

      const data = await apiFetch(`?${qs}`);
      const products = data.products || [];
      const total    = data.total    || 0;
      const totalPages = Math.ceil(total / PAGE_SIZE);

      if (!products.length) {
        tableWrap.innerHTML = '<div style="padding:20px;color:var(--text-secondary,#6b7280);">Aucun produit trouvé.</div>';
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
            <th style="padding:10px 12px;text-align:center;">Statut</th>
            <th style="padding:10px 12px;text-align:right;">Actions</th>
          </tr>
        </thead>
        <tbody id="products-tbody"></tbody>`;

      const tbody = table.querySelector('#products-tbody');
      products.forEach(p => tbody.appendChild(renderProductRow(p, cats, () => loadPage(_currentPage))));

      tableWrap.innerHTML = '';
      tableWrap.appendChild(table);

      // Pagination
      pagination.innerHTML = `
        <span style="font-size:13px;color:var(--text-secondary,#6b7280);">${total} produit(s) — Page ${page}/${totalPages || 1}</span>`;
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

    // Nouveau produit
    container.querySelector('#btn-new-product').addEventListener('click', () =>
      showCreateModal(cats, () => loadPage(_currentPage)).catch(err => toast(err.message, 'error')));

    // Recherche
    let searchTimer;
    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        _searchQuery = searchInput.value.trim();
        loadPage(1);
      }, 400);
    });

    await loadPage(1);
  }

  global.ProductsView = { render: ProductsView };

}(window));


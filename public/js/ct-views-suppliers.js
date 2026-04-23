/* ═══════════════════════════════════════════════════════════════
   BO View — Fournisseurs (Supplier CRUD)
   Shell: BO · Section: config
   Uses localStorage (no API yet)
   ═══════════════════════════════════════════════════════════════ */
window.CT = window.CT || {};
CT.views = CT.views || {};

CT.views.suppliers = function(main) {
  var STORAGE_KEY = 'komerce_suppliers';

  var DEFAULT_SUPPLIERS = [
    { id: 1, nom: 'Al Wafaa Wholesale', pays: 'Dubai, UAE', contact: 'info@alwafaa.ae', categorie: 'textile', delai: '5j', devise: 'AED', statut: 'active' },
    { id: 2, nom: 'Shenzhen Global', pays: 'Shenzhen, China', contact: 'sales@shenzhen-global.cn', categorie: 'tech', delai: '12j', devise: 'USD', statut: 'active' },
    { id: 3, nom: 'Rayan Trading', pays: 'Dubai, UAE', contact: 'rayan@rayantrading.ae', categorie: 'beauté', delai: '7j', devise: 'AED', statut: 'active' }
  ];

  function getSuppliers() {
    try {
      var data = localStorage.getItem(STORAGE_KEY);
      if (data) return JSON.parse(data);
    } catch(e) { /* ignore */ }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_SUPPLIERS));
    return DEFAULT_SUPPLIERS.slice();
  }

  function saveSuppliers(list) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  }

  function nextId(list) {
    var max = 0;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id > max) max = list[i].id;
    }
    return max + 1;
  }

  function render() {
    var suppliers = getSuppliers();
    var html = '';

    /* ── Header ── */
    html += '<div class="ct-view-header" style="display:flex;justify-content:space-between;align-items:center">';
    html += '<div><h2>🏭 Fournisseurs</h2>';
    html += '<div class="ct-subtitle">' + suppliers.length + ' fournisseur' + (suppliers.length > 1 ? 's' : '') + ' enregistré' + (suppliers.length > 1 ? 's' : '') + '</div></div>';
    html += '<button class="ct-btn ct-btn-primary" id="sup-add-btn">+ Ajouter</button>';
    html += '</div>';

    /* ── Table ── */
    html += '<div class="ct-section-block" style="overflow-x:auto">';
    html += '<table class="ct-table"><thead><tr>';
    html += '<th>Nom</th><th>Pays</th><th>Contact</th><th>Catégorie</th><th>Délai</th><th>Devise</th><th>Statut</th><th>Actions</th>';
    html += '</tr></thead><tbody>';

    for (var i = 0; i < suppliers.length; i++) {
      var s = suppliers[i];
      var statusColor = s.statut === 'active' ? '#16a34a' : '#94a3b8';
      var statusLabel = s.statut === 'active' ? '🟢 Actif' : '⚪ Inactif';
      html += '<tr>';
      html += '<td><strong>' + s.nom + '</strong></td>';
      html += '<td>' + s.pays + '</td>';
      html += '<td>' + s.contact + '</td>';
      html += '<td>' + s.categorie + '</td>';
      html += '<td>' + s.delai + '</td>';
      html += '<td>' + s.devise + '</td>';
      html += '<td style="color:' + statusColor + '">' + statusLabel + '</td>';
      html += '<td>';
      html += '<button class="ct-btn ct-btn-secondary" data-edit="' + s.id + '" style="margin-right:4px;padding:4px 8px;font-size:12px">✏️</button>';
      html += '<button class="ct-btn ct-btn-secondary" data-toggle="' + s.id + '" style="padding:4px 8px;font-size:12px">' + (s.statut === 'active' ? '⏸' : '▶') + '</button>';
      html += '</td>';
      html += '</tr>';
    }

    html += '</tbody></table>';
    html += '</div>';

    /* ── Modal (hidden) ── */
    html += '<div id="sup-modal" style="display:none;position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:1000;display:none;align-items:center;justify-content:center">';
    html += '<div style="background:white;border-radius:16px;padding:32px;width:460px;max-width:95vw;max-height:90vh;overflow-y:auto">';
    html += '<h3 id="sup-modal-title" style="margin-bottom:16px">Ajouter fournisseur</h3>';
    html += '<input type="hidden" id="sup-edit-id">';
    html += '<div style="margin-bottom:12px"><label style="display:block;font-size:13px;font-weight:600;margin-bottom:4px">Nom</label><input class="ct-input" id="sup-nom" style="width:100%"></div>';
    html += '<div style="margin-bottom:12px"><label style="display:block;font-size:13px;font-weight:600;margin-bottom:4px">Pays</label><input class="ct-input" id="sup-pays" style="width:100%"></div>';
    html += '<div style="margin-bottom:12px"><label style="display:block;font-size:13px;font-weight:600;margin-bottom:4px">Contact</label><input class="ct-input" id="sup-contact" style="width:100%"></div>';
    html += '<div style="margin-bottom:12px"><label style="display:block;font-size:13px;font-weight:600;margin-bottom:4px">Catégorie</label><input class="ct-input" id="sup-categorie" style="width:100%"></div>';
    html += '<div style="display:flex;gap:12px;margin-bottom:12px">';
    html += '<div style="flex:1"><label style="display:block;font-size:13px;font-weight:600;margin-bottom:4px">Délai livraison</label><input class="ct-input" id="sup-delai" style="width:100%" placeholder="ex: 7j"></div>';
    html += '<div style="flex:1"><label style="display:block;font-size:13px;font-weight:600;margin-bottom:4px">Devise</label><input class="ct-input" id="sup-devise" style="width:100%" placeholder="AED, USD..."></div>';
    html += '</div>';
    html += '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:20px">';
    html += '<button class="ct-btn ct-btn-secondary" id="sup-cancel">Annuler</button>';
    html += '<button class="ct-btn ct-btn-primary" id="sup-save">Enregistrer</button>';
    html += '</div>';
    html += '</div></div>';

    main.innerHTML = html;

    /* ── Wire events ── */
    var addBtn = document.getElementById('sup-add-btn');
    var modal = document.getElementById('sup-modal');
    var cancelBtn = document.getElementById('sup-cancel');
    var saveBtn = document.getElementById('sup-save');

    addBtn.addEventListener('click', function() {
      document.getElementById('sup-modal-title').textContent = 'Ajouter fournisseur';
      document.getElementById('sup-edit-id').value = '';
      document.getElementById('sup-nom').value = '';
      document.getElementById('sup-pays').value = '';
      document.getElementById('sup-contact').value = '';
      document.getElementById('sup-categorie').value = '';
      document.getElementById('sup-delai').value = '';
      document.getElementById('sup-devise').value = '';
      modal.style.display = 'flex';
    });

    cancelBtn.addEventListener('click', function() {
      modal.style.display = 'none';
    });

    modal.addEventListener('click', function(e) {
      if (e.target === modal) modal.style.display = 'none';
    });

    saveBtn.addEventListener('click', function() {
      var list = getSuppliers();
      var editId = document.getElementById('sup-edit-id').value;
      var entry = {
        nom: document.getElementById('sup-nom').value.trim(),
        pays: document.getElementById('sup-pays').value.trim(),
        contact: document.getElementById('sup-contact').value.trim(),
        categorie: document.getElementById('sup-categorie').value.trim(),
        delai: document.getElementById('sup-delai').value.trim(),
        devise: document.getElementById('sup-devise').value.trim().toUpperCase(),
        statut: 'active'
      };

      if (!entry.nom) { alert('Le nom est obligatoire'); return; }

      if (editId) {
        var eid = parseInt(editId);
        for (var i = 0; i < list.length; i++) {
          if (list[i].id === eid) {
            entry.id = eid;
            entry.statut = list[i].statut;
            list[i] = entry;
            break;
          }
        }
      } else {
        entry.id = nextId(list);
        list.push(entry);
      }

      saveSuppliers(list);
      modal.style.display = 'none';
      render();
    });

    /* Edit buttons */
    var editBtns = main.querySelectorAll('[data-edit]');
    for (var e = 0; e < editBtns.length; e++) {
      editBtns[e].addEventListener('click', function() {
        var sid = parseInt(this.getAttribute('data-edit'));
        var list = getSuppliers();
        var sup = null;
        for (var i = 0; i < list.length; i++) {
          if (list[i].id === sid) { sup = list[i]; break; }
        }
        if (!sup) return;

        document.getElementById('sup-modal-title').textContent = 'Modifier fournisseur';
        document.getElementById('sup-edit-id').value = sup.id;
        document.getElementById('sup-nom').value = sup.nom;
        document.getElementById('sup-pays').value = sup.pays;
        document.getElementById('sup-contact').value = sup.contact;
        document.getElementById('sup-categorie').value = sup.categorie;
        document.getElementById('sup-delai').value = sup.delai;
        document.getElementById('sup-devise').value = sup.devise;
        modal.style.display = 'flex';
      });
    }

    /* Toggle buttons */
    var toggleBtns = main.querySelectorAll('[data-toggle]');
    for (var t = 0; t < toggleBtns.length; t++) {
      toggleBtns[t].addEventListener('click', function() {
        var sid = parseInt(this.getAttribute('data-toggle'));
        var list = getSuppliers();
        for (var i = 0; i < list.length; i++) {
          if (list[i].id === sid) {
            list[i].statut = list[i].statut === 'active' ? 'inactive' : 'active';
            break;
          }
        }
        saveSuppliers(list);
        render();
      });
    }
  }

  render();
};

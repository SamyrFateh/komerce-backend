/**
 * @komerce-arch
 * @role          canonical-sourcing-workspace-ui
 * @domain        admin-dashboard
 * @layer         ui-orchestration
 * @criticality   high
 * @inputs        authenticated_sourcing_operator, sourcing_workspace_projection
 * @outputs       canonical_sourcing_workspace_dom, authorized_sourcing_action_requests
 * @depends       canonical primitives
 * @used-by       canonical admin entrypoint
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      workspace_acts_dashboard_observes, canonical_admin_no_legacy_imports, global_sourcing_not_market_scoped, browser_business_refs_only
 * @impact-areas  admin-dashboard, sourcing, catalog
 * @version       2026-08
 */

'use strict';

(function initSourcingWorkspace(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.KomerceCanonicalSourcingWorkspace = api;
})(typeof globalThis !== 'undefined' ? globalThis : null, function createSourcingWorkspace() {
  const ENDPOINT = '/api/admin/workspaces/sourcing';
  const LOAD_TIMEOUT_MS = 20000;

  function contextualHref(path, returnTo, label) {
    const nav = globalThis.KomerceCanonicalNavigation;
    return nav && typeof nav.withReturnTo === 'function'
      ? nav.withReturnTo(path, returnTo, label)
      : path;
  }

  function text(doc, tag, className, value) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    node.textContent = value == null ? '' : String(value);
    return node;
  }

  const CANDIDATE_STATE_LABELS = {
    raw_imported: 'Importé brut',
    normalized: 'Normalisé',
    scanned: 'Scanné',
    test_ready: 'Prêt à tester',
    watchlist: 'En surveillance',
    imported_to_catalog: 'Dans le catalogue',
    quarantined: 'En quarantaine',
    rejected: 'Rejeté',
    archived: 'Archivé',
  };
  const CANDIDATE_DECISION_LABELS = {
    priority: 'Prioritaire',
    test: 'À tester',
    watch: 'À surveiller',
    avoid: 'À éviter',
    loss: 'Perte',
    unknown: 'Non évalué',
    excluded: 'Exclu',
  };

  function td(doc, value) {
    const cell = doc.createElement('td');
    cell.textContent = value == null || value === '' ? '—' : String(value);
    return cell;
  }

  function formatNumber(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '—';
    return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(number);
  }

  function formatKmf(value) {
    return value == null ? '—' : `${formatNumber(value)} KMF`;
  }

  async function jsonRequest(fetchFn, url, options = {}) {
    const controller = options.timeoutMs && typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), options.timeoutMs) : null;
    let response;
    try {
      response = await fetchFn(url, {
      method: options.method || 'GET',
      credentials: 'include',
      ...(controller ? { signal: controller.signal } : {}),
      headers: {
        Accept: 'application/json',
        ...(options.body == null ? {} : { 'Content-Type': 'application/json' }),
      },
      body: options.body == null ? undefined : JSON.stringify(options.body),
      });
    } catch (error) {
      if (error && error.name === 'AbortError') {
        const timeout = new Error('Le chargement du Sourcing prend trop de temps. Réessayez dans un instant.');
        timeout.code = 'sourcing_workspace_timeout';
        throw timeout;
      }
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body.error || `Erreur HTTP ${response.status}`);
      error.code = body.code || null;
      error.status = response.status;
      throw error;
    }
    return body;
  }

  function makeButton(doc, label, action, secondary = false) {
    const button = text(doc, 'button', secondary ? 'kmc-workspace-action is-secondary' : 'kmc-workspace-action', label);
    button.type = 'button';
    button.setAttribute('data-workspace-action', action);
    return button;
  }

  function setFeedback(rootNode, message, tone = 'neutral') {
    const target = rootNode.querySelector('[data-workspace-feedback]');
    if (!target) return;
    target.className = `kmc-workspace-feedback is-${tone}`;
    target.textContent = message || '';
  }

  function createHeader(doc) {
    const header = doc.createElement('header');
    header.className = 'kmc-workspace-header';
    header.setAttribute('data-dashboard-role', 'hero');
    const copy = doc.createElement('div');
    copy.appendChild(text(doc, 'span', 'kmc-workspace-kicker', 'SOURCING'));
    copy.appendChild(text(doc, 'h1', 'kmc-workspace-title', 'Acquisition fournisseurs'));
    copy.appendChild(text(doc, 'p', 'kmc-workspace-subtitle', 'Connecter les sources, importer les produits et suivre les exceptions fournisseur. Les fiches se corrigent dans le Catalogue.'));
    header.appendChild(copy);

    const feedback = text(doc, 'div', 'kmc-workspace-feedback', '');
    feedback.setAttribute('data-workspace-feedback', '');
    feedback.setAttribute('role', 'status');
    header.appendChild(feedback);
    return header;
  }

  function createSection(rootNode, ui, title, description) {
    const section = ui.Section.create({ title, description });
    rootNode.appendChild(section.element);
    return section.slot;
  }

  function metricItems(summary = {}) {
    return [
      { key: 'sources', label: 'Sources connectées', value: formatNumber(summary.sourcing_sources), tone: 'neutral' },
      { key: 'imports', label: 'Passages recensés', value: formatNumber(summary.imports), tone: 'neutral' },
      { key: 'candidates', label: 'Candidats affichés', value: formatNumber(summary.candidates_total), tone: 'neutral' },
      { key: 'promoted', label: 'Transmis au Catalogue', value: formatNumber(summary.candidates_promoted), tone: 'neutral' },
    ];
  }

  async function runAction(context, button, options) {
    const previous = button.textContent;
    button.disabled = true;
    button.textContent = 'En cours…';
    setFeedback(context.root, options.runningMessage || 'Action en cours…');
    try {
      const result = await jsonRequest(context.fetch, options.url, { method: 'POST', body: options.body || {} });
      setFeedback(context.root, options.successMessage || 'Action appliquée.', 'positive');
      if (typeof options.onSuccess === 'function') options.onSuccess(result);
      else await context.reload();
      return result;
    } catch (error) {
      setFeedback(context.root, error.message, 'critical');
      button.disabled = false;
      button.textContent = previous;
      return null;
    }
  }

  function wrapTable(doc, table) {
    const wrap = doc.createElement('div');
    wrap.className = 'kmc-workspace-table-wrap';
    wrap.appendChild(table);
    return wrap;
  }

  // Only actual Sourcing-side remedies belong in this exception list.
  // Sourcing pipeline / WATCH / classification candidates remain traceable
  // through the KIR and the unified Catalogue, not as fake source problems.
  function sourcingRemedy(row = {}) {
    const state = String(row.state || '').toLowerCase();
    if (['imported_to_catalog','rejected','archived','quarantined'].includes(state) ||
        String(row.scan_result?.sourcing_decision || '').toUpperCase() === 'EXCLUDED') return null;
    const currency = String(row.currency || '').toUpperCase();
    const price = Number(row.purchase_price);
    if (!Number.isFinite(price) || price <= 0 || !['AED','EUR','USD','KMF','PLN'].includes(currency)) {
      return { key: 'update-candidate', label: 'Corriger les données fournisseur',
        reason: 'Prix d’achat ou devise à compléter' };
    }
    if (!row.scan_at && !row.scan_result) return {
      key: 'scan-candidate', label: 'Contrôler la source',
      reason: 'Contrôle fournisseur non encore exécuté',
    };
    return null;
  }

  function nextCandidateAction(row = {}) {
    if (row.state === 'imported_to_catalog')
      return { key: 'view-product', label: 'Voir le produit transmis' };
    return sourcingRemedy(row) ||
      { key: 'view-catalog', label: 'Consulter dans le Catalogue' };
  }

  function openCandidateForm(context, title, help, trigger) {
    const doc = context.root.ownerDocument;
    const existing = context.root.querySelector('[data-sourcing-editor-overlay]');
    if (existing) existing.remove();
    const overlay = doc.createElement('div');
    overlay.className = 'kmc-sourcing-editor-overlay';
    overlay.setAttribute('data-sourcing-editor-overlay','');
    const dialog = doc.createElement('section');
    dialog.className = 'kmc-sourcing-editor';
    dialog.setAttribute('role','dialog');
    dialog.setAttribute('aria-modal','true');
    dialog.setAttribute('aria-label',title);
    const header = doc.createElement('header');
    header.className = 'kmc-sourcing-editor-header';
    header.appendChild(text(doc,'h2','',title));
    header.appendChild(text(doc,'p','',help));
    dialog.appendChild(header);
    const form = doc.createElement('form');
    form.className = 'kmc-sourcing-editor-form';
    dialog.appendChild(form);
    const feedback = text(doc,'p','kmc-sourcing-editor-feedback','Vérifiez les propositions, puis confirmez.');
    feedback.setAttribute('role','status');
    form.appendChild(feedback);
    const actions = doc.createElement('div');
    actions.className = 'kmc-sourcing-editor-actions';
    const cancel = makeButton(doc,'Annuler','cancel-sourcing-edit',true);
    const submit = makeButton(doc,'Enregistrer','submit-sourcing-edit');
    submit.type = 'submit';
    actions.appendChild(cancel);
    actions.appendChild(submit);
    form.appendChild(actions);
    overlay.appendChild(dialog);
    context.root.appendChild(overlay);
    const close = () => {overlay.remove();trigger?.focus?.();};
    cancel.addEventListener('click',close);
    overlay.addEventListener('click',event=>{if(event.target===overlay)close();});
    dialog.addEventListener('keydown',event=>{
      if(event.key==='Escape'){event.preventDefault();close();}
    });
    return {form,feedback,submit,close,dialog};
  }

  function editCandidateField(doc, form, caption, value, type = 'text') {
    const label = doc.createElement('label');
    label.className = 'kmc-sourcing-editor-field';
    label.appendChild(text(doc,'span','',caption));
    const input = doc.createElement('input');
    input.type = type;
    input.value = value == null ? '' : String(value);
    if(type==='number'){input.min='0';input.step='any';}
    label.appendChild(input);
    const actions = form.querySelector('.kmc-sourcing-editor-actions');
    form.insertBefore(label, actions.previousElementSibling);
    return input;
  }

  async function sendCandidateForm(context, formState, path, body, message) {
    const {feedback,submit,close}=formState;
    submit.disabled = true;
    feedback.textContent = 'Enregistrement en cours…';
    try {
      await jsonRequest(context.fetch, path, {method:'POST',body});
      close();
      await context.reload();
      setFeedback(context.root,message,'positive');
    } catch(error){
      feedback.textContent = error.message || 'Enregistrement refusé.';
      feedback.className = 'kmc-sourcing-editor-feedback is-critical';
    } finally {submit.disabled = false;}
  }

  function renderCandidates(rootNode, ui, doc, payload, context) {
    const slot = createSection(rootNode, ui, 'Exceptions fournisseur à résoudre',
      'Uniquement les faits fournisseur corrigeables ici. Les classements, traductions et validations sont dans le Catalogue.');
    const rows = (payload.candidates || []).filter(row =>
      context.focusCandidateRef ? row.candidate_ref === context.focusCandidateRef
        : Boolean(sourcingRemedy(row)));
    if (!rows.length) {
      slot.appendChild(text(doc, 'div', 'kmc-workspace-empty',
        'Aucun problème fournisseur directement corrigeable ici. Les autres produits restent suivis dans les passages et le Catalogue.'));
      const link = text(doc, 'a', 'kmc-workspace-nav-link', 'Voir les produits dans le Catalogue');
      link.href = '/admin/workspaces/catalog';
      slot.appendChild(link);
      return;
    }

    const table = doc.createElement('table');
    table.className = 'kmc-workspace-table kmc-sourcing-candidates-table';
    table.innerHTML = '<thead><tr><th>Produit</th><th>Fournisseur</th><th>À résoudre</th><th>Action</th></tr></thead>';
    const tbody = doc.createElement('tbody');
    rows.forEach(row => {
      const tr = doc.createElement('tr');
      tr.setAttribute('data-candidate-ref', row.candidate_ref || '');
      const product = doc.createElement('td');
      product.appendChild(text(doc, 'strong', 'kmc-cand-product', row.product_name || row.candidate_ref));
      product.appendChild(text(doc, 'small', 'kmc-cand-ref', row.candidate_ref || '—'));
      tr.appendChild(product);
      tr.appendChild(td(doc, row.supplier_name || '—'));

      const issue = sourcingRemedy(row);
      tr.appendChild(td(doc, issue?.reason ||
        'Dossier ouvert depuis le Catalogue · faits fournisseur consultables'));
      const actions = doc.createElement('td');
      actions.className = 'kmc-sourcing-candidate-actions';
      actions.setAttribute('data-label', 'Action');

      if (issue?.key === 'update-candidate' && !row.product_ref) {
        const edit = makeButton(doc, issue.label, 'update-candidate');
        edit.className += ' kmc-sourcing-next-action';
        edit.addEventListener('click', () => {
          const editor = openCandidateForm(context,
            'Corriger les faits fournisseur · ' + row.candidate_ref,
            'Renseignez uniquement les faits fournis ou vérifiés. Aucune publication ni validation Catalogue.',
            edit);
          const weight = editCandidateField(doc, editor.form, 'Poids estimé (kg)',
            row.estimated_weight_kg, 'number');
          weight.setAttribute('data-sourcing-edit-weight','');
          const purchase = editCandidateField(doc, editor.form,
            'Prix d’achat fournisseur', row.purchase_price, 'number');
          purchase.setAttribute('data-sourcing-edit-purchase','');
          const currency = editCandidateField(doc, editor.form, 'Devise',
            row.currency || '');
          currency.setAttribute('data-sourcing-edit-currency','');
          editor.form.addEventListener('submit', async event => {
            event.preventDefault();
            const rawWeight = weight.value.trim(), rawPurchase = purchase.value.trim();
            const valueCurrency = currency.value.trim().toUpperCase();
            if (rawWeight && (!Number.isFinite(Number(rawWeight)) || Number(rawWeight) < 0)) {
              editor.feedback.textContent = 'Indiquez un poids positif ou laissez-le vide.';
              return;
            }
            if (!rawPurchase || !Number.isFinite(Number(rawPurchase)) ||
                Number(rawPurchase) <= 0) {
              editor.feedback.textContent = 'Prix fournisseur strictement positif requis.';
              return;
            }
            if (!['AED','EUR','USD','KMF','PLN'].includes(valueCurrency)) {
              editor.feedback.textContent = 'Devise non prise en charge par ce formulaire.';
              return;
            }
            await sendCandidateForm(context, editor,
              ENDPOINT + '/candidates/' + encodeURIComponent(row.candidate_ref) + '/update',
              { ...(rawWeight ? { estimated_weight_kg:Number(rawWeight) } : {}),
                purchase_price:Number(rawPurchase), currency:valueCurrency },
              row.candidate_ref + ' : faits fournisseur mis à jour.');
          });
          purchase.focus();
        });
        actions.appendChild(edit);
      } else if (issue?.key === 'scan-candidate' && !row.product_ref) {
        const scan = makeButton(doc, issue.label, 'scan-candidate');
        scan.className += ' kmc-sourcing-next-action';
        scan.addEventListener('click', () => runAction(context, scan, {
          url: ENDPOINT + '/candidates/' + encodeURIComponent(row.candidate_ref) + '/scan',
          successMessage: row.candidate_ref + ' : contrôle fournisseur exécuté.',
        }));
        actions.appendChild(scan);
      }
      const link = text(doc, 'a', 'kmc-workspace-nav-link', 'Catalogue');
      link.href = '/admin/workspaces/catalog?search=' + encodeURIComponent(
        row.product_ref || row.candidate_ref || '');
      link.setAttribute('data-workspace-action', 'view-catalog');
      actions.appendChild(link);
      tr.appendChild(actions);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    slot.appendChild(wrapTable(doc,table));
  }

  function renderImports(rootNode, ui, doc, payload, context) {
    const slot = createSection(
      rootNode,
      ui,
      'Lancer un import',
      'Choisir une source réelle ou importer un fichier. Le Cockpit conserve l’historique des passages.'
    );

    const bar = doc.createElement('div');
    bar.className = 'kmc-workspace-section-actions';
    const manual = makeButton(doc, 'Import manuel', 'manual-import');
    const csv = makeButton(doc, 'Import CSV', 'csv-import', true);
    const cockpit = text(doc, 'a', 'kmc-workspace-nav-link', 'Ouvrir le Cockpit →');
    cockpit.href = '/admin/import-runtime';
    bar.appendChild(manual);
    bar.appendChild(csv);
    bar.appendChild(cockpit);
    slot.appendChild(bar);
    // Les sources réelles remplacent les boutons CJ/AliExpress à volume 20 figé.
    const discoveryBar = doc.createElement('div');
    discoveryBar.className = 'kmc-workspace-section-actions';
    const sources = Array.isArray(payload.sources) ? payload.sources : [];
    sources.filter(source => source.status === 'active').forEach(source => {
      const label = source.label || source.adapter_type || source.source_ref;
      const ready = Boolean(source.connector_ready && source.discovery_ready
        && source.discovery_enabled && source.sync_enabled && source.import_enabled
        && !['missing', 'invalid'].includes(source.credential_status));
      if (!ready) {
        const setup = text(doc, 'a', 'kmc-workspace-nav-link',
          'Configurer la source · ' + label);
        setup.href = '/admin/import-runtime?view=sources';
        setup.title = 'Ouvrir la configuration et les prérequis de la source';
        discoveryBar.appendChild(setup);
        return;
      }
      const button = makeButton(doc, 'Importer · ' + label, 'import-source', true);
      button.title = 'Lancer une acquisition sans publication';
      button.addEventListener('click', () => {
        if (!context.confirm('Lancer l’acquisition fournisseur ' + label +
          ' ? Aucun produit ne sera publié automatiquement.')) return;
        runAction(context, button, {
          url: ENDPOINT + '/sources/' + encodeURIComponent(source.source_ref) + '/import-now',
          runningMessage: 'Acquisition fournisseur en cours…',
          successMessage: 'Acquisition terminée. Ouverture du suivi…',
          onSuccess(result) {
            const runRef = result?.result?.run_ref;
            if (runRef) context.navigate('/admin/import-runtime?run=' + encodeURIComponent(runRef));
            else setFeedback(context.root,
              'Aucune référence de passage retournée. Vérifiez le Cockpit avant toute relance.', 'critical');
          },
        });
      });
      discoveryBar.appendChild(button);
    });
    if (!sources.length) {
      discoveryBar.appendChild(text(doc, 'p', 'kmc-workspace-subtitle',
        'Aucune source configurée. Un import manuel reste possible.'));
      const setup = text(doc, 'a', 'kmc-workspace-nav-link', 'Configurer une source');
      setup.href = '/admin/import-runtime?view=sources';
      discoveryBar.appendChild(setup);
    }
    slot.appendChild(discoveryBar);

    // Un formulaire opérateur unique remplace les fenêtres prompt() en chaîne.
    const panel = doc.createElement('section');
    panel.className = 'kmc-workspace-section-actions';
    panel.setAttribute('data-sourcing-manual-panel', '');
    panel.hidden = true;
    const heading = text(doc, 'h3', 'kmc-workspace-title', 'Importer des produits');
    const supplier = doc.createElement('input');
    supplier.type = 'text';
    supplier.placeholder = 'Nom du fournisseur';
    supplier.setAttribute('aria-label', 'Nom du fournisseur');
    supplier.setAttribute('data-manual-supplier', '');
    const editor = doc.createElement('textarea');
    editor.rows = 8;
    editor.setAttribute('aria-label', 'Données produit');
    editor.setAttribute('data-manual-products', '');
    const feedback = text(doc, 'p', 'kmc-workspace-subtitle', 'Aucun import envoyé.');
    feedback.setAttribute('role', 'status');
    feedback.setAttribute('data-manual-feedback', '');
    const submit = makeButton(doc, 'Vérifier et importer', 'submit-manual-import');
    const cancel = makeButton(doc, 'Annuler', 'cancel-manual-import', true);
    panel.appendChild(heading);
    panel.appendChild(supplier);
    panel.appendChild(editor);
    panel.appendChild(feedback);
    panel.appendChild(submit);
    panel.appendChild(cancel);
    slot.appendChild(panel);
    let mode = 'manual';
    function open(modeValue) {
      mode = modeValue;
      panel.hidden = false;
      heading.textContent = mode === 'csv' ? 'Importer un CSV fournisseur' : 'Importer un JSON fournisseur';
      editor.placeholder = mode === 'csv'
        ? 'supplier_product_id,product_name,purchase_price,currency'
        : '[{"supplier_product_id":"REF-1","product_name":"Produit","purchase_price":100,"currency":"AED"}]';
      editor.value = '';
      feedback.textContent = 'Saisissez le fournisseur et les données, puis vérifiez avant import.';
      supplier.focus?.();
    }
    manual.addEventListener('click', () => open('manual'));
    csv.addEventListener('click', () => open('csv'));
    cancel.addEventListener('click', () => { panel.hidden = true; });
    submit.addEventListener('click', async () => {
      const name = String(supplier.value || '').trim();
      const raw = String(editor.value || '').trim();
      if (!name || !raw) { feedback.textContent = 'Renseignez le fournisseur et les données produit.'; return; }
      let body;
      if (mode === 'manual') {
        let items;
        try { items = JSON.parse(raw); }
        catch (_) { feedback.textContent = 'JSON invalide : vérifiez la syntaxe.'; return; }
        if (!Array.isArray(items) || !items.length) { feedback.textContent = 'Le JSON doit être un tableau non vide.'; return; }
        body = { supplier_name: name, source_type: 'manual', items };
      } else {
        body = { supplier_name: name, source_type: 'csv', csv_text: raw };
      }
      feedback.textContent = 'Transmission en cours…';
      const result = await runAction(context, submit, {
        url: `${ENDPOINT}/imports`,
        body,
        successMessage: `Import ${name} lancé. Suivez son passage dans le cockpit Sourcing.`,
      });
      // runAction recharge le panneau uniquement en cas de succès.
      // En cas d'échec, l'import reste modifiable, sans état trompeur.
      if (!result) feedback.textContent = 'Import non envoyé. Vérifiez les données et le message d’erreur affiché.';
    });
  }

  function renderPortfolio(rootNode, ui, doc, payload, context) {
    const slot = createSection(rootNode, ui, 'Portefeuille sourcing', 'Les champs opérationnels sourcing du produit sont modifiés via product_ref ; Product 360 reste la vue explicative.');
    const rows = payload.portfolio?.products || [];
    if (!rows.length) {
      slot.appendChild(text(doc, 'div', 'kmc-workspace-empty', 'Aucun produit dans l’analyse sourcing.'));
      return;
    }
    const table = doc.createElement('table');
    table.className = 'kmc-workspace-table';
    table.innerHTML = '<thead><tr><th>Référence</th><th>Produit</th><th>Rail</th><th>Coût</th><th>Poids</th><th>Cycle</th><th></th></tr></thead>';
    const tbody = doc.createElement('tbody');
    rows.slice(0, 150).forEach(row => {
      const tr = doc.createElement('tr');
      tr.appendChild(td(doc, row.product_ref));
      tr.appendChild(td(doc, row.name));
      tr.appendChild(td(doc, row.sourcing_rail));
      tr.appendChild(td(doc, formatKmf(row.cost_price_kmf)));
      tr.appendChild(td(doc, row.weight_g == null ? '—' : `${formatNumber(row.weight_g)} g`));
      tr.appendChild(td(doc, row.lifecycle_status));
      const actions = doc.createElement('td');
      const detail = text(doc, 'a', 'kmc-workspace-nav-link', 'Product 360');
      detail.href = contextualHref(`/admin/products/${encodeURIComponent(row.product_ref)}`, '/admin/workspaces/sourcing', 'Retour au sourcing');
      actions.appendChild(detail);
      const edit = makeButton(doc, 'Modifier sourcing', 'update-sourcing-product', true);
      edit.addEventListener('click', () => {
        const rail = context.prompt('Rail sourcing (A/B/C/D)', row.sourcing_rail || '');
        if (rail == null) return;
        const cost = context.prompt('Coût achat KMF', row.cost_price_kmf == null ? '' : String(row.cost_price_kmf));
        if (cost == null) return;
        const weight = context.prompt('Poids g', row.weight_g == null ? '' : String(row.weight_g));
        if (weight == null) return;
        runAction(context, edit, {
          url: `${ENDPOINT}/products/${encodeURIComponent(row.product_ref)}/update`,
          body: {
            ...(rail.trim() ? { sourcing_rail: rail.trim().toUpperCase() } : {}),
            ...(cost.trim() ? { cost_price_kmf: Number(cost) } : {}),
            ...(weight.trim() ? { weight_g: Number(weight) } : {}),
          },
          successMessage: `${row.product_ref} mis à jour côté sourcing.`,
        });
      });
      actions.appendChild(edit);
      tr.appendChild(actions);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    slot.appendChild(wrapTable(doc, table));
  }

  function renderSuppliers(rootNode, ui, doc, payload, context) {
    const slot = createSection(
      rootNode,
      ui,
      'Fournisseurs sourcing',
      '4E administre uniquement partner_type=sourcing. Transitaires, relais et équipes Hub restent hors de cette autorité.'
    );
    const bar = doc.createElement('div');
    bar.className = 'kmc-workspace-section-actions';
    const create = makeButton(doc, 'Nouveau fournisseur', 'create-supplier');
    bar.appendChild(create);
    slot.appendChild(bar);

    // Un seul éditeur intégré pour création et mise à jour : les routes
    // fournisseurs sourcing restent les seules autorités d'écriture.
    const panel = doc.createElement('section');
    panel.className = 'kmc-workspace-section-actions';
    panel.setAttribute('data-sourcing-supplier-panel', '');
    panel.hidden = true;
    const form = doc.createElement('form');
    form.className = 'kmc-workspace-section-actions';
    form.setAttribute('data-sourcing-supplier-form', '');
    const heading = text(doc, 'h3', 'kmc-workspace-subtitle', '');
    form.appendChild(heading);
    function supplierField(title, key, type = 'text') {
      const wrapper = doc.createElement('label');
      wrapper.className = 'kmc-catalog-fr-field';
      wrapper.appendChild(text(doc, 'span', 'kmc-catalog-fr-label', title));
      const input = doc.createElement('input');
      input.type = type;
      input.setAttribute('data-supplier-field', key);
      wrapper.appendChild(input);
      form.appendChild(wrapper);
      return { wrapper, input };
    }
    const nameField = supplierField('Nom du fournisseur', 'name');
    const countryField = supplierField('Code pays (2 lettres)', 'country_code');
    const contactField = supplierField('Contact (facultatif)', 'contact_name');
    const delayField = supplierField('Délai fournisseur (jours)', 'lead_time_days', 'number');
    delayField.input.min = '0';
    delayField.input.step = '1';
    const feedback = text(doc, 'p', 'kmc-workspace-subtitle', '');
    feedback.setAttribute('data-supplier-feedback', '');
    feedback.setAttribute('role', 'status');
    form.appendChild(feedback);
    const save = makeButton(doc, 'Enregistrer', 'submit-supplier');
    save.type = 'submit';
    const cancel = makeButton(doc, 'Annuler', 'cancel-supplier', true);
    cancel.addEventListener('click', () => { panel.hidden = true; });
    form.appendChild(save);
    form.appendChild(cancel);
    panel.appendChild(form);
    slot.appendChild(panel);

    let editing = null;
    function openSupplierForm(row = null) {
      editing = row;
      heading.textContent = row ? 'Modifier · ' + row.partner_ref : 'Nouveau fournisseur sourcing';
      nameField.input.value = row?.name || '';
      countryField.input.value = row?.country_code || 'AE';
      contactField.input.value = row?.contact_name || '';
      delayField.input.value = row?.lead_time_days == null ? '' : String(row.lead_time_days);
      countryField.wrapper.hidden = Boolean(row);
      contactField.wrapper.hidden = Boolean(row);
      delayField.wrapper.hidden = !row;
      feedback.textContent = 'Vérifiez les champs avant enregistrement.';
      panel.hidden = false;
      nameField.input.focus?.();
      panel.scrollIntoView?.({ block: 'nearest' });
    }
    create.addEventListener('click', () => openSupplierForm());
    form.addEventListener('submit', async (event) => {
      event?.preventDefault?.();
      const name = String(nameField.input.value || '').trim();
      if (!name) {
        feedback.textContent = 'Le nom du fournisseur est obligatoire.';
        return;
      }
      let url = ENDPOINT + '/suppliers';
      let body;
      if (editing) {
        const delay = String(delayField.input.value || '').trim();
        if (delay && (!/^(0|[1-9][0-9]*)$/.test(delay) || Number(delay) > 3650)) {
          feedback.textContent = 'Délai invalide : nombre entier de 0 à 3650 jours.';
          return;
        }
        url += '/' + encodeURIComponent(editing.partner_ref) + '/update';
        body = { name, ...(delay ? { lead_time_days: Number(delay) } : {}) };
      } else {
        const country = String(countryField.input.value || '').trim().toUpperCase();
        if (country && !/^[A-Z]{2}$/.test(country)) {
          feedback.textContent = 'Code pays invalide : deux lettres sont attendues.';
          return;
        }
        const contact = String(contactField.input.value || '').trim();
        body = { name, ...(country ? { country_code: country } : {}), ...(contact ? { contact_name: contact } : {}) };
      }
      feedback.textContent = 'Enregistrement en cours…';
      const result = await runAction(context, save, {
        url, body,
        successMessage: editing ? editing.partner_ref + ' mis à jour.' : name + ' ajouté aux fournisseurs sourcing.',
      });
      if (!result) feedback.textContent = 'Enregistrement refusé. Vérifiez le message d’erreur affiché.';
    });

    const rows = payload.suppliers || [];
    if (!rows.length) {
      slot.appendChild(text(doc, 'div', 'kmc-workspace-empty', 'Aucun fournisseur sourcing.'));
      return;
    }
    const table = doc.createElement('table');
    table.className = 'kmc-workspace-table';
    table.innerHTML = '<thead><tr><th>Référence</th><th>Fournisseur</th><th>Pays</th><th>Contact</th><th>Délai</th><th>État</th><th></th></tr></thead>';
    const tbody = doc.createElement('tbody');
    rows.forEach(row => {
      const tr = doc.createElement('tr');
      tr.appendChild(td(doc, row.partner_ref));
      tr.appendChild(td(doc, row.name));
      tr.appendChild(td(doc, row.country_code || row.country_label));
      tr.appendChild(td(doc, row.contact_name || row.contact_phone || row.contact_email));
      tr.appendChild(td(doc, row.lead_time_days == null ? '—' : `${row.lead_time_days} j`));
      tr.appendChild(td(doc, row.is_active ? 'Actif' : 'Inactif'));
      const actions = doc.createElement('td');
      const edit = makeButton(doc, 'Modifier', 'update-supplier', true);
      edit.addEventListener('click', () => openSupplierForm(row));
      actions.appendChild(edit);
      const toggle = makeButton(doc, row.is_active ? 'Désactiver' : 'Réactiver', 'toggle-supplier', true);
      toggle.addEventListener('click', () => {
        if (!context.confirm(`${row.is_active ? 'Désactiver' : 'Réactiver'} ${row.name} ?`)) return;
        runAction(context, toggle, {
          url: `${ENDPOINT}/suppliers/${encodeURIComponent(row.partner_ref)}/${row.is_active ? 'deactivate' : 'activate'}`,
          successMessage: `${row.partner_ref} mis à jour.`,
        });
      });
      actions.appendChild(toggle);
      tr.appendChild(actions);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    slot.appendChild(wrapTable(doc, table));
  }

  function renderPayload(rootNode, ui, doc, payload, context) {
    rootNode.className = 'kmc-operations-workspace kmc-sourcing-workspace';
    rootNode.setAttribute('data-workspace-kind', 'sourcing');
    rootNode.replaceChildren();
    rootNode.appendChild(createHeader(doc));
    const metrics = doc.createElement('section');
    metrics.className = 'kmc-workspace-metrics';
    rootNode.appendChild(metrics);
    ui.MetricStrip.render(metrics, { items: metricItems(payload.summary) });
    const open = (payload.candidates || []).filter(sourcingRemedy).length;
    // Technical fallback only: legacy path is no longer a parallel Sourcing dashboard.
    const pages = context.partnerManagement
      ? [{key:'suppliers',label:'Partenaires fournisseurs',count:(payload.suppliers || []).length,render:renderSuppliers}]
      : context.focusCandidateRef
        ? [{key:'candidates',label:'Corriger les faits fournisseur',count:open,render:renderCandidates}]
        : [{key:'imports',label:'Importer',count:(payload.imports || []).length,render:renderImports}];
    const nav = doc.createElement('nav');
    nav.className = 'kmc-sourcing-tabs';
    nav.setAttribute('role','tablist');
    nav.setAttribute('aria-label','Rubriques du Sourcing');
    rootNode.appendChild(nav);
    const panels = new Map();
    const tabs = new Map();
    for (const page of pages) {
      const button = text(doc,'button','kmc-sourcing-tab',page.label+' · '+formatNumber(page.count));
      button.type = 'button';
      button.id = 'kmc-sourcing-tab-'+page.key;
      button.setAttribute('role','tab');
      button.setAttribute('aria-controls','kmc-sourcing-panel-'+page.key);
      button.addEventListener('click',()=>context.selectTab(page.key));
      nav.appendChild(button);
      tabs.set(page.key,button);
      const panel = doc.createElement('div');
      panel.className = 'kmc-sourcing-tab-panel';
      panel.id = 'kmc-sourcing-panel-'+page.key;
      panel.setAttribute('role','tabpanel');
      panel.setAttribute('aria-labelledby',button.id);
      rootNode.appendChild(panel);
      panels.set(page.key,panel);
    }
    context.selectTab = key => {
      context.activeTab = panels.has(key) ? key : 'imports';
      panels.forEach((panel,tab) => {
        const selected = tab === context.activeTab;
        panel.hidden = !selected;
        tabs.get(tab).setAttribute('aria-selected',String(selected));
        tabs.get(tab).tabIndex = selected ? 0 : -1;
      });
    };
    for (const page of pages) page.render(panels.get(page.key),ui,doc,payload,context);
    context.selectTab(context.focusCandidateRef ? 'candidates' : context.activeTab);
  }

  async function mount(options = {}) {
    const rootNode = options.root;
    const doc = options.document;
    const ui = options.ui;
    const fetchFn = options.fetch;
    if (!rootNode || !doc || !ui || typeof fetchFn !== 'function') {
      throw new Error('canonical_sourcing_workspace_dependencies_missing');
    }
    const focusSearch = options.locationSearch ??
      (typeof globalThis !== 'undefined' && globalThis.location ? globalThis.location.search : '');
    const search = new URLSearchParams(focusSearch || '');
    // In a real browser, old links converge on the single Live screen.
    // Only a focused source-fact correction and optional partner administration
    // keep this narrow legacy surface, without multiple operator tabs.
    if (typeof window !== 'undefined' &&
        window.location?.pathname === '/admin/workspaces/sourcing' &&
        !search.get('candidate_ref') && search.get('mode') !== 'partners') {
      const href = '/admin/import-runtime' +
        (search.get('tab') === 'imports' || search.get('tab') === 'suppliers' ? '?view=sources' :
        search.get('tab') === 'candidates' ? '#sourcing-actions' : '');
      (options.navigate || (url => window.location.assign(url)))(href);
      return { redirected: true, href };
    }
    const context = {
      focusCandidateRef: new URLSearchParams(focusSearch || '').get('candidate_ref'),
      partnerManagement: search.get('mode') === 'partners',
      activeTab: ['imports','candidates','suppliers'].includes(new URLSearchParams(focusSearch || '').get('tab'))
        ? new URLSearchParams(focusSearch || '').get('tab') : 'imports',
      selectTab: null,
      root: rootNode,
      user: options.user || {},
      fetch: fetchFn,
      confirm: options.confirm || (typeof window !== 'undefined' ? window.confirm.bind(window) : () => true),
      prompt: options.prompt || (typeof window !== 'undefined' ? window.prompt.bind(window) : () => null),
      reload: null,
      navigate: options.navigate || (href => { if (typeof window !== 'undefined') window.location.assign(href); }),
    };
    context.reload = async () => {
      try {
        const search = options.locationSearch
          ?? (typeof globalThis !== 'undefined' && globalThis.location ? globalThis.location.search : '');
        const diagnostic = new URLSearchParams(search || '').get('diagnostic') === '1';
        const params = new URLSearchParams();
        if (diagnostic) params.set('include', 'health');
        if (context.focusCandidateRef) params.set('candidate_ref', context.focusCandidateRef);
        const endpoint = ENDPOINT + (params.toString() ? '?' + params.toString() : '');
        const payload = await jsonRequest(fetchFn, endpoint, { timeoutMs: diagnostic ? 60000 : LOAD_TIMEOUT_MS });
        renderPayload(rootNode, ui, doc, payload, context);
        return payload;
      } catch (error) {
        rootNode.replaceChildren();
        const panel = doc.createElement('section');
        panel.className = 'kmc-workspace-header';
        panel.appendChild(text(doc, 'span', 'kmc-workspace-kicker', 'SOURCING'));
        panel.appendChild(text(doc, 'h1', 'kmc-workspace-title', 'Accès Sourcing indisponible'));
        panel.appendChild(text(doc, 'p', 'kmc-workspace-subtitle', error.message));
        rootNode.appendChild(panel);
        throw error;
      }
    };
    return context.reload();
  }

  return Object.freeze({ ENDPOINT, metricItems, sourcingRemedy, nextCandidateAction, mount });
});

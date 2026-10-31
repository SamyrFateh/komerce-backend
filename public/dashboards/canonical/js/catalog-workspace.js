/**
 * @komerce-arch
 * @role          canonical-catalog-workspace-ui
 * @domain        admin-dashboard
 * @layer         ui-orchestration
 * @criticality   high
 * @inputs        authenticated_central_admin, commercial_catalog_projection
 * @outputs       canonical_catalog_workspace_dom, authorized_catalog_action_requests
 * @depends       canonical primitives
 * @used-by       canonical admin entrypoint
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      workspace_acts_dashboard_observes, canonical_admin_no_legacy_imports, global_catalog_not_market_scoped, commercial_catalog_is_union_of_approved_products_from_closed_kirs, product_360_explains, sourcing_keeps_source_mutation_authority, no_paid_ai_api_for_fr_preparation, catalog_entry_gesture_primes_local_translation, human_catalog_validation_required
 * @impact-areas  admin-dashboard, catalog, sourcing, boutique
 * @version       2026-10-v2
 */

'use strict';

(function initCatalogWorkspace(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.KomerceCanonicalCatalogWorkspace = api;
})(typeof globalThis !== 'undefined' ? globalThis : null, function createCatalogWorkspace() {
  const ENDPOINT = '/api/admin/workspaces/catalog';
  const SOURCING_ENDPOINT = '/api/admin/workspaces/sourcing';
  const CATALOG_FR_TRANSLATOR_CACHE_KEY = '__KOMERCE_CATALOG_FR_TRANSLATOR__';
  let activeContext = null;
  let activePayload = null;

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

  function formatNumber(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '—';
    return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(number);
  }

  function formatKmf(value) {
    return value == null ? '—' : `${formatNumber(value)} KMF`;
  }

  function confidence(value) {
    const n = Number(value);
    return Number.isFinite(n) ? `${Math.round(n * 100)} %` : '—';
  }

  function formatSource(row = {}) {
    const object = row && typeof row === 'object' ? row : null;
    const value = object ? object.content_source : row;
    if (
      value === 'manual'
      && object
      && (object.name_source || object.description_source)
      && !isFrenchLocale(object.source_locale)
    ) {
      return 'FR préparé';
    }
    const labels = {
      connector_raw: 'Source fournisseur',
      ai_enriched: 'Assisté IA',
      manual: 'Préparation humaine',
    };
    return labels[value] || value || '—';
  }

  function formatRelativeTime(value) {
    if (!value) return 'Jamais';
    const at = new Date(value).getTime();
    if (!Number.isFinite(at)) return '—';
    const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
    if (seconds < 60) return `il y a ${seconds} s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `il y a ${minutes} min`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `il y a ${hours} h`;
    return new Date(value).toLocaleString('fr-FR');
  }

  function stageLabel(stage) {
    const labels = {
      captured: 'Capturé',
      normalized: 'Normalisé',
      qualified: 'Qualifié',
      fr_ready: 'FR prêt',
      curation: 'Curation',
      catalog: 'Catalogue',
      boutique: 'Boutique',
    };
    return labels[stage] || stage || '—';
  }

  async function jsonRequest(fetchFn, url, options = {}) {
    const response = await fetchFn(url, {
      method: options.method || 'GET',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(options.body == null ? {} : { 'Content-Type': 'application/json' }),
      },
      body: options.body == null ? undefined : JSON.stringify(options.body),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body.error || `Erreur HTTP ${response.status}`);
      error.code = body.code || null;
      error.status = response.status;
      error.reasons = Array.isArray(body.reasons) ? body.reasons : [];
      error.certificationVersion = body.certification_version || null;
      throw error;
    }
    return body;
  }

  function certificationReasonLabel(reason) {
    const labels = {
      supplier_name_missing: 'fournisseur absent',
      supplier_product_id_missing: 'référence produit fournisseur absente',
      decision_not_accepted: 'décision sourcing non acceptée (TEST ou PRIORITY requis)',
      source_contract_v2_missing: 'contrat source v2 absent',
      name_missing: 'titre produit absent',
      description_missing: 'description produit absente',
      french_editorial_not_ready: 'préparation française non finalisée',
      customs_category_missing: 'catégorie douanière absente',
      boutique_category_missing: 'catégorie Boutique absente',
      boutique_subcategory_missing: 'sous-catégorie Boutique absente',
      boutique_taxonomy_inactive_or_invalid: 'taxonomie Boutique inactive ou invalide',
      media_missing: 'média Catalogue absent',
      active_supplier_sku_missing: 'SKU fournisseur actif absent',
      supplier_order_identity_incomplete: 'identité de commande fournisseur incomplète',
      not_inactive_candidate: 'produit hors état candidate inactif',
      market_exposure_enabled: 'exposition marché déjà activée',
    };
    if (labels[reason]) return labels[reason];
    if (String(reason || '').startsWith('publication_guard:')) {
      return `publication guard : ${String(reason).slice('publication_guard:'.length)}`;
    }
    return String(reason || '').replaceAll('_', ' ');
  }

  function actionErrorMessage(error) {
    const reasons = Array.isArray(error?.reasons) ? error.reasons.filter(Boolean) : [];
    if (!reasons.length) return error?.message || 'Action refusée.';
    return `${error.message || 'Certification refusée'} — ${reasons.map(certificationReasonLabel).join(' · ')}`;
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

  function createHeader(doc, refinery = false) {
    const header = doc.createElement('header');
    header.className = refinery ? 'kmc-workspace-header' : 'kmc-workspace-header kmc-catalog-compact-header';
    const copy = doc.createElement('div');
    if (refinery) copy.appendChild(text(doc, 'span', 'kmc-workspace-kicker', 'WORKSPACE · RAFFINERIE'));
    copy.appendChild(text(doc, 'h1', 'kmc-workspace-title', refinery ? 'Raffinerie produits' : 'Catalogue global'));
    if (refinery) {
      copy.appendChild(text(doc, 'p', 'kmc-workspace-subtitle', 'Suivi de préparation automatique. Les fiches et leurs corrections sont exclusivement dans le Catalogue.'));
    }
    header.appendChild(copy);

    if (refinery) {
      const nav = doc.createElement('nav');
      nav.className = 'kmc-workspace-nav';
      const commerce = text(doc, 'a', 'kmc-workspace-nav-link', '← Dashboard Commerce');
      commerce.href = '/admin/commerce';
      nav.appendChild(commerce);
      const cockpit = text(doc, 'a', 'kmc-workspace-nav-link', 'Cockpit des imports');
      cockpit.href = '/admin/import-runtime';
      nav.appendChild(cockpit);
      const next = text(doc, 'a', 'kmc-workspace-nav-link', 'Catalogue →');
      next.href = '/admin/workspaces/catalog';
      nav.appendChild(next);
      header.appendChild(nav);
    }

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

  function metricItems(summary = {}, curation = {}) {
    return [
      { key: 'registry', label: 'Produits remis (filtres)', value: formatNumber(summary.registry_total), tone: 'neutral' },
      { key: 'published', label: 'Assortiment approuvé affiché', value: formatNumber(summary.commercial_approved), tone: 'neutral' },
      { key: 'lots', label: 'KIR clos de l’assortiment affiché', value: formatNumber(summary.commercial_closed_lots), tone: 'neutral' },
      { key: 'approval', label: 'À curater', value: formatNumber(summary.approval_pending), tone: summary.approval_pending ? 'warning' : 'neutral' },
      { key: 'review', label: 'À relire', value: formatNumber(summary.needs_review), tone: summary.needs_review ? 'warning' : 'neutral' },
      { key: 'markets', label: 'Marchés de l’assortiment affiché', value: formatNumber(summary.commercial_markets), tone: 'neutral' },
    ];
  }

  function setInlineActionFeedback(target, message, tone = 'neutral') {
    if (!target) return;
    target.className = `kmc-catalog-action-feedback is-${tone}`;
    target.textContent = message || '';
  }

  async function runAction(context, button, options) {
    const previous = button.textContent;
    const inlineFeedback = options.feedbackTarget || null;
    const runningMessage = options.runningMessage || 'Action en cours…';
    button.disabled = true;
    button.textContent = 'En cours…';
    setFeedback(context.root, runningMessage);
    setInlineActionFeedback(inlineFeedback, runningMessage);
    try {
      const result = await jsonRequest(context.fetch, options.url, { method: 'POST', body: options.body || {} });
      const followUp = typeof options.afterSuccess === 'function'
        ? await options.afterSuccess(result) : null;
      const successMessage = followUp?.message || options.successMessage || 'Action appliquée.';
      const tone = followUp?.tone || 'positive';
      setFeedback(context.root, successMessage, tone);
      setInlineActionFeedback(inlineFeedback, successMessage, tone);
      await context.reload();
      return result;
    } catch (error) {
      const message = actionErrorMessage(error);
      setFeedback(context.root, message, 'critical');
      setInlineActionFeedback(inlineFeedback, message, 'critical');
      button.disabled = false;
      button.textContent = previous;
      return null;
    }
  }

  // Only an operator-initiated correction may finish Catalogue automatically.
  // This reuses the canonical server certification + audited approval writers.
  // Merely opening a dossier (GET) must never mutate a product.
  async function finishCatalogueAfterCorrection(context, row) {
    if (!row?.product_ref || row.lifecycle_status !== 'candidate' || !row.candidate_ref) return null;
    try {
      // Méthode explicite : il s'agit d'une lecture, jamais d'un POST.
      // Les contrôles de contrat API doivent distinguer ce GET du POST d'approbation suivant.
      const diagnosis = await jsonRequest(context.fetch,
        ENDPOINT + '?diagnose_product_ref=' + encodeURIComponent(row.product_ref),
        { method: 'GET' });
      if (diagnosis?.phase !== 'catalog_approval' || diagnosis?.certification?.certified !== true)
        return null; // unresolved server prerequisites remain visible after reload
      const result = await jsonRequest(context.fetch,
        ENDPOINT + '/approval/' + encodeURIComponent(row.product_ref) + '/approve',
        { method: 'POST' });
      if (!result?.ok) throw new Error('Approbation Catalogue non acquise.');
      return { message: row.product_ref +
        ' : toutes les corrections sont conformes. Catalogue approuvé et audité ; aucun marché publié.',
        tone: 'positive' };
    } catch (error) {
      return { message: row.product_ref +
        ' : correction enregistrée, mais approbation Catalogue non acquise : ' +
        actionErrorMessage(error), tone: 'warning' };
    }
  }

  function wrapTable(doc, table) {
    const wrap = doc.createElement('div');
    wrap.className = 'kmc-workspace-table-wrap';
    wrap.appendChild(table);
    return wrap;
  }

  function td(doc, value) {
    const cell = doc.createElement('td');
    cell.textContent = value == null || value === '' ? '—' : String(value);
    return cell;
  }

  function sourcingDecisionLabel(value) {
    return ({
      PRIORITY: 'Prioritaire',
      TEST: 'À tester',
      WATCH: 'À surveiller',
      AVOID: 'À éviter',
      LOSS: 'Perte',
      UNKNOWN: 'Non évalué',
    })[String(value || 'UNKNOWN').toUpperCase()] || String(value || 'Non évalué');
  }

  function sourcingDecisionTone(value) {
    return ({
      PRIORITY: 'is-positive',
      TEST: 'is-positive',
      WATCH: 'is-warning',
      AVOID: 'is-critical',
      LOSS: 'is-critical',
      UNKNOWN: 'is-neutral',
    })[String(value || 'UNKNOWN').toUpperCase()] || 'is-neutral';
  }

  function isFrenchLocale(value) {
    const locale = String(value || '').trim().toLowerCase().replace('_', '-');
    return locale === 'fr' || locale.startsWith('fr-');
  }

  function needsFrenchPreparation(row = {}) {
    return row.content_source === 'connector_raw' && !isFrenchLocale(row.source_locale);
  }

  function hasGlobalReferencePrice(row = {}) {
    const price = Number(row.price_kmf);
    return row.price_kmf != null && Number.isFinite(price) && price > 0;
  }

  // A global product is not yet a buyer offer. A supplier-linked draft may
  // pass human catalog approval with price_kmf=NULL; the market operator later
  // decides the local price, and the buyer API insists on LOCAL_ACTIVE.
  function hasPublishablePrice(row = {}) {
    return hasGlobalReferencePrice(row) ||
      (row.supplier_source_linked === true && row.price_kmf == null);
  }

  function classificationNote(row = {}) {
    const c = row.classification || {};
    if (c.status !== 'fallback_unresolved') return null;
    const supplier = c.supplier_category ? ` Catégorie fournisseur : ${c.supplier_category}.` : '';
    return `Classement non validé : aucune catégorie Komerce n’a été attribuée, le produit est resté en « autre » par repli technique.${supplier} À classer avant validation (responsable : curation catalogue).`;
  }

  function priceExplanation(row = {}) {
    return hasPublishablePrice(row)
      ? 'Fiche Catalogue : la fixation du prix et les coûts commerciaux appartiennent au marché.'
      : 'Préparation du produit à terminer ; le marché déterminera le prix lorsque la fiche sera éligible.';
  }

  function marketPriceLabel(market = {}) {
    if (market.price_status === 'LOCAL_ACTIVE') return 'Prix défini par le marché';
    if (market.price_status) return 'Décision tarifaire en cours';
    return 'Prix à décider par le marché';
  }

  function curationState(row = {}) {
    if (needsFrenchPreparation(row)) return { label: 'FR à préparer', tone: 'is-warning' };
    const prepared = row.content_source === 'ai_enriched' || row.content_source === 'manual';
    if (!hasPublishablePrice(row)) {
      return {
        label: prepared ? 'FR préparé · prix à définir' : 'Prix à définir',
        tone: 'is-warning',
      };
    }
    if (row.needs_review) return { label: 'FR préparé · à relire', tone: 'is-warning' };
    return { label: 'Prêt à valider', tone: 'is-positive' };
  }

  function closeCatalogCompare(context) {
    const existing = context.root.querySelector('[data-catalog-compare-dialog]');
    if (existing) existing.remove();
  }

  function openCatalogCompare(context, row = {}) {
    const doc = context.document;
    const prepared = row.content_source === 'ai_enriched' || row.content_source === 'manual';
    closeCatalogCompare(context);

    const overlay = doc.createElement('div');
    overlay.className = 'kmc-catalog-compare-overlay';
    overlay.setAttribute('data-catalog-compare-dialog', '');

    const dialog = doc.createElement('section');
    dialog.className = 'kmc-catalog-compare-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', `Avant / après · ${row.product_ref || 'produit'}`);

    const heading = doc.createElement('header');
    heading.className = 'kmc-catalog-compare-heading';
    const headingCopy = doc.createElement('div');
    headingCopy.appendChild(text(doc, 'span', 'kmc-workspace-kicker', 'COMPARAISON CATALOGUE'));
    headingCopy.appendChild(text(doc, 'h2', 'kmc-catalog-compare-heading-title', row.product_ref || 'Produit'));
    headingCopy.appendChild(text(doc, 'p', 'kmc-workspace-subtitle', 'La source fournisseur reste intacte. Le français affiché est la préparation à relire.'));
    heading.appendChild(headingCopy);

    const close = makeButton(doc, 'Fermer', 'close-compare', true);
    close.addEventListener('click', () => closeCatalogCompare(context));
    heading.appendChild(close);
    dialog.appendChild(heading);

    const grid = doc.createElement('div');
    grid.className = 'kmc-catalog-compare-grid';

    const before = doc.createElement('div');
    before.className = 'kmc-catalog-compare-pane';
    before.appendChild(text(doc, 'strong', '', prepared ? 'Avant · fournisseur' : 'Source fournisseur'));
    before.appendChild(text(doc, 'div', 'kmc-catalog-compare-title', row.name_source || '—'));
    if (row.description_source) before.appendChild(text(doc, 'p', '', row.description_source));
    grid.appendChild(before);

    if (prepared) {
      const after = doc.createElement('div');
      after.className = 'kmc-catalog-compare-pane';
      after.appendChild(text(doc, 'strong', '', 'Après · français'));
      after.appendChild(text(doc, 'div', 'kmc-catalog-compare-title', row.name || '—'));
      if (row.description) after.appendChild(text(doc, 'p', '', row.description));
      grid.appendChild(after);
    }

    dialog.appendChild(grid);
    overlay.appendChild(dialog);
    overlay.addEventListener('click', event => {
      if (event.target === overlay) closeCatalogCompare(context);
    });
    dialog.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeCatalogCompare(context);
    });
    context.root.appendChild(overlay);
    if (typeof close.focus === 'function') close.focus();
    return overlay;
  }

  function appendBeforeAfter(context, cell, row = {}) {
    const doc = context.document;
    const hasSource = Boolean(row.name_source || row.description_source);
    const prepared = row.content_source === 'ai_enriched' || row.content_source === 'manual';
    if (!hasSource) return;

    const compare = doc.createElement('div');
    compare.className = 'kmc-catalog-compare';

    const toggle = text(
      doc,
      'button',
      'kmc-catalog-compare-toggle',
      prepared ? 'Avant / après' : 'Voir source fournisseur'
    );
    toggle.type = 'button';
    toggle.setAttribute('data-catalog-compare-toggle', '');
    toggle.addEventListener('click', () => openCatalogCompare(context, row));

    compare.appendChild(toggle);
    cell.appendChild(compare);
  }

  function frenchAssistantPrompt(row = {}) {
    return [
      'Prépare cette fiche produit Komerce en français.',
      'Conserve strictement le sens fournisseur, sans inventer de caractéristiques.',
      'Réponds uniquement avec deux lignes :',
      'Titre FR: ...',
      'Description FR: ...',
      '',
      `Référence: ${row.product_ref || '—'}`,
      `Catégorie: ${row.category || '—'}`,
      `Titre fournisseur: ${row.name_source || row.name || '—'}`,
      `Description fournisseur: ${row.description_source || '—'}`,
    ].join('\n');
  }

  function parseFrenchAssistantOutput(value) {
    const raw = String(value || '')
      .replace(/\r\n?/g, '\n')
      .replace(/\*\*/g, '')
      .replace(/^\s*[-*]\s+/gm, '')
      .trim();
    if (!raw) return { name: '', description: '' };

    const titleMatch = raw.match(/(?:^|\n)\s*Titre\s*FR\s*:\s*(.+?)(?=\n|$)/i);
    const descriptionMatch = raw.match(/(?:^|\n)\s*Description\s*FR\s*:\s*([\s\S]+)$/i);
    return {
      name: titleMatch ? titleMatch[1].trim() : '',
      description: descriptionMatch ? descriptionMatch[1].trim() : '',
    };
  }

  async function copyForAssistant(context, row = {}) {
    const prompt = frenchAssistantPrompt(row);
    const clipboard = typeof navigator !== 'undefined' && navigator.clipboard;
    if (!clipboard || typeof clipboard.writeText !== 'function') {
      setFeedback(context.root, 'Presse-papiers indisponible : ouvrez l’éditeur FR pour afficher le prompt.', 'critical');
      return false;
    }
    await clipboard.writeText(prompt);
    setFeedback(context.root, `${row.product_ref} · prompt copié pour ChatGPT. Aucun appel API depuis Komerce.`, 'positive');
    return true;
  }

  function editorField(doc, labelText, name, multiline = false) {
    const wrap = doc.createElement('label');
    wrap.className = 'kmc-catalog-fr-field';
    wrap.appendChild(text(doc, 'span', 'kmc-catalog-fr-label', labelText));
    const control = doc.createElement(multiline ? 'textarea' : 'input');
    if (!multiline) control.type = 'text';
    control.name = name;
    control.setAttribute('data-catalog-fr-field', name);
    if (multiline) control.rows = 8;
    wrap.appendChild(control);
    return { wrap, control };
  }

  function setEditorFeedback(node, message, tone = 'neutral') {
    if (!node) return;
    node.className = `kmc-catalog-fr-status is-${tone}`;
    node.textContent = message || '';
  }

  function sourceLanguageTag(row = {}) {
    const locale = String(row.source_locale || '').trim().toLowerCase().replace(/_/g, '-');
    return locale ? locale.split('-')[0] : null;
  }

  function primedFrenchTranslatorEntry(row = {}) {
    const sourceLanguage = sourceLanguageTag(row);
    const entry = typeof globalThis !== 'undefined'
      ? globalThis[CATALOG_FR_TRANSLATOR_CACHE_KEY]
      : null;
    if (!sourceLanguage || !entry || !entry.promise) return null;
    if (entry.sourceLanguage !== sourceLanguage || entry.targetLanguage !== 'fr') return null;
    return entry;
  }

  function hasPrimedFrenchTranslator(row = {}) {
    return Boolean(primedFrenchTranslatorEntry(row));
  }

  async function translateFrenchValues(row, translator) {
    const sourceTitle = String(row.name_source || row.name || '').trim();
    const sourceDescription = String(row.description_source || '').trim();
    const [translatedTitle, translatedDescription] = await Promise.all([
      sourceTitle ? translator.translate(sourceTitle) : Promise.resolve(''),
      sourceDescription ? translator.translate(sourceDescription) : Promise.resolve(''),
    ]);
    return {
      name: String(translatedTitle || '').trim(),
      description: String(translatedDescription || '').trim(),
    };
  }

  async function autoTranslateFrench(row, nameControl, descriptionControl, statusNode) {
    const translatorApi = typeof globalThis !== 'undefined' ? globalThis.Translator : null;
    const sourceLanguage = sourceLanguageTag(row);
    const primed = primedFrenchTranslatorEntry(row);
    if ((!primed && (!translatorApi || typeof translatorApi.create !== 'function')) || !sourceLanguage) {
      setEditorFeedback(
        statusNode,
        'Traduction locale indisponible sur ce navigateur. Utilisez « Copier pour ChatGPT » puis « Coller la réponse ».',
        'warning'
      );
      return false;
    }

    let translator = null;
    let ownsTranslator = false;
    try {
      setEditorFeedback(statusNode, 'Préparation française automatique dans le navigateur…');
      if (primed) {
        translator = await primed.promise;
      } else {
        translator = await translatorApi.create({
          sourceLanguage,
          targetLanguage: 'fr',
          monitor(monitor) {
            if (!monitor || typeof monitor.addEventListener !== 'function') return;
            monitor.addEventListener('downloadprogress', event => {
              const loaded = Math.max(0, Math.min(1, Number(event && event.loaded) || 0));
              setEditorFeedback(statusNode, `Préparation du traducteur local · ${Math.round(loaded * 100)} %`);
            });
          },
        });
        ownsTranslator = true;
      }
      if (!translator || typeof translator.translate !== 'function') throw new Error('translator_unavailable');

      const translated = await translateFrenchValues(row, translator);
      if (translated.name) nameControl.value = translated.name;
      if (translated.description) descriptionControl.value = translated.description;

      if (!translated.name || !translated.description) {
        setEditorFeedback(
          statusNode,
          'Préparation locale partielle : complétez les champs manquants ou utilisez ChatGPT, puis relisez avant d’enregistrer.',
          'warning'
        );
        return false;
      }

      setEditorFeedback(
        statusNode,
        'Préparation FR générée localement, sans API payante Komerce. Relisez puis enregistrez.',
        'positive'
      );
      return true;
    } catch (error) {
      setEditorFeedback(
        statusNode,
        'Traduction locale indisponible. Utilisez « Copier pour ChatGPT » puis « Coller la réponse ».',
        'warning'
      );
      return false;
    } finally {
      if (ownsTranslator && translator && typeof translator.destroy === 'function') translator.destroy();
    }
  }

  async function autoPrepareFrenchQueue(context, payload = {}) {
    const rows = Array.isArray(payload.approval) ? payload.approval : [];
    const candidates = rows.filter(row => (
      needsFrenchPreparation(row)
      && !context.autoFrenchAttempted.has(row.product_ref)
      && hasPrimedFrenchTranslator(row)
    ));
    if (!candidates.length) return { attempted: 0, prepared: 0, failed: 0 };

    let prepared = 0;
    let failed = 0;
    for (const row of candidates) {
      context.autoFrenchAttempted.add(row.product_ref);
      try {
        const entry = primedFrenchTranslatorEntry(row);
        const translator = entry ? await entry.promise : null;
        if (!translator || typeof translator.translate !== 'function') throw new Error('translator_unavailable');
        const translated = await translateFrenchValues(row, translator);
        if (!translated.name || !translated.description) throw new Error('translation_incomplete');

        await jsonRequest(
          context.fetch,
          `${ENDPOINT}/approval/${encodeURIComponent(row.product_ref)}/prepare-fr`,
          {
            method: 'POST',
            body: {
              name: translated.name,
              description: translated.description,
              reason: 'Préparation FR automatique locale au navigateur — zéro API IA payante',
            },
          }
        );
        context.autoFrenchFailed.delete(row.product_ref);
        prepared += 1;
      } catch (_) {
        context.autoFrenchFailed.add(row.product_ref);
        failed += 1;
      }
    }

    await context.reload({ skipAutoFrenchSchedule: true });
    if (prepared) {
      setFeedback(
        context.root,
        `${prepared} fiche(s) préparée(s) automatiquement en français · relecture humaine requise avant validation.`,
        failed ? 'warning' : 'positive'
      );
    } else if (failed) {
      setFeedback(
        context.root,
        'Préparation FR automatique indisponible pour cette fiche. Le bouton de secours reste disponible.',
        'warning'
      );
    }
    return { attempted: candidates.length, prepared, failed };
  }

  function scheduleAutoFrenchPreparation(context, payload = {}) {
    // Le moteur Raffinerie prépare en amont ; aucune mutation lors de l'ouverture d'un écran.
    if (context.workspaceView !== 'refinery') return false;
    if (context.autoFrenchRunning) return false;
    const rows = Array.isArray(payload.approval) ? payload.approval : [];
    const eligible = rows.some(row => (
      needsFrenchPreparation(row)
      && !context.autoFrenchAttempted.has(row.product_ref)
      && hasPrimedFrenchTranslator(row)
    ));
    if (!eligible) return false;

    context.autoFrenchRunning = true;
    Promise.resolve()
      .then(() => autoPrepareFrenchQueue(context, payload))
      .catch(() => null)
      .finally(() => {
        context.autoFrenchRunning = false;
      });
    return true;
  }

  function resumeAutoFrenchPreparation() {
    if (!activeContext || !activePayload) return false;
    return scheduleAutoFrenchPreparation(activeContext, activePayload);
  }

  function closeFrenchEditor(context, triggerButton) {
    const editor = context.root.querySelector('[data-catalog-fr-editor]');
    if (editor && typeof editor.remove === 'function') editor.remove();
    if (triggerButton && typeof triggerButton.focus === 'function') triggerButton.focus();
  }

  async function openFrenchEditor(context, row = {}, triggerButton = null) {
    closeFrenchEditor(context);
    const activeRecheck = row.lifecycle_status === 'active' && row.is_active === true;
    const doc = context.document;
    const overlay = doc.createElement('div');
    overlay.className = 'kmc-catalog-fr-editor';
    overlay.setAttribute('data-catalog-fr-editor', '');
    overlay.setAttribute('role', 'presentation');

    const dialog = doc.createElement('section');
    dialog.className = 'kmc-catalog-fr-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', `Préparation française · ${row.product_ref || 'produit'}`);

    const heading = doc.createElement('header');
    heading.className = 'kmc-catalog-fr-heading';
    const headingCopy = doc.createElement('div');
    headingCopy.appendChild(text(doc, 'span', 'kmc-workspace-kicker', 'PRÉPARATION FR'));
    headingCopy.appendChild(text(doc, 'h2', 'kmc-catalog-fr-title', row.product_ref || 'Produit'));
    headingCopy.appendChild(text(
      doc,
      'p',
      'kmc-workspace-subtitle',
      activeRecheck
        ? 'Corrigez ici le français du produit déjà actif. La source fournisseur reste intacte ; prix, stock et marchés ne sont pas modifiés.'
        : 'Complétez ici le titre et la description en français. Les modifications sont tracées et vérifiées avant validation Catalogue.'
    ));
    heading.appendChild(headingCopy);
    const close = makeButton(doc, 'Fermer', 'close-fr-editor', true);
    close.addEventListener('click', () => closeFrenchEditor(context, triggerButton));
    heading.appendChild(close);
    dialog.appendChild(heading);

    const grid = doc.createElement('div');
    grid.className = 'kmc-catalog-fr-editor-grid';

    const sourcePane = doc.createElement('section');
    sourcePane.className = 'kmc-catalog-fr-editor-pane is-source';
    sourcePane.appendChild(text(doc, 'strong', 'kmc-catalog-fr-pane-title', 'Source fournisseur'));
    sourcePane.appendChild(text(doc, 'div', 'kmc-catalog-fr-source-title', row.name_source || row.name || '—'));
    sourcePane.appendChild(text(doc, 'p', 'kmc-catalog-fr-source-description', row.description_source || 'Aucune description fournisseur.'));
    const sourceTextDetails = doc.createElement('details');
    sourceTextDetails.className = 'kmc-catalog-complementary';
    sourceTextDetails.appendChild(text(doc, 'summary', '', 'Texte fournisseur · Informations complémentaires'));
    sourceTextDetails.appendChild(sourcePane);
    grid.appendChild(sourceTextDetails);

    const frenchPane = doc.createElement('section');
    frenchPane.className = 'kmc-catalog-fr-editor-pane is-french';
    frenchPane.appendChild(text(doc, 'strong', 'kmc-catalog-fr-pane-title', 'Français'));

    const assistantActions = doc.createElement('div');
    assistantActions.className = 'kmc-catalog-fr-assistant-actions';
    const copy = makeButton(doc, 'Copier pour ChatGPT', 'copy-fr-editor', true);
    assistantActions.appendChild(copy);
    const paste = makeButton(doc, 'Coller la réponse', 'paste-fr-editor', true);
    assistantActions.appendChild(paste);
    const editorialHelp = doc.createElement('details');
    editorialHelp.className = 'kmc-catalog-complementary';
    editorialHelp.appendChild(text(doc, 'summary', '', 'Aide à la rédaction (facultatif)'));
    editorialHelp.appendChild(assistantActions);
    frenchPane.appendChild(editorialHelp);

    const nameField = editorField(doc, 'Titre français', 'name');
    const descriptionField = editorField(doc, activeRecheck
      ? 'Description française (facultative)' : 'Description française', 'description', true);
    if (row.name_override_present || row.content_source === 'manual' || isFrenchLocale(row.source_locale)) {
      nameField.control.value = row.name || '';
      descriptionField.control.value = row.description || '';
    }
    frenchPane.appendChild(nameField.wrap);
    frenchPane.appendChild(descriptionField.wrap);

    const promptDetails = doc.createElement('details');
    promptDetails.className = 'kmc-catalog-fr-prompt-details';
    const promptSummary = doc.createElement('summary');
    promptSummary.textContent = 'Voir le prompt ChatGPT';
    promptDetails.appendChild(promptSummary);
    const promptPreview = doc.createElement('textarea');
    promptPreview.className = 'kmc-catalog-fr-prompt';
    promptPreview.readOnly = true;
    promptPreview.rows = 8;
    promptPreview.value = frenchAssistantPrompt(row);
    promptDetails.appendChild(promptPreview);
    frenchPane.appendChild(promptDetails);

    const status = text(doc, 'div', 'kmc-catalog-fr-status is-neutral', '');
    status.setAttribute('role', 'status');
    frenchPane.appendChild(status);

    // La traduction locale ne peut pas créer une description absente de la
    // source. Ne jamais assimiler un seul titre traduit à une fiche complète.
    if (!String(row.description_source || '').trim() && !String(row.description || '').trim()) {
      const missingSource = text(doc, 'p', 'kmc-catalog-fr-source-warning',
        'Aucune description fournisseur disponible : la traduction automatique ne peut pas la compléter. Rédigez une description factuelle en français, vérifiée sur le produit, avant d’enregistrer.');
      missingSource.setAttribute('data-fr-missing-source', '');
      frenchPane.appendChild(missingSource);
    }

    copy.addEventListener('click', async () => {
      try {
        const copied = await copyForAssistant(context, row);
        setEditorFeedback(
          status,
          copied ? 'Prompt copié. Revenez ici avec la réponse ChatGPT.' : 'Copiez le prompt affiché ci-dessous.',
          copied ? 'positive' : 'warning'
        );
      } catch (error) {
        setEditorFeedback(status, error.message || 'Copie impossible.', 'critical');
      }
    });

    paste.addEventListener('click', async () => {
      const clipboard = typeof navigator !== 'undefined' && navigator.clipboard;
      if (!clipboard || typeof clipboard.readText !== 'function') {
        setEditorFeedback(status, 'Lecture du presse-papiers indisponible. Collez directement dans les champs.', 'warning');
        return;
      }
      try {
        const parsed = parseFrenchAssistantOutput(await clipboard.readText());
        if (!parsed.name || !parsed.description) {
          setEditorFeedback(status, 'Réponse non reconnue. Format attendu : « Titre FR: … » puis « Description FR: … ».', 'critical');
          return;
        }
        nameField.control.value = parsed.name;
        descriptionField.control.value = parsed.description;
        setEditorFeedback(status, 'Titre et description récupérés. Enregistrement automatique…', 'positive');
        void autosaveFrench();
      } catch (error) {
        setEditorFeedback(status, error.message || 'Lecture du presse-papiers impossible.', 'critical');
      }
    });

    grid.appendChild(frenchPane);
    dialog.appendChild(grid);

    const footer = doc.createElement('footer');
    footer.className = 'kmc-catalog-fr-footer';
    const footerNotice = text(doc, 'p', 'kmc-catalog-fr-footer-notice', '');
    footerNotice.setAttribute('role', 'alert');
    footerNotice.setAttribute('data-fr-save-feedback', '');
    footer.appendChild(footerNotice);
    const actions = doc.createElement('div');
    actions.className = 'kmc-catalog-fr-footer-buttons';
    const cancel = makeButton(doc, 'Annuler', 'cancel-fr-editor', true);
    cancel.addEventListener('click', () => closeFrenchEditor(context, triggerButton));
    actions.appendChild(cancel);
    const save = makeButton(doc, activeRecheck ? 'Enregistrer le brouillon' : 'Enregistrer la préparation FR', 'save-fr-editor', activeRecheck);
    // Les changements sont sauvegardés au changement de champ ; bouton historique masqué.
    save.hidden = true;
    const showSaveProblem = (message, control) => {
      footerNotice.className = 'kmc-catalog-fr-footer-notice is-critical';
      footerNotice.textContent = message;
      setEditorFeedback(status, message, 'critical');
      if (control) {
        control.setAttribute('aria-invalid', 'true');
        if (typeof control.focus === 'function') control.focus();
      }
    };
    [nameField.control, descriptionField.control].forEach(control => {
      control.addEventListener('input', () => {
        control.removeAttribute('aria-invalid');
        footerNotice.className = 'kmc-catalog-fr-footer-notice';
        footerNotice.textContent = activeRecheck
          ? 'Description facultative : enregistrement automatique dès que vous quittez le champ.'
          : 'Enregistrement automatique dès que les champs requis sont remplis.';
      });
    });
    const submitFrench = async (accept = false, finalize = false) => {
      const name = String(nameField.control.value || '').trim();
      const description = String(descriptionField.control.value || '').trim();
      if (!name || (!activeRecheck && !description)) {
        showSaveProblem(
          !name
            ? 'Le titre français est obligatoire.'
            : 'La description française est obligatoire pour ce candidat.',
          !name ? nameField.control : descriptionField.control
        );
        return;
      }
      footerNotice.className = 'kmc-catalog-fr-footer-notice';
      footerNotice.textContent = accept
        ? 'Validation de suffisance éditoriale en cours…'
        : 'Enregistrement du brouillon en cours…';
      setEditorFeedback(status, footerNotice.textContent);
      if (activeRecheck) {
        save.disabled = true;
        if (validate) validate.disabled = true;
        try {
          const result = await jsonRequest(context.fetch,
            `${ENDPOINT}/refinery/${encodeURIComponent(row.product_ref)}/prepare-fr`, {
              method: 'POST',
              body: { name, description, decision: accept ? 'accept' : 'draft' },
            });
          if (!result?.ok) throw new Error('Réponse inattendue lors de la préparation FR.');
          closeFrenchEditor(context, triggerButton);
          await context.reload({ skipAutoFrenchSchedule: true });
          setFeedback(context.root, accept
            ? `${row.product_ref} : contenu français accepté comme suffisant par l’opérateur. Autres contrôles et règles de marchés inchangés.`
            : `${row.product_ref} : brouillon français enregistré. Les contrôles Catalogue restent à effectuer.`, 'positive');
        } catch (error) {
          showSaveProblem(actionErrorMessage(error), null);
          save.disabled = false;
          if (validate) validate.disabled = false;
        }
        return;
      }
      await runAction(context, save, {
        url: `${ENDPOINT}/approval/${encodeURIComponent(row.product_ref)}/prepare-fr`,
        body: {
          name,
          description,
          reason: 'Préparation FR manuelle/assistée hors runtime',
        },
        runningMessage: 'Enregistrement de la préparation française…',
        successMessage: `${row.product_ref} : français enregistré automatiquement sans API IA payante. Les autres contrôles restent actifs.`,
        afterSuccess: finalize ? () => finishCatalogueAfterCorrection(context, row) : null,
      });
    };
    save.addEventListener('click', () => submitFrench(false));
    // Sauvegarde à la sortie d'un champ (pas à chaque frappe). L'autorité
    // serveur valide la mutation ; une erreur laisse les champs éditables.
    let autoSaving = false;
    const autosaveFrench = async () => {
      if (autoSaving || (typeof dialog.isConnected === 'boolean' && !dialog.isConnected)) return;
      const name = String(nameField.control.value || '').trim();
      const description = String(descriptionField.control.value || '').trim();
      if (!name || (!activeRecheck && !description)) {
        setEditorFeedback(status, 'Complétez les champs requis ; la sauvegarde se fera automatiquement.', 'warning');
        return;
      }
      autoSaving = true;
      nameField.control.disabled = true;
      descriptionField.control.disabled = true;
      try {
        // Sur une fiche déjà active, une correction éditoriale vaut décision
        // de suffisance du contenu modifié, enregistrée par le writer canonique.
        await submitFrench(activeRecheck, true);
      } finally {
        autoSaving = false;
        nameField.control.disabled = false;
        descriptionField.control.disabled = false;
      }
    };
    nameField.control.addEventListener('change', () => autosaveFrench());
    descriptionField.control.addEventListener('change', () => autosaveFrench());
    const validate = activeRecheck
      ? makeButton(doc, 'Valider le contenu actuel', 'validate-fr-sufficient') : null;
    if (validate) {
      validate.hidden = true;
      validate.title = 'Décision humaine : le contenu français actuel suffit, même sans description.';
      validate.addEventListener('click', () => submitFrench(true));
    }
    actions.appendChild(save);
    if (validate) actions.appendChild(validate);
    footer.appendChild(actions);
    dialog.appendChild(footer);

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) closeFrenchEditor(context, triggerButton);
    });
    dialog.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeFrenchEditor(context, triggerButton);
    });

    overlay.appendChild(dialog);
    context.root.appendChild(overlay);
    if (typeof nameField.control.focus === 'function') nameField.control.focus();
    await autoTranslateFrench(row, nameField.control, descriptionField.control, status);
    // Le message reste près de la commande d'enregistrement, même lorsque
    // les champs et la traduction locale sont plus haut dans la fenêtre.
    if (!String(nameField.control.value || '').trim()) {
      footerNotice.textContent = 'Renseignez le titre français avant d’enregistrer.';
    } else if (activeRecheck) {
      footerNotice.textContent = 'Description facultative : enregistrer un brouillon ou valider que le contenu actuel suffit.';
    } else if (!String(descriptionField.control.value || '').trim()) {
      footerNotice.textContent = 'Description française à compléter pour ce candidat.';
    }
    return overlay;
  }

  // Chaîne de curation : visuel seul. Les compteurs décrivent les lignes affichées (aucun filtre, aucune donnée nouvelle).
  function renderCurationChain(doc, rows, page) {
    const counts = { fr: 0, price: 0, ready: 0 };
    rows.forEach(row => {
      if (needsFrenchPreparation(row)) counts.fr += 1;
      else if (!hasPublishablePrice(row)) counts.price += 1;
      else counts.ready += 1;
    });
    const stages = [
      { key: 'fr', icon: '✎', label: 'FR à préparer', count: counts.fr, tone: 'warn' },
      { key: 'price', icon: '€', label: 'Prix à définir', count: counts.price, tone: 'warn' },
      { key: 'ready', icon: '✓', label: 'Prêt à valider', count: counts.ready, tone: 'ok' },
    ];
    const firstWork = stages.findIndex(stage => stage.count > 0);
    const chain = doc.createElement('ol');
    chain.className = 'kmc-catalog-chain';
    chain.setAttribute('aria-label', 'Parcours de curation');
    stages.forEach((stage, index) => {
      const state = index === firstWork ? 'current' : (stage.count > 0 ? 'done' : 'pending');
      const item = doc.createElement('li');
      item.className = `kmc-catalog-chain-stage is-${state} is-${stage.tone}`;
      if (state === 'current') item.setAttribute('aria-current', 'step');
      item.setAttribute('data-chain-stage', stage.key);
      item.appendChild(text(doc, 'span', 'kmc-catalog-chain-icon', stage.icon));
      item.appendChild(text(doc, 'strong', 'kmc-catalog-chain-label', stage.label));
      item.appendChild(text(doc, 'span', 'kmc-catalog-chain-count', formatNumber(stage.count)));
      chain.appendChild(item);
    });
    const shown = rows.length;
    const total = Number(page && page.total) || shown;
    if (total > shown) chain.setAttribute('data-chain-scope', `Compteurs sur les ${shown} lignes affichées`);
    return chain;
  }

  const PARAMETER_STATUS_LABELS = {
    documented: 'Documenté',
    operator_set: 'Saisi, source non vérifiée',
    default_unvalidated: 'Valeur par défaut non validée',
    divergent: 'Deux valeurs concurrentes',
    missing: 'Absent',
  };

  function renderPricingParameters(slot, doc, payload) {
    const params = payload && payload.pricing_parameters;
    if (!params || !Array.isArray(params.items)) return;
    const flagged = params.items.filter(i => i.status !== 'documented' && i.status !== 'operator_set');
    const box = doc.createElement('div');
    box.className = 'kmc-workspace-notice';
    box.setAttribute('data-pricing-parameters', flagged.length ? 'attention' : 'ok');
    if (params.unavailable) {
      box.appendChild(text(doc, 'strong', '', 'Paramètres économiques non vérifiables pour le moment.'));
      slot.appendChild(box);
      return;
    }
    if (!flagged.length) return;
    box.appendChild(text(doc, 'strong', '', 'Paramètres économiques à valider avant de s’y fier'));
    box.appendChild(text(doc, 'p', 'kmc-workspace-subtitle', 'Ces valeurs permettent une simulation, pas un prix publié ni un coût réel tant qu’elles ne sont pas validées.'));
    flagged.forEach(item => {
      const line = doc.createElement('div');
      line.className = 'kmc-param-line';
      line.setAttribute('data-parameter-key', item.key);
      line.appendChild(text(doc, 'strong', '', `${item.label} · ${PARAMETER_STATUS_LABELS[item.status] || item.status}`));
      line.appendChild(text(doc, 'small', 'kmc-workspace-subtitle', `Provenance : ${item.provenance} Usage : ${item.usage} Conséquence : ${item.consequence}`));
      if (item.config && item.config.href) {
        const link = text(doc, 'a', 'kmc-workspace-action', `Configurer (${item.config.role}) · ${item.config.label}`);
        link.href = item.config.href;
        line.appendChild(link);
      }
      box.appendChild(line);
    });
    slot.appendChild(box);
  }

  // La Raffinerie est une vue de suivi technique, jamais une seconde
  // file humaine de validation. Les mutations backend restent sous leurs owners.
  function renderRefineryMonitoring(rootNode, ui, doc, payload) {
    const slot = createSection(rootNode, ui, 'Préparation automatique',
      'La Raffinerie prépare les fiches et trace leur traitement. Les anomalies produit se corrigent dans le Catalogue global.');
    if (slot.parentNode) slot.parentNode.className += ' kmc-refinery-main-panel';
    const coverage = payload.refinery?.coverage;
    if (!coverage) {
      slot.appendChild(text(doc, 'p', 'kmc-refinery-warning',
        'Suivi momentanément indisponible. Consultez le Cockpit des imports pour les passages fournisseur.'));
      return;
    }
    const overview = doc.createElement('div');
    overview.className = 'kmc-refinery-coverage kmc-refinery-monitoring';
    const metrics = [
      ['Brouillons suivis', Number(coverage.in_approval_queue || 0) +
        Number(coverage.unprepared_candidates || 0),
        'Préparation et contrôles techniques, sans validation demandée ici'],
      ['Remises historiques actives', Number(coverage.handoff_already_active || 0),
        'Indicateur historique, sans présumer la publication sur un marché'],
    ];
    metrics.forEach(([label, value, hint]) => {
      const tile = doc.createElement('div');
      tile.className = 'kmc-refinery-count';
      tile.appendChild(text(doc, 'strong', 'kmc-refinery-count-value', formatNumber(value)));
      tile.appendChild(text(doc, 'span', 'kmc-refinery-count-label', label));
      tile.appendChild(text(doc, 'small', 'kmc-refinery-count-hint', hint));
      overview.appendChild(tile);
    });
    slot.appendChild(overview);
    slot.appendChild(text(doc, 'p', 'kmc-workspace-subtitle',
      'Aucune correction, classification ou approbation humaine n’est demandée dans la Raffinerie.'));
    const actions = doc.createElement('div');
    actions.className = 'kmc-workspace-section-actions';
    const catalog = text(doc, 'a', 'kmc-workspace-action', 'Ouvrir les fiches dans le Catalogue');
    catalog.href = '/admin/workspaces/catalog';
    actions.appendChild(catalog);
    const cockpit = text(doc, 'a', 'kmc-workspace-nav-link', 'Suivre les passages fournisseur');
    cockpit.href = '/admin/import-runtime';
    actions.appendChild(cockpit);
    slot.appendChild(actions);
  }

  // Catalogue = registre des fiches remises, pas uniquement assortiment vendable.
  // Les corrections utilisent l'autorité de leur domaine, jamais un champ status éditable.

  function registryNextStep(row) {
    if (row.record_kind === 'candidate') {
      if (row.work_status === 'sourcing_category_review')
        return { kind: 'inspect', label: 'Corriger catégorie',
          status: 'Catégorie économique manquante' };
      if (row.work_status === 'sourcing_deferred')
        return { kind: 'inspect', label: 'Suivre', status: 'Surveillance Sourcing · différé' };
      if (row.operator_group === 'processing')
        return { kind: 'inspect', label: 'Suivre', status: 'Préparation automatique' };
      if (row.operator_group === 'excluded')
        return { kind: 'inspect', label: 'Examiner', status: 'Écarté / archivé' };
      if (row.work_status === 'handoff_missing')
        return { kind: 'inspect', label: 'Signaler', status: 'Lien produit absent' };
      return { kind: 'inspect', label: 'Examiner', status: 'À examiner' };
    }
    const issues = Array.isArray(row.issues) ? row.issues : [];
    if (row.work_status === 'activation_to_reconcile') {
      return { kind: 'diagnose', label: 'Réconcilier l’état',
        status: 'Activation à réconcilier' };
    }
    if (row.lifecycle_status === 'rejected' || row.work_status === 'rejected') {
      return { kind: 'detail', label: 'Examiner le rejet', status: 'Écarté · revoir' };
    }
    if (issues.includes('source_to_normalize') || row.work_status === 'source_to_normalize') {
      return row.candidate_ref
        ? { kind: 'source', label: 'Vérifier la source', status: 'Source à vérifier' }
        : { kind: 'detail', label: 'Examiner la source', status: 'Source à vérifier' };
    }
    if (issues.includes('taxonomy_to_confirm') || row.work_status === 'taxonomy_to_confirm') {
      return { kind: 'classify', label: 'Classer', status: 'À classer' };
    }
    if (issues.includes('editorial_to_complete') || row.work_status === 'editorial_to_complete') {
      return row.lifecycle_status === 'candidate'
        ? { kind: 'refinery', label: 'Compléter la fiche FR', status: 'Fiche FR à compléter' }
        : { kind: 'detail', label: 'Examiner la fiche FR', status: 'Fiche FR à vérifier' };
    }
    if (issues.includes('media_missing') || row.work_status === 'media_to_complete')
      return { kind: 'diagnose', label: 'Examiner les médias', status: 'Médias à vérifier' };
    if (row.work_status === 'approval_unproven')
      return { kind: 'diagnose', label: 'Vérifier approbation', status: 'Preuve à réconcilier' };
    if (row.lifecycle_status === 'candidate' || row.work_status === 'approval_pending') {
      return { kind: 'approve', label: 'Contrôler et valider', status: 'Validation Catalogue requise' };
    }
    if (row.work_status === 'catalog_approved' && row.is_active === true) {
      return { kind: 'markets', label: 'Décisions marchés', status: 'Approuvé Catalogue' };
    }
    if (row.work_status === 'catalog_approved_inactive')
      return { kind: 'detail', label: 'Voir fiche', status: 'Conforme · désactivé' };
    if (row.work_status === 'approval_to_review')
      return { kind: 'detail', label: 'Voir la preuve', status: 'Approbation à régulariser' };
    return { kind: 'detail', label: 'Voir fiche', status: 'Fiche à consulter' };
  }

  function renderCatalogTabs(rootNode, doc, context) {
    const nav = doc.createElement('nav');
    nav.className = 'kmc-catalog-tabs';
    nav.setAttribute('aria-label', 'Rubriques du Catalogue');
    [['registry', 'Registre produits'], ['assortment', 'Assortiment approuvé'],
      ['taxonomy', 'Taxonomie boutique']].forEach(([tab, label]) => {
      const a = text(doc, 'a', 'kmc-catalog-tab', label);
      a.href = tab === 'registry' ? '/admin/workspaces/catalog' : '/admin/workspaces/catalog?tab=' + tab;
      if (tab === context.catalogTab) a.setAttribute('aria-current', 'page');
      nav.appendChild(a);
    });
    rootNode.appendChild(nav);
  }

  function registryMetricItems(payload) {
    const rows = Array.isArray(payload.products) ? payload.products : [];
    const count = code => rows.filter(row =>
      (row.issues || []).includes(code) || row.work_status === code).length;
    const flagged = rows.filter(row => (row.issues || []).length ||
      ['inactive', 'rejected', 'sourcing_review'].includes(row.work_status) ||
      (row.record_kind === 'candidate' && row.operator_group === 'review')).length;
    return [
      { key: 'registry', label: 'Produits connus · filtre', value: formatNumber(payload.registry_page?.total || 0), tone: 'neutral' },
      { key: 'review', label: 'À traiter · page', value: formatNumber(flagged), tone: flagged ? 'warning' : 'neutral' },
      { key: 'classify', label: 'À classer · page', value: formatNumber(count('taxonomy_to_confirm')), tone: 'neutral' },
      { key: 'french', label: 'Fiche FR · page', value: formatNumber(count('editorial_to_complete')), tone: 'neutral' },
      { key: 'approval', label: 'À valider · page', value: formatNumber(count('approval_pending')), tone: 'neutral' },
      { key: 'approved', label: 'Approuvés · page', value: formatNumber(count('catalog_approved')), tone: 'neutral' },
    ];
  }


  // Suggestion déterministe et prudente : jamais de taxonomie inventée.
  function suggestBoutiquePair(row = {}, categories = []) {
    const active = (Array.isArray(categories) ? categories : [])
      .filter(cat => cat && cat.is_active === true)
      .map(cat => ({
        key: cat.key, label: cat.label || cat.key,
        children: (cat.subcategories || []).filter(sub => sub && sub.is_active === true)
          .map(sub => ({ key: sub.key, label: sub.label || sub.key })),
      }))
      .filter(cat => cat.children.length);
    const blank = { category: '', subcategory: '', basis: 'none' };
    const match = active.find(cat => cat.key === row.boutique_category_key);
    if (match) {
      const child = match.children.find(sub => sub.key === row.boutique_subcategory_key);
      if (child) return { category: match.key, subcategory: child.key, basis: 'current_pair' };
      if (match.children.length === 1) return {
        category: match.key, subcategory: match.children[0].key, basis: 'single_active_child',
      };
      return { category: match.key, subcategory: '', basis: 'current_category' };
    }
    // Correspondance stricte des segments fournisseurs, sans approximer
    // "Téléphone" = "Film protecteur" ou convertir une famille trop large.
    const canonical = str => String(str || '').normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/\s+/g, ' ');
    const fragments = String(row.supplier_category || '')
      .split(/\s*(?:>|›|»|\/)\s*/).map(canonical).filter(Boolean);
    if (!fragments.length) return blank;
    const candidates = active.flatMap(cat => cat.children
      .filter(sub => fragments.includes(canonical(sub.label)) || fragments.includes(canonical(sub.key)))
      .map(sub => ({ category: cat.key, subcategory: sub.key })));
    if (candidates.length === 1) return { ...candidates[0], basis: 'supplier_exact' };
    const parents = active.filter(cat => fragments.includes(canonical(cat.label)) ||
      fragments.includes(canonical(cat.key)));
    if (parents.length === 1) {
      const cat = parents[0];
      return { category: cat.key,
        subcategory: cat.children.length === 1 ? cat.children[0].key : '',
        basis: cat.children.length === 1 ? 'supplier_unique_child' : 'supplier_parent' };
    }
    return blank;
  }

  function openProductClassificationDialog(context, row, categories, trigger) {
    const doc = context.document;
    const active = (categories || []).filter(cat => cat.is_active &&
      (cat.subcategories || []).some(sub => sub.is_active));
    if (!active.length) {
      setFeedback(context.root, 'Aucune paire Boutique active. Vérifiez la Taxonomie boutique.', 'critical');
      return;
    }
    const previous = doc.getElementById && doc.getElementById('kmc-catalog-classification-dialog');
    if (previous && typeof previous.close === 'function') previous.close();
    else if (previous?.parentNode) previous.parentNode.removeChild(previous);

    const suggestion = suggestBoutiquePair(row, active);
    const dialog = doc.createElement('dialog');
    dialog.className = 'kmc-catalog-classification-dialog';
    dialog.id = 'kmc-catalog-classification-dialog';
    dialog.setAttribute('aria-labelledby', 'kmc-classification-title');
    dialog.setAttribute('aria-describedby', 'kmc-classification-instructions');
    const heading = doc.createElement('header');
    heading.className = 'kmc-catalog-classification-heading';
    heading.appendChild(text(doc, 'span', 'kmc-catalog-classification-eyebrow', 'CLASSIFICATION BOUTIQUE'));
    const title = text(doc, 'h2', '', 'Classer le produit');
    title.id = 'kmc-classification-title';
    heading.appendChild(title);
    heading.appendChild(text(doc, 'strong', '', row.name || row.product_ref));
    heading.appendChild(text(doc, 'small', '', row.product_ref));
    dialog.appendChild(heading);

    const source = doc.createElement('section');
    source.className = 'kmc-catalog-classification-source';
    source.appendChild(text(doc, 'span', '', 'Catégorie fournisseur (pour information)'));
    source.appendChild(text(doc, 'p', '', row.supplier_category || 'Non renseignée'));
    dialog.appendChild(source);

    const form = doc.createElement('form');
    form.className = 'kmc-catalog-classification-form';
    const instructions = text(doc, 'p', '', 'Choisissez une paire active. Ce changement ne valide ni ne publie le produit.');
    instructions.id = 'kmc-classification-instructions';
    form.appendChild(instructions);
    const note = text(doc, 'p', 'kmc-catalog-classification-suggestion', '');
    note.setAttribute('aria-live', 'polite');
    form.appendChild(note);
    const fields = doc.createElement('div');
    fields.className = 'kmc-catalog-classification-fields';
    const selectField = (label, id) => {
      const field = doc.createElement('div');
      field.className = 'kmc-catalog-classification-field';
      const caption = text(doc, 'label', '', label);
      caption.setAttribute('for', id);
      field.appendChild(caption);
      const input = doc.createElement('select');
      input.id = id;
      input.required = true;
      field.appendChild(input);
      fields.appendChild(field);
      return input;
    };
    const categorySelect = selectField('Catégorie boutique', 'kmc-catalog-classification-category');
    const subcategorySelect = selectField('Sous-catégorie boutique', 'kmc-catalog-classification-subcategory');
    const addOption = (select, value, label) => {
      const option = doc.createElement('option');
      option.value = value;
      option.textContent = label;
      select.appendChild(option);
    };
    addOption(categorySelect, '', 'Choisir une catégorie');
    active.forEach(cat => addOption(categorySelect, cat.key, cat.label || cat.key));
    categorySelect.value = suggestion.category;
    const message = {
      current_pair: 'Classement actuel proposé par défaut. Vous pouvez le modifier.',
      single_active_child: 'Une seule sous-catégorie active existe pour la catégorie actuelle : proposition à confirmer.',
      current_category: 'Catégorie actuelle conservée. Choisissez la sous-catégorie.',
      supplier_exact: 'Suggestion : correspondance exacte avec une sous-catégorie fournisseur. À confirmer.',
      supplier_unique_child: 'Suggestion : catégorie fournisseur reconnue, seule sous-catégorie active. À confirmer.',
      supplier_parent: 'Catégorie fournisseur reconnue. Choisissez la sous-catégorie.',
      none: 'Aucune correspondance suffisamment fiable : choisissez la classification.',
    };
    note.textContent = message[suggestion.basis] || message.none;
    const actions = doc.createElement('div');
    actions.className = 'kmc-catalog-classification-actions';
    const cancel = makeButton(doc, 'Annuler', 'cancel-classification', true);
    const save = makeButton(doc, 'Enregistrer le classement', 'save-classification');
    save.type = 'submit';
    save.hidden = true; // plus de validation en deux temps après sélection
    actions.appendChild(cancel);
    actions.appendChild(save);
    const feedback = text(doc, 'p', 'kmc-catalog-classification-feedback', '');
    feedback.setAttribute('role', 'status');
    feedback.setAttribute('aria-live', 'polite');
    const refresh = preferred => {
      subcategorySelect.replaceChildren();
      addOption(subcategorySelect, '', 'Choisir une sous-catégorie');
      const cat = active.find(c => c.key === categorySelect.value);
      const children = (cat?.subcategories || []).filter(sub => sub.is_active);
      children.forEach(sub => addOption(subcategorySelect, sub.key, sub.label || sub.key));
      // Si une seule feuille reste possible, la proposer d'emblée.
      const selected = children.some(sub => sub.key === preferred) ? preferred :
        (children.length === 1 ? children[0].key : '');
      subcategorySelect.value = selected;
      subcategorySelect.disabled = !cat;
      save.disabled = !cat || !selected;
    };
    refresh(suggestion.subcategory);
    // Une sélection complète est l'action de correction. La suggestion
    // préremplie n'est jamais appliquée silencieusement à l'ouverture.
    const autoApplySelection = () => {
      if (!categorySelect.value || !subcategorySelect.value) return;
      form.requestSubmit();
    };
    const alreadySelected = suggestion.category === row.boutique_category_key &&
      suggestion.subcategory === row.boutique_subcategory_key;
    if (suggestion.category && suggestion.subcategory && !alreadySelected) {
      const apply = makeButton(doc, 'Appliquer la proposition', 'apply-classification-suggestion');
      apply.addEventListener('click', autoApplySelection);
      actions.appendChild(apply);
    }
    categorySelect.addEventListener('change', () => {
      refresh('');
      note.textContent = 'Sélection sauvegardée automatiquement dès qu’elle est complète.';
      feedback.textContent = '';
      autoApplySelection();
    });
    subcategorySelect.addEventListener('change', () => {
      save.disabled = !categorySelect.value || !subcategorySelect.value;
      feedback.textContent = '';
      autoApplySelection();
    });
    form.appendChild(fields);
    form.appendChild(feedback);
    form.appendChild(actions);
    dialog.appendChild(form);
    const cleanup = () => {
      if (dialog.parentNode) dialog.parentNode.removeChild(dialog);
      if (trigger?.isConnected && typeof trigger.focus === 'function') trigger.focus();
    };
    const close = () => {
      if (typeof dialog.close === 'function' && dialog.open) dialog.close();
      else cleanup();
    };
    dialog.addEventListener('close', cleanup, { once: true });
    cancel.addEventListener('click', close);
    dialog.addEventListener('click', event => { if (event.target === dialog) close(); });
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const category = active.find(cat => cat.key === categorySelect.value);
      const subcategory = (category?.subcategories || []).find(sub =>
        sub.is_active && sub.key === subcategorySelect.value);
      if (!category || !subcategory) {
        feedback.textContent = 'Sélectionnez une catégorie et une sous-catégorie actives.';
        return;
      }
      const result = await runAction(context, save, {
        url: ENDPOINT + '/products/' + encodeURIComponent(row.product_ref) + '/classify',
        body: { category: category.key, subcategory: subcategory.key },
        feedbackTarget: feedback,
        successMessage: 'Classement Boutique enregistré. La fiche a été actualisée sans publication.',
        afterSuccess: () => finishCatalogueAfterCorrection(context, row),
      });
      if (result) close();
    });
    doc.body.appendChild(dialog);
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    if (typeof categorySelect.focus === 'function') categorySelect.focus();
  }




  // Une proposition de première passe ne doit jamais inventer de caractéristiques.
  // On ne connaît que les faits expressément présents dans le titre fournisseur.
  // Le traducteur natif du navigateur, s'il existe, enrichit ensuite cette ébauche.
  function catalogFrenchStarter(row = {}) {
    const source = String(row.name_source || row.supplier_name_original || row.name || '').trim();
    const descriptionSource = String(row.description_source || row.supplier_description || '').trim();
    const locale = sourceLanguageTag(row);
    if (locale === 'fr' || row.content_source === 'manual') {
      return { name: row.name || source, description: row.description || '', complete: true,
        origin: 'contenu déjà préparé' };
    }
    const title = source.replace(/\s+/g, ' ');
    const quantity = title.match(/\b(\d+)\s*(?:pcs|pieces|pi[eè]ces)\b/i);
    const count = quantity ? Number(quantity[1]) : 0;
    const units = count > 1 && count <= 20 ? ' — lot de ' + count : '';
    const models = [...new Set((title.match(/\bV\d{2,3}[A-Z0-9]*\b/gi) || [])
      .map(v => v.toUpperCase()))].slice(0,16);
    const brand = /\bvivo\b/i.test(title) ? 'Vivo'
      : /\bsamsung\b/i.test(title) ? 'Samsung'
      : /\biphone\b/i.test(title) ? 'iPhone' : '';
    const compatibility = brand + (models.length ? ' ' + models.join(', ') : '');
    if (/\b(?:hydrogel|screen protector|protective film)\b/i.test(title) &&
        /\b(?:film|screen protector|hydrogel)\b/i.test(title)) {
      const material = /hydrogel/i.test(title) ? ' hydrogel' : '';
      const privacy = /privacy|anti[\s-]*spy/i.test(title) ? ' anti-espion' : '';
      const subject = 'Film de protection d’écran' + material + privacy;
      const name = subject + (compatibility ? ' pour ' + compatibility : '') + units;
      const description = (count > 1 ? 'Lot de ' + count + ' films' : 'Film') +
        ' de protection d’écran' + material + privacy +
        (compatibility ? ' pour les téléphones ' + compatibility : '') +
        '. Compatibilité exacte à vérifier avec les références du fournisseur.';
      return {name,description,complete:true,origin:'proposition issue des références fournisseur'};
    }
    if (/\b(?:phone case|silicone case|protective cover|liquid silicone)\b/i.test(title)) {
      const material = /silicone/i.test(title) ? ' en silicone' : '';
      const name = 'Coque de protection' + material +
        (compatibility ? ' pour ' + compatibility : '') + units;
      const description = 'Coque de protection' + material +
        (compatibility ? ' adaptée aux modèles ' + compatibility : '') +
        '. Vérifier les références compatibles indiquées par le fournisseur.';
      return {name,description,complete:true,origin:'proposition issue des références fournisseur'};
    }
    // Si l'on ne peut pas traduire de manière étayée, montrer la source,
    // plutôt qu'un champ blanc ou une prétendue traduction générique.
    return {name:title,description:descriptionSource,complete:false,
      origin:'texte fournisseur affiché ; traduction française à compléter'};
  }

  // Traduction native locale, sans service payant ni écriture serveur.
  // Ne remplace jamais une correction commencée par l'opérateur.
  async function improveFrenchStarterLocally(row, nameControl, descControl, statusNode, section) {
    const api = typeof globalThis !== 'undefined' ? globalThis.Translator : null;
    const cached = primedFrenchTranslatorEntry(row);
    const language = sourceLanguageTag(row) || 'en';
    if (!cached && (!api || typeof api.create !== 'function')) return false;
    if (language === 'fr') return false;
    const initialName = nameControl.value;
    const initialDescription = descControl.value;
    const textSource = {
      ...row,
      name_source: row.name_source || row.supplier_name_original || row.name || '',
      description_source: row.description_source || row.supplier_description || '',
    };
    let translator=null;
    let owned=false;
    try {
      if (statusNode) statusNode.textContent='Amélioration de la proposition en français…';
      if(cached) translator=await cached.promise;
      else {
        translator=await api.create({sourceLanguage:language,targetLanguage:'fr'});
        owned=true;
      }
      if (!translator || typeof translator.translate !== 'function') return false;
      const translated=await translateFrenchValues(textSource, translator);
      if (typeof section.isConnected === 'boolean' && !section.isConnected) return false;
      if (nameControl.value === initialName && translated.name) nameControl.value=translated.name;
      if (descControl.value === initialDescription && translated.description) descControl.value=translated.description;
      if (statusNode) statusNode.textContent='Proposition en français à relire et corriger si nécessaire.';
      return Boolean(translated.name);
    } catch (_) {
      if (statusNode) statusNode.textContent=
        'Proposition affichée à partir du fournisseur. Relisez et corrigez si nécessaire.';
      return false;
    } finally {
      if (owned && translator && typeof translator.destroy === 'function') translator.destroy();
    }
  }

  // Correction directe des champs dans la fiche, sans écran intermédiaire.
  function renderProductQuickFields(context,doc,panel,row,categories,feedback) {
    if (!row.candidate_ref || row.lifecycle_status === 'rejected' ||
        ['activation_to_reconcile','approval_unproven'].includes(row.work_status)) return null;
    const issues = Array.isArray(row.issues) ? row.issues : [];
    const section=doc.createElement('section');
    section.className='kmc-catalog-inline-editor';
    section.setAttribute('data-catalog-inline-editor','');
    const makeField=(label,kind,tag='input')=>{
      const wrap=doc.createElement('label');
      wrap.className='kmc-catalog-inline-field';
      wrap.appendChild(text(doc,'span','',label));
      const input=doc.createElement(tag);
      if(tag==='input')input.type='text';
      if(tag==='textarea')input.rows=3;
      input.setAttribute('data-catalog-quick-field',kind);
      wrap.appendChild(input);
      return {wrap,input};
    };
    if(issues.includes('editorial_to_complete')){
      const name=makeField('Titre français','name');
      const desc=makeField('Description française','description','textarea');
      const proposal=catalogFrenchStarter(row);
      name.input.value=proposal.name;
      desc.input.value=proposal.description;
      const origin=text(doc,'p','kmc-catalog-inline-proposal-note',
        proposal.complete
          ? 'Proposition française · à relire et ajuster avant utilisation.'
          : 'Texte fournisseur prérempli · traduction française à terminer.');
      origin.setAttribute('data-catalog-french-proposal-note','');
      section.appendChild(name.wrap);
      section.appendChild(desc.wrap);
      section.appendChild(origin);
      let busy=false;
      const save=async()=>{
        if(busy||(typeof section.isConnected==='boolean'&&!section.isConnected))return;
        const nameFR=String(name.input.value||'').trim();
        const descFR=String(desc.input.value||'').trim();
        if(!nameFR||!descFR)return;
        const candidate=row.lifecycle_status==='candidate'&&row.is_active!==true;
        const active=row.lifecycle_status==='active'&&row.is_active===true;
        const url=candidate
          ? ENDPOINT+'/approval/'+encodeURIComponent(row.product_ref)+'/prepare-fr'
          : active
            ? ENDPOINT+'/refinery/'+encodeURIComponent(row.product_ref)+'/prepare-fr'
            : ENDPOINT+'/products/'+encodeURIComponent(row.product_ref)+'/update';
        const body=candidate
          ? {name:nameFR,description:descFR,reason:'Complétion Catalogue'}
          : active
            ? {name:nameFR,description:descFR,decision:'accept'}
            : {name:nameFR,description:descFR};
        busy=true;name.input.disabled=true;desc.input.disabled=true;
        feedback.textContent='Enregistrement…';
        try{
          const result=await jsonRequest(context.fetch,url,{method:'POST',body});
          if(!result?.ok)throw Error('Écriture non confirmée');
          if(candidate)await finishCatalogueAfterCorrection(context,row);
          await context.reload({skipAutoFrenchSchedule:true});
          setFeedback(context.root,'Français enregistré.','positive');
        }catch(error){
          feedback.textContent='Correction non enregistrée : '+actionErrorMessage(error);
          busy=false;name.input.disabled=false;desc.input.disabled=false;
        }
      };
      name.input.addEventListener('change',save);
      desc.input.addEventListener('change',save);
      // Une seule action pour accepter la proposition telle quelle.
      // Aucune sauvegarde automatique de texte proposé sans geste humain.
      if (proposal.complete) {
        const use=makeButton(doc,'Utiliser cette proposition','apply-catalog-fr-proposal',true);
        use.className+=' kmc-catalog-proposal-accept';
        use.addEventListener('click',save);
        section.appendChild(use);
      }
      // Si le navigateur sait traduire localement, enrichir l'ébauche sans
      // modifier le catalogue ni effacer une saisie en cours.
      if (!isFrenchLocale(row.source_locale) && row.content_source !== 'manual') {
        void improveFrenchStarterLocally(row,name.input,desc.input,origin,section);
      }
    }
    const active=(categories||[]).filter(c=>c.is_active&&
      (c.subcategories||[]).some(sub=>sub.is_active));
    if(active.length){
      const group=doc.createElement('div');
      group.className='kmc-catalog-inline-taxonomy';
      group.setAttribute('data-catalog-inline-taxonomy','');
      const catField=doc.createElement('label'),subField=doc.createElement('label');
      catField.className=subField.className='kmc-catalog-inline-field';
      catField.appendChild(text(doc,'span','','Catégorie boutique'));
      subField.appendChild(text(doc,'span','','Sous-catégorie'));
      const cat=doc.createElement('select'),sub=doc.createElement('select');
      cat.setAttribute('data-catalog-quick-category','');
      sub.setAttribute('data-catalog-quick-subcategory','');
      catField.appendChild(cat);subField.appendChild(sub);
      const option=(control,value,label)=>{
        const el=doc.createElement('option');
        el.value=value;el.textContent=label;control.appendChild(el);
      };
      option(cat,'','Choisir une catégorie');
      active.forEach(c=>option(cat,c.key,c.label||c.key));
      const suggestion=suggestBoutiquePair(row,active);
      cat.value=suggestion.category||'';
      const refresh=preferred=>{
        sub.replaceChildren();
        option(sub,'','Choisir une sous-catégorie');
        const current=active.find(c=>c.key===cat.value);
        const children=(current?.subcategories||[]).filter(c=>c.is_active);
        children.forEach(c=>option(sub,c.key,c.label||c.key));
        sub.value=children.some(c=>c.key===preferred)?preferred:
          children.length===1?children[0].key:'';
        sub.disabled=!current;
      };
      refresh(suggestion.subcategory);
      const apply=makeButton(doc,'Appliquer la proposition','apply-inline-classification-suggestion',true);
      apply.hidden=!(cat.value&&sub.value&&
        (cat.value!==row.boutique_category_key||sub.value!==row.boutique_subcategory_key));
      let busy=false;
      const save=async()=>{
        if(busy||(typeof section.isConnected==='boolean'&&!section.isConnected))return;
        const category=active.find(c=>c.key===cat.value);
        const subcategory=(category?.subcategories||[]).find(c=>c.is_active&&c.key===sub.value);
        if(!category||!subcategory)return;
        if(category.key===row.boutique_category_key&&
          subcategory.key===row.boutique_subcategory_key)return;
        busy=true;cat.disabled=sub.disabled=true;
        feedback.textContent='Enregistrement du classement…';
        try{
          const result=await jsonRequest(context.fetch,
            ENDPOINT+'/products/'+encodeURIComponent(row.product_ref)+'/classify',
            {method:'POST',body:{category:category.key,subcategory:subcategory.key}});
          if(!result?.ok)throw Error('Écriture non confirmée');
          await finishCatalogueAfterCorrection(context,row);
          await context.reload();
          setFeedback(context.root,'Classement enregistré.','positive');
        }catch(error){
          feedback.textContent='Classement non enregistré : '+actionErrorMessage(error);
          busy=false;cat.disabled=sub.disabled=false;
        }
      };
      cat.addEventListener('change',()=>{refresh('');apply.hidden=true;void save();});
      sub.addEventListener('change',()=>{apply.hidden=true;void save();});
      apply.addEventListener('click',save);
      // Liste lisible des sous-catégories de la catégorie sélectionnée.
      // Le sélecteur demeure la source unique de la décision, aucune autre page.
      const detail=doc.createElement('details');
      detail.className='kmc-catalog-subcategory-explorer';
      detail.setAttribute('data-catalog-subcategory-explorer','');
      const heading=doc.createElement('summary');
      heading.setAttribute('data-catalog-subcategory-summary','');
      const choices=doc.createElement('div');
      choices.className='kmc-catalog-subcategory-choices';
      choices.setAttribute('data-catalog-subcategory-choices','');
      detail.appendChild(heading);detail.appendChild(choices);
      const redraw=()=>{
        const current=active.find(c=>c.key===cat.value);
        const children=(current?.subcategories||[]).filter(c=>c.is_active);
        heading.textContent='Voir les '+children.length+' sous-catégories'+
          (current ? ' de '+(current.label||current.key) : '');
        choices.replaceChildren();
        children.forEach(entry=>{
          const choice=makeButton(doc,entry.label||entry.key,'choose-catalog-subcategory',true);
          choice.setAttribute('data-catalog-subcategory-option',entry.key);
          if(entry.key===sub.value)choice.className+=' is-selected';
          choice.addEventListener('click',async()=>{
            if (busy) return;
            sub.value=entry.key;
            redraw();
            await save();
          });
          choices.appendChild(choice);
        });
      };
      // Actualisation de l'explorateur en même temps que les listes natives.
      cat.addEventListener('change',redraw);
      sub.addEventListener('change',redraw);
      redraw();
      group.appendChild(catField);
      group.appendChild(subField);
      group.appendChild(detail);
      group.appendChild(apply);
      section.appendChild(group);
    }
    panel.insertBefore(section,panel.querySelector('[data-catalog-action-dock]'));
    return section;
  }

  function registryCorrectionItems(row = {}) {
    const issues = Array.isArray(row.issues) ? row.issues : [];
    if (row.lifecycle_status === 'rejected') return [{ code: 'rejected', label: 'Décision de rejet à examiner' }];
    if (['catalog_approved','catalog_approved_inactive'].includes(row.work_status)) {
      return [];
    }
    if (row.work_status === 'approval_to_review')
      return [{ code: 'approval_to_review', label: 'Preuve d’approbation Catalogue à régulariser' }];
    if (row.work_status === 'approval_pending')
      return [{ code: 'approval_pending', label: 'Prêt pour finalisation Catalogue' }];
    const known = [
      ['sourcing_economic_category_missing', 'Catégorie économique / douane à corriger'],
      ['activation_to_reconcile', 'Activation d’un candidat à justifier'],
      ['source_to_normalize', 'Source fournisseur à vérifier'],
      ['taxonomy_to_confirm', 'Classement boutique à corriger'],
      ['editorial_to_complete', 'Contenu français à compléter'],
      ['media_missing', 'Média canonique à compléter'],
      ['approval_pending', 'Validation Catalogue à réaliser'],
    ].filter(([code]) => issues.includes(code) || row.work_status === code)
      .map(([code, label]) => ({ code, label }));
    if (known.length) return known;
    return [{ code: 'check', label: 'Contrôler les prérequis de la fiche' }];
  }

  function registryReasonOwner(reason) {
    if (['decision_not_accepted', 'source_contract_v2_missing', 'supplier_name_missing',
      'supplier_product_id_missing'].includes(reason)) return 'Sourcing';
    if (['boutique_category_missing', 'boutique_subcategory_missing',
      'boutique_taxonomy_inactive_or_invalid'].includes(reason)) return 'Classement boutique';
    if (String(reason || '').startsWith('publication_guard:')) return 'Raffinerie · publication';
    if (reason === 'market_exposure_enabled') return 'Décisions marchés';
    return 'Raffinerie';
  }

  // Une ligne du Catalogue indique les corrections, pas l'état technique.
  // Les prérequis restent contrôlés par le serveur lors des mutations.
  function renderRegistryCorrections(doc, cell, row) {
    const issues = registryCorrectionItems(row)
      .filter(item => !['check','market'].includes(item.code));
    if (!issues.length) {
      cell.appendChild(text(doc, 'span', 'kmc-catalog-correction-hint', '—'));
      return null;
    }
    const list = doc.createElement('ul');
    list.className = 'kmc-catalog-corrections';
    issues.forEach(issue => {
      const item = text(doc, 'li', 'kmc-catalog-correction-item', issue.label);
      item.setAttribute('data-issue', issue.code);
      list.appendChild(item);
    });
    cell.appendChild(list);
    return null;
  }

  // The Catalogue is one operator surface; each mutation is still sent to
  // its canonical domain route, which checks its own grant and business gate.
  // Supplier originals always remain read-only.
  function inspectorFrame(slot, doc, row, mode) {
    const previous = slot.querySelector('[data-catalog-candidate-inspector]');
    if (previous) previous.remove();
    const oldProduct = slot.querySelector('[data-catalog-product-inspector]');
    if (oldProduct) oldProduct.remove();
    const panel = doc.createElement('aside');
    panel.className = 'kmc-catalog-candidate-inspector';
    panel.setAttribute(mode === 'candidate'
      ? 'data-catalog-candidate-inspector' : 'data-catalog-product-inspector',
      mode === 'candidate' ? row.candidate_ref : row.product_ref);
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', 'Correction contextuelle · ' +
      (row.product_ref || row.candidate_ref));
    const head = doc.createElement('div');
    head.className = 'kmc-catalog-inspector-head';
    head.appendChild(text(doc, 'strong', '', row.name || row.product_ref || row.candidate_ref));
    const close = makeButton(doc, 'Fermer', 'close-inspector', true);
    close.addEventListener('click', () => panel.remove());
    head.appendChild(close);
    panel.appendChild(head);
    panel.appendChild(text(doc, 'small', 'kmc-workspace-subtitle',
      'Référence : ' + (row.product_ref || row.candidate_ref) +
      (row.candidate_ref && row.product_ref ? ' · Source ' + row.candidate_ref : '')));
    const nextStep = registryNextStep(row);
    if (mode === 'candidate') panel.appendChild(text(doc, 'p', 'kmc-catalog-inspector-next-step', nextStep.status));
    // Keep all permitted corrections visible before long read-only sections.
    // This is the same Catalogue inspector; canonical mutation routes remain in charge.
    const actionDock = doc.createElement('section');
    actionDock.className = 'kmc-catalog-inspector-action-dock';
    actionDock.setAttribute('data-catalog-action-dock', '');
    // Réservé aux cas techniques exceptionnels.
    const actions = doc.createElement('div');
    actions.className = 'kmc-catalog-inspector-actions';
    actionDock.appendChild(actions);
    const feedback = text(doc, 'div', 'kmc-catalog-inspector-feedback', '');
    feedback.setAttribute('role', 'status');
    feedback.setAttribute('aria-live', 'polite');
    actionDock.appendChild(feedback);
    panel.appendChild(actionDock);
    const facts = doc.createElement('dl');
    facts.className = 'kmc-catalog-inspector-fields';
    [
      ['Fournisseur', row.supplier_name],
      ['Référence fournisseur', row.supplier_product_id],
      ['Titre fournisseur', row.supplier_name_original || row.name_source || row.name],
      ['Catégorie fournisseur', row.supplier_category],
      ['Description fournisseur', row.supplier_description || row.description_source],
    ].forEach(([label, value]) => {
      facts.appendChild(text(doc, 'dt', '', label));
      facts.appendChild(text(doc, 'dd', '', value || 'Non renseigné / non mesuré'));
    });
    const sourceDetails = doc.createElement('details');
    sourceDetails.className = 'kmc-catalog-source-details';
    sourceDetails.setAttribute('data-catalog-source-details', '');
    sourceDetails.appendChild(text(doc, 'summary', '', 'Informations fournisseur · Lecture seule'));
    sourceDetails.appendChild(facts);
    panel.appendChild(sourceDetails);
    slot.appendChild(panel);
    if (typeof panel.scrollIntoView === 'function') panel.scrollIntoView({ block: 'nearest' });
    return { panel, actions, feedback };
  }

  // The Sourcing category picker is the proven existing form, not a new
  // classifier. The candidate service supplies the active pairs and evidence.
  async function openCandidateInspector(context, slot, doc, row) {
    const { panel, actions, feedback } = inspectorFrame(slot, doc, row, 'candidate');
    panel.appendChild(text(doc, 'small', 'kmc-catalog-correction-hint',
      'État Sourcing : ' + (row.candidate_state || 'inconnu') +
      ' · Décision de scan : ' + (row.sourcing_decision || 'non mesurée')));

    if (row.work_status === 'sourcing_category_review') {
      // One-click correction: the Catalogue row already asked to edit the category.
      // Fetch the existing authoritative choices immediately, without a second CTA.
      feedback.textContent = 'Chargement des catégories économiques actives…';
      try {
          const options = await jsonRequest(context.fetch,
            SOURCING_ENDPOINT + '/candidates/' + encodeURIComponent(row.candidate_ref) +
            '/category-options');
          const choices = Array.isArray(options.categories) ? options.categories : [];
          const suggested = (options.suggestions || []).find(item =>
            choices.some(option => option.key === item.key));
          if (!choices.length) throw new Error('Aucune catégorie économique active disponible.');
          const ordered = suggested
            ? [suggested, ...choices.filter(item => item.key !== suggested.key)]
            : choices;
          const prior = panel.querySelector('[data-catalog-economic-category-form]');
          if (prior) prior.remove();
          const form = doc.createElement('form');
          form.className = 'kmc-catalog-inspector-form';
          form.setAttribute('data-catalog-economic-category-form', '');
          form.appendChild(text(doc, 'strong', '', 'Catégorie économique / douane'));
          form.appendChild(text(doc, 'p', 'kmc-catalog-correction-hint',
            'Proposition calculée par le moteur de classification existant. ' +
            'Vérifiez les informations fournisseur avant de confirmer.'));
          const label = text(doc, 'label', 'kmc-catalog-inspector-label',
            'Catégorie économique');
          const select = doc.createElement('select');
          select.setAttribute('data-catalog-economic-category-choice', '');
          if (!suggested) {
            const placeholder = doc.createElement('option');
            placeholder.value = '';
            placeholder.textContent = 'Choisir une catégorie — aucune suggestion fiable';
            select.appendChild(placeholder);
          }
          ordered.forEach((item, index) => {
            const option = doc.createElement('option');
            option.value = String(index);
            option.textContent = (suggested && index === 0 ? 'Proposé · ' : '') +
              (item.label || item.key);
            select.appendChild(option);
          });
          select.value = suggested ? '0' : '';
          label.appendChild(select);
          form.appendChild(label);
          if (suggested) form.appendChild(text(doc, 'small', 'kmc-catalog-correction-hint',
            'Confiance de la suggestion : ' + (suggested.confidence || 'non mesurée')));
          form.appendChild(text(doc, 'p', 'kmc-catalog-correction-hint',
            'Confirmer enregistre la correction Sourcing et relance le scanner. ' +
            'Cela ne crée aucun produit et ne déclenche aucune publication.'));
          const save = makeButton(doc, 'Confirmer et relancer le scanner',
            'candidate-resolve-economic-category');
          save.type = 'submit';
          save.hidden = true;
          form.appendChild(save);
          if (suggested) {
            const apply = makeButton(doc, 'Appliquer la proposition', 'candidate-apply-economic-suggestion');
            apply.addEventListener('click', () => form.requestSubmit());
            form.appendChild(apply);
          }
          select.addEventListener('change', () => {
            if (select.value !== '') form.requestSubmit();
          });
          form.addEventListener('submit', async event => {
            event.preventDefault();
            const chosen = select.value === '' ? null : ordered[Number(select.value)];
            if (!chosen) {
              feedback.textContent = 'Choisissez une catégorie existante.';
              return;
            }
            save.disabled = true;
            feedback.textContent = 'Correction Sourcing et nouveau scan…';
            try {
              const answer = await jsonRequest(context.fetch,
                SOURCING_ENDPOINT + '/candidates/' +
                encodeURIComponent(row.candidate_ref) + '/resolve-category', {
                  method: 'POST', body: { category_key: chosen.key },
                });
              if (!answer?.ok) throw new Error('Correction et nouveau scan non confirmés.');
              const result = answer.result || {};
              await context.reload();
              setFeedback(context.root,
                'Catégorie économique enregistrée pour ' + row.candidate_ref +
                  '. Nouveau verdict Sourcing : ' +
                  (result.scan?.decision || 'à relire') +
                  '. Le prix reste à décider par le marché ; aucune publication.', 'positive');
            } catch (err) {
              feedback.textContent = actionErrorMessage(err);
              save.disabled = false;
            }
          });
          if (!panel.parentNode) return panel; // another inspector was opened while loading
          panel.insertBefore(form, panel.querySelector('[data-catalog-source-details]'));
          feedback.textContent = '';
          select.focus();
      } catch (err) {
        if (panel.parentNode) feedback.textContent = actionErrorMessage(err);
      }
      return panel;
    }
    if (row.work_status === 'sourcing_deferred' ||
        ['WATCH','AVOID','LOSS'].includes(String(row.sourcing_decision || '').toUpperCase())) {
      feedback.textContent = 'Décision Sourcing différée : surveillance ou nouvelles preuves fournisseur. ' +
        'Aucune validation humaine Catalogue requise, aucun brouillon créé.';
      return panel;
    }
    if (['rejected', 'archived', 'quarantined', 'imported_to_catalog'].includes(row.candidate_state)
        || row.work_status === 'handoff_missing'
        || String(row.sourcing_decision || '').toUpperCase() === 'EXCLUDED') {
      feedback.textContent = 'L’état actuel interdit une correction Boutique automatique. ' +
        'Une réconciliation de la source est nécessaire ; aucune publication n’est déclenchée.';
      return panel;
    }
    if (row.operator_group === 'processing') {
      feedback.textContent = 'Traitement de source en cours ou incomplet : aucune correction humaine présumée.';
      return panel;
    }
    const classify = makeButton(doc, 'Recharger les propositions', 'candidate-boutique-review');
    actions.appendChild(classify);
    const loadBoutiqueProposal = async () => {
      classify.disabled = true;
      feedback.textContent = 'Chargement des propositions Sourcing…';
      try {
        const options = await jsonRequest(context.fetch,
          SOURCING_ENDPOINT + '/candidates/' + encodeURIComponent(row.candidate_ref) +
          '/boutique-category-options');
        const candidates = Array.isArray(options.categories) ? options.categories : [];
        const suggestion = (options.suggestions || []).find(item =>
          candidates.some(pair => pair.category === item.category &&
            pair.subcategory === item.subcategory));
        const ordered = suggestion
          ? [suggestion, ...candidates.filter(pair =>
              pair.category !== suggestion.category || pair.subcategory !== suggestion.subcategory)]
          : candidates;
        if (!ordered.length) throw new Error('Aucune catégorie Boutique active disponible.');
        const previous = panel.querySelector('[data-catalog-candidate-category-form]');
        if (previous) previous.remove();
        const form = doc.createElement('form');
        form.className = 'kmc-catalog-inspector-form';
        form.setAttribute('data-catalog-candidate-category-form', '');
        form.appendChild(text(doc, 'strong', '', 'Proposition de classement Boutique'));
        form.appendChild(text(doc, 'p', 'kmc-catalog-correction-hint',
          suggestion
            ? 'Proposition issue du moteur Komerce. Vérifiez sa preuve et sa pertinence.'
            : 'Aucune proposition sûre. Sélectionnez une catégorie Boutique existante.'));
        if (suggestion) {
          const basis = [suggestion.basis, suggestion.reason, suggestion.confidence]
            .filter(Boolean).join(' · ');
          if (basis) form.appendChild(text(doc, 'small', 'kmc-catalog-correction-hint', basis));
        }
        const label = text(doc, 'label', 'kmc-catalog-inspector-label',
          'Catégorie / sous-catégorie');
        const select = doc.createElement('select');
        select.setAttribute('data-catalog-candidate-category-choice', '');
        if (!suggestion) {
          const placeholder = doc.createElement('option');
          placeholder.value = '';
          placeholder.textContent = 'Choisir une catégorie vérifiée';
          placeholder.disabled = true;
          select.appendChild(placeholder);
        }
        ordered.forEach((item, index) => {
          const option = doc.createElement('option');
          option.value = String(index);
          option.textContent = (suggestion && index === 0 ? 'Proposé · ' : '') +
            (item.category_label || item.category) + ' › ' +
            (item.subcategory_label || item.subcategory);
          select.appendChild(option);
        });
        select.value = suggestion ? '0' : '';
        label.appendChild(select);
        form.appendChild(label);
        form.appendChild(text(doc, 'p', 'kmc-catalog-correction-hint',
          'Confirmer cette proposition enregistre le classement et peut créer ' +
          'automatiquement un brouillon Catalogue non publié. Aucun prix ni marché activé.'));
        const save = makeButton(doc, 'Confirmer le classement', 'confirm-candidate-boutique');
        save.type = 'submit';
        save.hidden = true;
        form.appendChild(save);
        if (suggestion) {
          const apply = makeButton(doc, 'Appliquer la proposition', 'candidate-apply-boutique-suggestion');
          apply.addEventListener('click', () => form.requestSubmit());
          form.appendChild(apply);
        }
        select.addEventListener('change', () => {
          if (select.value !== '') form.requestSubmit();
        });
        form.addEventListener('submit', async event => {
          event.preventDefault();
          const index = Number.parseInt(select.value, 10);
          const chosen = Number.isInteger(index) ? ordered[index] : null;
          if (!chosen) { feedback.textContent = 'Choisissez une classification valide.'; return; }
          save.disabled = true;
          feedback.textContent = 'Enregistrement auprès de l’autorité Sourcing…';
          try {
            const response = await jsonRequest(context.fetch,
              SOURCING_ENDPOINT + '/candidates/' + encodeURIComponent(row.candidate_ref) +
              '/confirm-boutique-category', {
                method: 'POST',
                body: { category: chosen.category, subcategory: chosen.subcategory },
              });
            if (!response?.ok) throw new Error('Confirmation Sourcing non acquise.');
            // A partial handoff is NOT a success for the draft; the mapping
            // confirmation remains a separate persisted fact.
            const outcome = response.result || {};
            await context.reload();
            setFeedback(context.root,
              outcome.draft_created
                ? 'Classement confirmé ; brouillon créé. Le Catalogue a été relu.'
                : 'Classement confirmé ; la remise nécessite encore une vérification. ' +
                  (outcome.handoff_error_code || ''),
              outcome.draft_created ? 'positive' : 'warning');
          } catch (error) {
            feedback.textContent = actionErrorMessage(error);
            save.disabled = false;
          }
        });
        // The proposed classification belongs next to the operator actions,
        // not underneath the entire supplier/economic read-only dossier.
        panel.insertBefore(form, panel.querySelector('[data-catalog-source-details]'));
        feedback.textContent = '';
        classify.hidden = true; // the proposed correction is the only action to show
      } catch (error) {
        feedback.textContent = actionErrorMessage(error);
        classify.hidden = false;
      } finally {
        classify.disabled = false;
      }
    };
    classify.addEventListener('click', loadBoutiqueProposal);
    // Display the server's suggestion on opening the dossier; no second click.
    // This is a read only GET. Only the explicit confirmation can write.
    void loadBoutiqueProposal();
    return panel;
  }

  function renderProductDossierDetails(slot, doc, dossier, row) {
    slot.replaceChildren();
    const header = text(doc, 'strong', 'kmc-catalog-inspector-section',
      'Fiche commerciale · état réel du produit');
    slot.appendChild(header);
    const identity = dossier.identity || {};
    const supplier = dossier.supplier || {};
    const availability = dossier.availability || {};
    const purchasing = dossier.purchasing || {};
    const media = dossier.media || {};
    const gate = dossier.catalogue_gate || {};
    const status = gate.phase === 'catalog_approval'
      ? (gate.technically_certified ? 'Contrôles techniques satisfaits · validation humaine distincte'
        : 'Fiche incomplète · corrections ou preuves manquantes')
      : (row.work_status === 'catalog_approved'
        ? 'Catalogue approuvé · décisions marchés à vérifier'
        : 'État Catalogue à vérifier · aucune nouvelle validation implicite');
    slot.appendChild(text(doc, 'p', 'kmc-catalog-inspector-next-step', status));
    const gallery = Array.isArray(media.gallery) ? media.gallery : [];
    const photos = doc.createElement('section');
    photos.className = 'kmc-catalog-dossier-gallery';
    photos.setAttribute('data-catalog-canonical-gallery', '');
    photos.appendChild(text(doc, 'strong', '', 'Images canoniques actives'));
    if (!gallery.length) {
      photos.appendChild(text(doc, 'p', 'kmc-catalog-correction-hint',
        'Aucune image canonique HTTPS à afficher. Les aperçus fournisseur ne sont pas des médias validés.'));
    } else {
      const strip = doc.createElement('div');
      strip.className = 'kmc-catalog-dossier-image-strip';
      gallery.forEach((item, index) => {
        if (!/^https:\/\//i.test(item.url || '')) return;
        const figure = doc.createElement('figure');
        const img = doc.createElement('img');
        img.src = item.url;
        img.alt = item.alt || 'Image du produit ' + (index + 1);
        img.loading = 'lazy';
        figure.appendChild(img);
        figure.appendChild(text(doc, 'figcaption', '',
          (item.role || 'PRODUCT') + (item.alt ? ' · ' + item.alt : '')));
        strip.appendChild(figure);
      });
      photos.appendChild(strip);
      if (media.gallery_truncated) photos.appendChild(text(doc, 'small',
        'kmc-catalog-correction-hint', 'Galerie partielle : plus de 24 médias actifs.'));
    }
    slot.appendChild(photos);
    const facts = (title, entries) => {
      const group = doc.createElement('section');
      group.className = 'kmc-catalog-dossier-group';
      group.appendChild(text(doc, 'strong', '', title));
      const grid = doc.createElement('dl');
      grid.className = 'kmc-catalog-inspector-fields';
      entries.forEach(([label, value]) => {
        grid.appendChild(text(doc, 'dt', '', label));
        grid.appendChild(text(doc, 'dd', '', value == null || value === ''
          ? 'Non renseigné' : String(value)));
      });
      group.appendChild(grid);
      slot.appendChild(group);
    };
    const displayNumber = value => value == null ? 'Non mesuré' : String(value);
    facts('Présentation commerciale', [
      ['Titre boutique FR', identity.title_fr],
      ['Description boutique FR', identity.description_fr],
      ['Langue / origine', [identity.locale || 'Non renseignée', identity.content_source || 'Origine inconnue'].join(' · ')],
      ['Présentation FR', identity.needs_review ? 'Relecture requise' : 'Sans signal de relecture'],
      ['Catégorie douanière', identity.customs_category],
      ['Catégorie Boutique', identity.boutique_category_key],
      ['Sous-catégorie Boutique', identity.boutique_subcategory_key],
      ['Taxonomie active', identity.taxonomy_active ? 'Oui' : 'Non vérifiée'],
    ]);
    facts('Fournisseur et achat', [
      ['Fournisseur', supplier.name],
      ['Identifiant fournisseur', supplier.reference],
      ['Contrat source V2', supplier.source_contract_v2 == null ? 'Non applicable / historique'
        : (supplier.source_contract_v2 ? 'Présent' : 'À normaliser')],
      ['Décision Sourcing', supplier.sourcing_decision],
      ['SKU fournisseur actifs', displayNumber(purchasing.active_supplier_skus)],
      ['SKU avec identité d’achat complète', displayNumber(purchasing.complete_supplier_skus)],
      ['Identité d’achat', purchasing.supplier_identity_complete == null ? 'Non applicable / historique'
        : (purchasing.supplier_identity_complete ? 'Complète' : 'À vérifier / compléter')],
    ]);
    facts('Médias, stock et logistique', [
      ['Médias canoniques actifs', displayNumber(media.active_canonical)],
      ['Modèle d’inventaire', availability.inventory_model],
      ['Variantes', availability.has_variants ? 'Oui' : 'Non'],
      ['Poids', availability.weight_kg == null ? 'Non renseigné' : availability.weight_kg + ' kg'],
      ['Dimensions', availability.dimensions_cm],
      ['Fragilité', availability.fragility || 'Non renseignée'],
      ['Transport sécurisé', availability.requires_secure_transport ? 'Requis' : 'Non signalé'],
      ['Stock affiché', availability.stock_is_authoritative
        ? displayNumber(availability.stock) : 'Géré par les SKU · voir ci-dessous'],
      ['Disponibilité', availability.is_available ? 'Disponible selon la fiche' : 'Non disponible selon la fiche'],
    ]);
    const variants = dossier.variants || {};
    const units = Array.isArray(variants.rows) ? variants.rows : [];
    const unitBox = doc.createElement('details');
    unitBox.className = 'kmc-catalog-dossier-group kmc-catalog-variant-details';
    unitBox.setAttribute('data-catalog-variants', '');
    unitBox.appendChild(text(doc, 'summary', '',
      (variants.inventory_model === 'SKU' ? 'Unités vendables (SKU)' : 'Axes de variantes historiques') +
      ' · ' + units.length + (variants.truncated ? '+' : '')));
    const unitHint = variants.stock_semantics === 'sellable_sku'
      ? 'Le stock se gère sur les SKU actifs, et non sur le champ stock global du produit.'
      : 'Ces variantes historiques ne constituent pas nécessairement des combinaisons vendables ; leurs stocks ne doivent pas être additionnés.';
    unitBox.appendChild(text(doc, 'p', 'kmc-catalog-correction-hint', unitHint));
    if (!units.length) unitBox.appendChild(text(doc, 'p',
      'kmc-catalog-correction-hint', 'Aucune variante renseignée dans ce modèle.'));
    units.forEach(unit => {
      const line = doc.createElement('div');
      line.className = 'kmc-catalog-variant-line';
      const variantLabel = variants.inventory_model === 'SKU'
        ? (unit.variant_combo && typeof unit.variant_combo === 'object' &&
            !Array.isArray(unit.variant_combo) ? Object.entries(unit.variant_combo)
          .map(([key, value]) => key + ' : ' + String(value)).join(' · ') : 'Unité par défaut')
        : [unit.variant_type, unit.variant_value].filter(Boolean).join(' · ');
      line.appendChild(text(doc, 'strong', '', variantLabel || 'Sans variante'));
      line.appendChild(text(doc, 'span', '',
        'SKU : ' + (unit.sku || 'Non renseigné') +
        (unit.supplier_sku ? ' · fournisseur : ' + unit.supplier_sku : '')));
      if (variants.inventory_model === 'SKU') line.appendChild(text(doc, 'span', '',
        'Stock : ' + displayNumber(unit.stock) +
        ' · ' + (unit.is_active ? 'Actif' : 'Inactif') +
        (unit.supplier_unit_ref ? ' · unité fournisseur : ' + unit.supplier_unit_ref : '')));
      unitBox.appendChild(line);
    });
    if (variants.truncated) unitBox.appendChild(text(doc, 'p',
      'kmc-catalog-correction-hint', 'Liste partielle : plus de 50 lignes de variantes ou SKU.'));
    slot.appendChild(unitBox);
    const markets = Array.isArray(dossier.markets) ? dossier.markets : [];
    const mgroup = doc.createElement('section');
    mgroup.className = 'kmc-catalog-dossier-group';
    mgroup.appendChild(text(doc, 'strong', '', 'Suivi de commercialisation par marché'));
    if (dossier.market_data_scope === 'not_queried_before_approval') {
      mgroup.appendChild(text(doc, 'p', 'kmc-catalog-correction-hint',
        'Produit non approuvé : les décisions tarifaires et d’exposition ne sont pas présumées.'));
    } else if (!markets.length) {
      mgroup.appendChild(text(doc, 'p', 'kmc-catalog-correction-hint',
        'Aucun marché actif mesuré pour ce produit.'));
    } else {
      markets.forEach(market => {
        const line = doc.createElement('div');
        line.className = 'kmc-catalog-market-row';
        line.appendChild(text(doc, 'strong', '', market.code || 'Marché'));
        line.appendChild(text(doc, 'span', '',
          'Exposition : ' + (market.commercial_exposure || 'Non renseignée')));
        line.appendChild(text(doc, 'span', '',
          'Décision tarifaire : ' + (market.price_status === 'LOCAL_ACTIVE'
            ? 'Prix local actif sur ce marché' : 'À finaliser dans le marché')));
        mgroup.appendChild(line);
      });
      mgroup.appendChild(text(doc, 'p', 'kmc-catalog-correction-hint',
        'Un prix LOCAL_ACTIVE et une exposition ENABLED ne prouvent pas à eux seuls la capacité d’achat en caisse.'));
    }
    slot.appendChild(mgroup);
    const issues = Array.isArray(gate.reasons) ? gate.reasons : [];
    if (gate.phase === 'catalog_approval' && issues.length) {
      const problems = doc.createElement('section');
      problems.className = 'kmc-catalog-dossier-group';
      problems.appendChild(text(doc, 'strong', '', 'Prérequis à compléter avant approbation'));
      const list = doc.createElement('ul');
      list.className = 'kmc-catalog-inspector-issues';
      issues.forEach(reason => list.appendChild(text(doc, 'li', '',
        certificationReasonLabel(reason))));
      problems.appendChild(list);
      slot.appendChild(problems);
    }
  }

  async function loadProductDossier(context, doc, slot, row) {
    try {
      const dossier = await jsonRequest(context.fetch, ENDPOINT +
        '?dossier_product_ref=' + encodeURIComponent(row.product_ref));
      // A closed inspector must not resurrect content on a different product.
      if (!slot.isConnected) return;
      row._catalogueDossier = dossier; // local read-only projection, never persisted
      renderProductDossierDetails(slot, doc, dossier, row);
    } catch (err) {
      if (!slot.isConnected) return;
      slot.replaceChildren(text(doc, 'p', 'kmc-catalog-correction-hint',
        'Dossier de certification indisponible : ' + actionErrorMessage(err)));
    }
  }

  function openProductInspector(context, slot, doc, row, categories) {
    const { panel, actions, feedback } = inspectorFrame(slot, doc, row, 'product');
    const dossierSlot = doc.createElement('section');
    dossierSlot.className = 'kmc-catalog-dossier';
    dossierSlot.setAttribute('data-catalog-product-dossier', '');
    dossierSlot.appendChild(text(doc, 'p', 'kmc-catalog-correction-hint',
      'Lecture des preuves Produit, Sourcing et Commercialisation…'));
    const additional = doc.createElement('details');
    additional.className = 'kmc-catalog-complementary';
    additional.setAttribute('data-catalog-complementary-info', '');
    additional.appendChild(text(doc, 'summary', '', 'Informations complémentaires'));
    additional.appendChild(dossierSlot);
    const supplierInfo = panel.querySelector('[data-catalog-source-details]');
    if (supplierInfo) additional.insertBefore(supplierInfo, dossierSlot);
    void loadProductDossier(context, doc, dossierSlot, row);
    const issues = Array.isArray(row.issues) ? row.issues : [];
    const correctionIssues = issues.filter(code => code !== 'approval_pending');
    const correctionsTitle = text(doc, 'strong', 'kmc-catalog-inspector-section',
      correctionIssues.length ? 'À compléter' : 'Catégorie boutique');
    panel.insertBefore(correctionsTitle, panel.querySelector('[data-catalog-action-dock]'));
    const list = doc.createElement('ul');
    list.className = 'kmc-catalog-inspector-issues';
    const labels = {
      source_to_normalize: 'Source fournisseur à vérifier',
      taxonomy_to_confirm: 'Classement Boutique à corriger',
      editorial_to_complete: 'Titre / description FR à préparer',
      media_missing: 'Médias canoniques absents',
      state_inconsistent: 'Activation d’un candidat sans preuve de validation',
      approval_pending: 'Validation Catalogue à réaliser',
    };
    correctionIssues.forEach(code => {
      if (!['editorial_to_complete','taxonomy_to_confirm'].includes(code) && labels[code])
        list.appendChild(text(doc, 'li', '', labels[code]));
    });
    if (list.children.length) panel.insertBefore(list, panel.querySelector('[data-catalog-action-dock]'));
    if (row.work_status === 'activation_to_reconcile') {
      feedback.textContent =
        'Activation d’une fiche encore marquée candidate : origine et autorisation à vérifier. ' +
        'Réconciliation avec la preuve d’origine indispensable. ' +
        'Aucune approbation ni correction de média proposée automatiquement.';
      panel.appendChild(additional);
      return panel;
    }
    if (row.lifecycle_status === 'rejected' || row.work_status === 'approval_unproven') {
      feedback.textContent = row.work_status === 'approval_unproven'
        ? 'Produit actif sans décision d’approbation démontrée : réconciliation nécessaire, ' +
          'aucune validation automatique.'
        : 'Produit écarté : un réexamen autorisé est nécessaire.';
      panel.appendChild(additional);
      return panel;
    }

    const inlineEditor = renderProductQuickFields(context, doc, panel, row, categories, feedback);
    if (issues.includes('media_missing')) {
      additional.insertBefore(text(doc, 'strong', 'kmc-catalog-inspector-section',
        'Contrôle média · informations vérifiées'), dossierSlot);
      const mediaFacts = doc.createElement('dl');
      mediaFacts.className = 'kmc-catalog-inspector-fields';
      const findings = [
        ['Médias actifs canoniques', row.active_media_count == null
          ? 'Non mesuré' : String(row.active_media_count)],
        ['Médias du contrat fournisseur V2', row.source_media_count == null
          ? 'Non mesuré' : String(row.source_media_count)],
        ['Diagnostic', ({
          canonical_inactive_review: 'Un média canonique existe mais est désactivé. Réexamen humain requis, aucune réactivation automatique.',
          source_recoverable: 'Médias source identifiés avec une identité stable. Réintégration canonique nécessaire.',
          source_requires_review: 'Médias source présents mais non admissibles sans vérification.',
          preview_only: 'L’image d’aperçu ne constitue pas une preuve média canonique.',
          source_missing: 'Aucun média exploitable détecté dans la source.',
        })[row.media_status] || 'Recontrôle de certification nécessaire'],
      ];
      findings.forEach(([label, value]) => {
        mediaFacts.appendChild(text(doc, 'dt', '', label));
        mediaFacts.appendChild(text(doc, 'dd', '', value));
      });
      additional.insertBefore(mediaFacts, dossierSlot);
      if (row.media_status === 'source_recoverable' &&
          row.lifecycle_status === 'candidate' && row.is_active === false) {
        const recover = makeButton(doc, 'Réintégrer les médias fournisseur', 'inspector-recover-media');
        recover.addEventListener('click', async () => {
          if (!context.confirm('Réintégrer les médias du contrat fournisseur pour ' +
            row.product_ref + ' ? Ce geste sera audité et ne valide ni ne publie le produit.')) return;
          recover.disabled = true;
          feedback.textContent = 'Vérification et réintégration des médias canoniques…';
          try {
            const response = await jsonRequest(context.fetch,
              ENDPOINT + '/products/' + encodeURIComponent(row.product_ref) +
              '/recover-source-media', { method: 'POST', body: {} });
            if (!response?.ok || response.result?.audit_recorded !== true) {
              throw new Error('Preuve de réintégration incomplète.');
            }
            const finalized = await finishCatalogueAfterCorrection(context, row);
            await context.reload();
            setFeedback(context.root,
              finalized?.message || row.product_ref +
                ' · médias réintégrés et tracés. Autres contrôles à vérifier.',
              finalized?.tone || 'positive');
          } catch (err) {
            feedback.textContent = actionErrorMessage(err);
            recover.disabled = false;
          }
        });
        actions.appendChild(recover);
      }
      additional.insertBefore(text(doc, 'p', 'kmc-catalog-correction-hint',
        'Le produit reste hors publication marché tant que les contrôles ne sont pas satisfaits.'), dossierSlot);
    }
    if (issues.includes('source_to_normalize'))
      feedback.textContent = row.candidate_ref
        ? 'Contrat source à recontrôler via Sourcing : aucune validation Catalogue tant que la source n’est pas certifiée.'
        : 'La provenance manque. Aucune source fournisseur ne sera inventée.';
    // Editorial correction is the primary task whenever the FR sheet is incomplete.
    // The editor stays on the Catalogue; supplier originals are never overwritten.
    if (row.candidate_ref && (row.lifecycle_status === 'candidate' ||
        (row.lifecycle_status === 'active' && row.is_active === true))) {
      const btn = makeButton(doc,
        issues.includes('editorial_to_complete')
          ? 'Compléter titre et description FR' : 'Modifier titre / description FR',
        'inspector-prepare-fr');
      btn.addEventListener('click', async () => {
        try {
          const dossier = row._catalogueDossier || await jsonRequest(context.fetch,
            ENDPOINT + '?dossier_product_ref=' + encodeURIComponent(row.product_ref));
          const identity = dossier?.identity || {};
          await openFrenchEditor(context, {
            ...row,
            name: identity.title_fr || row.name,
            description: identity.description_fr || row.description || '',
            content_source: identity.content_source || row.content_source,
            source_locale: identity.locale || row.source_locale,
          }, btn);
        } catch (err) {
          feedback.textContent = actionErrorMessage(err);
        }
      });
      // Une fiche déjà correcte garde l'édition volontaire dans le menu secondaire.
      if (issues.includes('editorial_to_complete')) actions.appendChild(btn);
      else additional.insertBefore(btn, dossierSlot);
    }
    // The classification may also be corrected before an issue is raised,
    // but the server still validates the active Boutique pair and operator grant.
    if ((row.candidate_ref || (row.lifecycle_status === 'active' && row.is_active === true))) {
      const btn = makeButton(doc, 'Corriger le classement', 'inspector-classify', true);
      btn.addEventListener('click', () =>
        openProductClassificationDialog(context, row, categories, btn));
      if (issues.includes('taxonomy_to_confirm')) actions.appendChild(btn);
      else additional.insertBefore(btn, dossierSlot);
    }
    if (row.work_status === 'approval_pending' || issues.includes('approval_pending')) {
      const stepNotice = text(doc, 'p', 'kmc-catalog-correction-hint',
        '1. Contrôler les prérequis (lecture seule) · 2. Valider le Catalogue après relecture humaine. La correction du français ne valide jamais automatiquement le produit.');
      stepNotice.setAttribute('data-catalog-approval-explanation', '');
      const approvalDetails = doc.createElement('details');
      approvalDetails.className = 'kmc-catalog-complementary';
      approvalDetails.setAttribute('data-catalog-approval-details', '');
      approvalDetails.appendChild(text(doc, 'summary', '',
        'Approbation Catalogue · contrôle exceptionnel'));
      approvalDetails.appendChild(stepNotice);
      panel.appendChild(approvalDetails);
      const review = makeButton(doc, 'Contrôler les prérequis', 'inspector-check-approval');
      review.addEventListener('click', async () => {
        review.disabled = true;
        feedback.textContent = 'Vérification de la certification Catalogue…';
        try {
          const data = await jsonRequest(context.fetch,
            ENDPOINT + '?diagnose_product_ref=' + encodeURIComponent(row.product_ref));
          const state = data?.certification || null;
          if (data?.phase !== 'catalog_approval' || !state?.certified) {
            const reasons = (state?.reasons || []).map(certificationReasonLabel);
            feedback.textContent = reasons.length
              ? 'À compléter : ' + reasons.join(' · ')
              : (data?.note || 'Certification non démontrée. Validation impossible.');
            const approvalAction = panel.querySelector('[data-workspace-action="inspector-approve"]');
            if (approvalAction) approvalAction.remove();
            return;
          }
          const already = panel.querySelector('[data-workspace-action="inspector-approve"]');
          if (!already) {
            const approve = makeButton(doc, 'Valider le Catalogue', 'inspector-approve');
            approve.addEventListener('click', async () => {
              if (!context.confirm('Valider ' + row.product_ref +
                ' après relecture ? Cette décision est tracée et ne publie aucun marché.')) return;
              approve.disabled = true;
              try {
                const result = await jsonRequest(context.fetch,
                  ENDPOINT + '/approval/' + encodeURIComponent(row.product_ref) + '/approve',
                  { method: 'POST' });
                if (!result?.ok) throw new Error('Validation non confirmée par le serveur.');
                await context.reload();
                setFeedback(context.root, row.product_ref +
                  ' validé dans le Catalogue. Décisions marchés distinctes.', 'positive');
              } catch (error) {
                feedback.textContent = 'Validation refusée : ' + actionErrorMessage(error) +
                  '. La fiche reste en attente ; aucune vente n’a été activée.';
                approve.disabled = false;
              }
            });
            actions.appendChild(approve);
          }
          feedback.textContent = 'Prérequis techniques satisfaits. Vérifiez le titre, la description, les images et la catégorie, puis cliquez sur « Valider le Catalogue ». Aucun marché ne sera publié automatiquement.';
        } catch (error) {
          feedback.textContent = actionErrorMessage(error);
        } finally { review.disabled = false; }
      });
      approvalDetails.appendChild(review);
    }
    if (inlineEditor) {
      Array.from(actions.children).forEach(button => {
        if (['inspector-prepare-fr','inspector-classify'].includes(
          button.getAttribute('data-workspace-action'))) button.hidden = true;
      });
    }
    if (!Array.from(actions.children).some(button => !button.hidden)) {
      const dock = panel.querySelector('[data-catalog-action-dock]');
      if (dock) dock.hidden = true;
    }
    // Le dossier complet ne précède jamais la liste des anomalies.
    panel.appendChild(additional);
    return panel;
  }

  function renderProducts(rootNode, ui, doc, payload, context) {
    const slot = createSection(rootNode, ui, 'Produits', '');
    if (slot.parentNode) {
      slot.parentNode.setAttribute('id', 'catalog-products');
      slot.parentNode.className = (slot.parentNode.className || '') + ' kmc-catalog-main-panel';
    }
    const filters = context.catalogFilters;
    const bar = doc.createElement('div');
    bar.className = 'kmc-workspace-section-actions kmc-catalog-filter-bar';
    const field = (label, control) => {
      const wrapper = doc.createElement('label');
      wrapper.className = 'kmc-catalog-filter';
      wrapper.appendChild(text(doc, 'span', 'kmc-workspace-subtitle', label));
      wrapper.appendChild(control);
      return wrapper;
    };
    const input = (label, key, placeholder) => {
      const control = doc.createElement('input');
      control.type = 'search';
      control.placeholder = placeholder;
      control.value = filters[key] || '';
      control.setAttribute('aria-label', label);
      control.addEventListener('input', () => { filters[key] = control.value; });
      bar.appendChild(field(label, control));
    };
    const select = (label, key, options) => {
      const control = doc.createElement('select');
      control.setAttribute('aria-label', label);
      options.forEach(option => {
        const opt = doc.createElement('option');
        opt.value = option.value;
        opt.textContent = option.label;
        control.appendChild(opt);
      });
      control.value = filters[key] || '';
      control.addEventListener('change', () => {
        if (key === 'category' && filters.category !== control.value) filters.subcategory = '';
        filters[key] = control.value;
      });
      bar.appendChild(field(label, control));
    };
    input('Recherche', 'search', 'Nom, référence, SKU fournisseur');
    input('Fournisseur', 'supplier', 'Nom exact du fournisseur');
    const categories = (payload.categories || []).filter(row => row.is_active);
    select('Catégorie boutique', 'category', [
      { value: '', label: 'Toutes les catégories' },
      ...categories.map(row => ({ value: row.key, label: row.label || row.key })),
    ]);
    const availableSubcategories = categories
      .filter(row => !filters.category || row.key === filters.category)
      .flatMap(row => (row.subcategories || []).filter(sub => sub.is_active)
        .map(sub => ({ value: sub.key, label: (row.label || row.key) + ' · ' + (sub.label || sub.key) })));
    select('Sous-catégorie', 'subcategory', [
      { value: '', label: 'Toutes les sous-catégories' }, ...availableSubcategories,
    ]);
    select('Statut Catalogue', 'status', [
      { value: '', label: 'Tous les produits' },
      { value: 'correction', label: 'À corriger' },
      { value: 'review', label: 'À valider / examiner' },
      { value: 'validated', label: 'Validés' },
      { value: 'processing', label: 'En préparation automatique' },
      { value: 'excluded', label: 'Écartés / archivés' },
    ]);
    const apply = makeButton(doc, 'Filtrer', 'catalog-filter');
    apply.addEventListener('click', async () => {
      filters.offset = 0;
      await context.reload();
    });
    bar.appendChild(apply);
    const reset = makeButton(doc, 'Effacer', 'catalog-reset', true);
    reset.addEventListener('click', async () => {
      context.catalogFilters = { search: '', supplier: '', category: '', subcategory: '', status: '', offset: 0 };
      await context.reload();
    });
    bar.appendChild(reset);
    slot.appendChild(bar);
    const quick = doc.createElement('div');
    quick.className = 'kmc-catalog-quick-filters';
    quick.appendChild(text(doc, 'span', 'kmc-catalog-quick-label', 'Accès rapide'));
    const serverCounts = payload.summary?.operator_groups || {};
    [
      ['', 'Tous'],
      ['correction', 'À corriger'],
      ['review', 'À valider'],
      ['validated', 'Validés'],
    ].forEach(([value, label]) => {
      if (value) label += ' · ' + formatNumber(serverCounts[value] || 0);
      const chip = text(doc, 'button', 'kmc-catalog-quick-chip', label);
      chip.type = 'button';
      chip.setAttribute('aria-pressed', String(filters.status === value));
      chip.addEventListener('click', async () => {
        context.catalogFilters.status = value;
        context.catalogFilters.offset = 0;
        await context.reload();
      });
      quick.appendChild(chip);
    });
    slot.appendChild(quick);

    const rows = payload.products || [];
    const page = payload.registry_page || { total: rows.length, limit: rows.length, offset: 0 };
    slot.appendChild(text(doc, 'p', 'kmc-workspace-subtitle',
      formatNumber(page.total) + ' fiche(s) dans ce filtre · candidats Sourcing et produits Catalogue réunis'));
    if (context.focusedProductRef) {
      const current = rows.some(row => row.product_ref === context.focusedProductRef);
      const notice = doc.createElement('aside');
      notice.className = 'kmc-catalog-focused-notice';
      notice.setAttribute('data-focused-product-result', current ? 'visible' : 'not-in-page');
      notice.appendChild(text(doc, 'strong', '',
        (current ? 'Produit retrouvé : ' : 'Produit non visible sur cette page : ') + context.focusedProductRef));
      notice.appendChild(text(doc, 'span', '',
        current
          ? ' La référence reste ciblée dans le Catalogue global.'
          : ' La référence peut être hors de la page filtrée. Cette absence ne signifie ni rejet ni dépublication.'));
      if (!current) {
        const locate = text(doc, 'a', '', 'Rechercher cette référence dans le Catalogue');
        locate.href = '/admin/workspaces/catalog?search=' +
          encodeURIComponent(context.focusedProductRef);
        notice.appendChild(locate);
      }
      slot.appendChild(notice);
    }
    if (!rows.length) {
      const empty = doc.createElement('div');
      empty.className = 'kmc-workspace-empty';
      empty.appendChild(text(doc,'p','',
        'Aucune fiche ne correspond aux filtres. Vérifiez les filtres ou le suivi technique des imports.'));
      // No forced redirection to a second operator workspace.
      slot.appendChild(empty);
    } else {
      const table = doc.createElement('table');
      table.className = 'kmc-workspace-table kmc-catalog-registry-table';
      table.innerHTML = '<thead><tr><th>Produit</th><th>Fournisseur</th><th>Classement boutique</th><th>À compléter</th><th>Action</th></tr></thead>';
      const tbody = doc.createElement('tbody');
      const statusNames = {
        source_to_normalize: 'Source à normaliser',
        taxonomy_to_confirm: 'Classement à confirmer',
        editorial_to_complete: 'Présentation FR à compléter',
        approval_pending: 'À valider',
        catalog_approved: 'Approuvé Catalogue',
        rejected: 'Écarté',
        inactive: 'Inactif',
      };
      rows.forEach(row => {
        const tr = doc.createElement('tr');
        tr.setAttribute(row.product_ref ? 'data-product-ref' : 'data-candidate-ref',
          row.product_ref || row.candidate_ref);
        tr.setAttribute('data-status', row.work_status || 'inactive');
        if (row.product_ref === context.focusedProductRef)
          tr.className = 'kmc-catalog-context-target';
        const productCell = doc.createElement('td');
        const productWrap = doc.createElement('div');
        productWrap.className = 'kmc-catalog-registry-product';
        if (row.image_url && /^https:\/\//i.test(row.image_url)) {
          const picture = doc.createElement('img');
          picture.className = 'kmc-catalog-registry-thumb';
          picture.src = row.image_url;
          picture.alt = '';
          picture.loading = 'lazy';
          if (row.supplier_image_preview) {
            picture.title = 'Aperçu fournisseur · média Catalogue non certifié';
          }
          productWrap.appendChild(picture);
        } else {
          const emptyPicture = text(doc, 'span', 'kmc-catalog-registry-photo-empty', '—');
          emptyPicture.setAttribute('aria-label', 'Visuel non disponible');
          productWrap.appendChild(emptyPicture);
        }
        const productCopy = doc.createElement('div');
        const ref = row.product_ref || row.candidate_ref;
        const link = text(doc, row.product_ref ? 'a' : 'span',
          'kmc-catalog-product-title', row.name || ref);
        if (row.product_ref) link.href = contextualHref('/admin/products/' + encodeURIComponent(row.product_ref),
          '/admin/workspaces/catalog?product_ref=' + encodeURIComponent(row.product_ref), 'Retour au Catalogue');
        link.title = row.name || ref;
        productCopy.className = 'kmc-catalog-product-copy';
        productCopy.appendChild(link);
        productCopy.appendChild(text(doc, 'small', 'kmc-catalog-product-reference', ref));
        productCopy.appendChild(text(doc, 'small', 'kmc-catalog-product-helper',
          row.supplier_category || 'Désignation fournisseur'));
        productWrap.appendChild(productCopy);
        productCell.appendChild(productWrap);
        productCell.setAttribute('data-label', 'Produit');
        tr.appendChild(productCell);
        const supplier = doc.createElement('td');
        supplier.className = 'kmc-catalog-supplier';
        supplier.setAttribute('data-label', 'Fournisseur');
        supplier.appendChild(text(doc, 'span', '', row.supplier_name || 'Fournisseur à vérifier'));
        if (row.supplier_product_id) {
          supplier.appendChild(text(doc, 'small', 'kmc-catalog-supplier-ref', row.supplier_product_id));
        }
        tr.appendChild(supplier);
        const category = doc.createElement('td');
        category.className = 'kmc-catalog-category';
        category.setAttribute('data-label', 'Classification boutique');
        category.appendChild(text(doc, 'strong', '',
          row.record_kind === 'candidate'
            ? 'Classement boutique à confirmer'
            : (row.boutique_category_label || row.boutique_category_key || 'À classer')));
        if (row.record_kind === 'candidate' && row.supplier_category) {
          category.appendChild(text(doc, 'small', 'kmc-catalog-correction-hint',
            'Catégorie fournisseur : ' + row.supplier_category));
        }
        if (row.boutique_subcategory_label || row.boutique_subcategory_key) {
          category.appendChild(text(doc, 'small', '',
            row.boutique_subcategory_label || row.boutique_subcategory_key));
        }
        tr.appendChild(category);

        if (row.record_kind === 'candidate') {
          const diagnostic = doc.createElement('td');
          diagnostic.className = 'kmc-catalog-diagnostic';
          diagnostic.setAttribute('data-label', 'Situation');
          const nextStep = registryNextStep(row);
          const chip = text(doc, 'span', 'kmc-catalog-status', nextStep.status);
          chip.setAttribute('data-status', row.work_status || 'processing');
          diagnostic.appendChild(chip);
          diagnostic.appendChild(text(doc, 'small', 'kmc-catalog-correction-hint',
            row.operator_group === 'processing'
              ? 'Aucune correction humaine présumée avant le diagnostic.'
              : 'Candidat fournisseur · aucune validation Catalogue implicite.'));
          tr.appendChild(diagnostic);
          const action = doc.createElement('td');
          action.className = 'kmc-catalog-action-cell';
          const inspect = makeButton(doc, nextStep.label, 'inspect-candidate', true);
          inspect.addEventListener('click', () => openCandidateInspector(context, slot, doc, row));
          action.appendChild(inspect);
          tr.appendChild(action);
          tbody.appendChild(tr);
          return;
        }

        const diagnostic = doc.createElement('td');
        diagnostic.className = 'kmc-catalog-diagnostic';
        diagnostic.setAttribute('data-label', 'À compléter');
        const nextStep = registryNextStep(row);
        const statusChip = text(doc, 'button', 'kmc-catalog-status', nextStep.status);
        statusChip.type = 'button';
        statusChip.title = 'Aller à l’action : ' + nextStep.label;
        statusChip.setAttribute('data-status', row.work_status || 'inactive');
        statusChip.hidden = true; // Statut technique masqué : seules les corrections sont visibles.
        diagnostic.appendChild(statusChip);
        const readinessCheck = renderRegistryCorrections(doc, diagnostic, row, context, nextStep);
        tr.appendChild(diagnostic);
        const actionCell = doc.createElement('td');
        actionCell.className = 'kmc-catalog-action-cell';
        actionCell.setAttribute('data-label', 'Consulter');
        const alreadyApproved = ['catalog_approved','catalog_approved_inactive'].includes(row.work_status);
        if (!alreadyApproved) {
          const readyCandidate = row.work_status === 'approval_pending' &&
            row.lifecycle_status === 'candidate' && row.is_active !== true;
          const hasMissingContent = (row.issues || []).some(issue => issue !== 'approval_pending');
          const main = makeButton(doc,
            readyCandidate ? 'Finaliser' : hasMissingContent ? 'Compléter' : 'Voir fiche',
            'open-catalog-inspector');
          main.className = 'kmc-workspace-action kmc-catalog-primary-action';
          actionCell.setAttribute('data-label', readyCandidate ? 'Finaliser' :
            hasMissingContent ? 'Compléter' : 'Consulter');
          main.addEventListener('click', async () => {
            if (!readyCandidate) {
              openProductInspector(context, slot, doc, row, categories);
              return;
            }
            // Un geste de finalisation unique, sans second bouton Enregistrer
            // ou Confirmer. Le backend contrôle tous ses invariants avant écriture.
            main.disabled = true;
            try {
              const diagnosis = await jsonRequest(context.fetch,
                ENDPOINT + '?diagnose_product_ref=' + encodeURIComponent(row.product_ref),
                { method: 'GET' });
              if (diagnosis?.phase !== 'catalog_approval' ||
                  diagnosis?.certification?.certified !== true) {
                const reasons = (diagnosis?.certification?.reasons || [])
                  .map(certificationReasonLabel);
                openProductInspector(context, slot, doc, row, categories);
                const panel = slot.querySelector('[data-catalog-product-inspector]');
                const feedback = panel?.querySelector('.kmc-catalog-inspector-feedback');
                if (feedback) feedback.textContent = reasons.length
                  ? 'Encore nécessaire : ' + reasons.join(' · ')
                  : 'La certification n’est pas encore acquise.';
                return;
              }
              const approved = await jsonRequest(context.fetch,
                ENDPOINT + '/approval/' + encodeURIComponent(row.product_ref) + '/approve',
                { method: 'POST' });
              if (!approved?.ok) throw new Error('Approbation non confirmée.');
              await context.reload();
              setFeedback(context.root, row.product_ref +
                ' · Catalogue conforme et approuvé. Aucun marché publié.', 'positive');
            } catch (error) {
              setFeedback(context.root, 'Finalisation impossible : ' +
                actionErrorMessage(error), 'critical');
            } finally { main.disabled = false; }
          });
          actionCell.appendChild(main);
          statusChip.addEventListener('click', () => main.click());
          tr.appendChild(actionCell);
          tbody.appendChild(tr);
          return;
        }
        const actions = doc.createElement('div');
        actions.className = 'kmc-catalog-actions-inner';
        const view = text(doc, 'a', 'kmc-workspace-action is-secondary kmc-catalog-view-link', 'Voir fiche');
        view.href = contextualHref('/admin/products/' + encodeURIComponent(row.product_ref),
          '/admin/workspaces/catalog?product_ref=' + encodeURIComponent(row.product_ref), 'Retour au Catalogue');
        // Seules des actions Catalogue et marché figurent ici.
        // Toute préparation fournisseur/éditoriale appartient à la Raffinerie.
        const editClassification = makeButton(doc, 'Modifier classement', 'classify-product', true);
        editClassification.addEventListener('click', () =>
          openProductClassificationDialog(context, row, categories, editClassification));
        const issues = row.issues || [];
        const market = text(doc, 'a', 'kmc-workspace-action is-secondary', 'Décisions marchés');
        market.href = '/dashboards/canonical/market-catalog.html?product_ref=' +
          encodeURIComponent(row.product_ref);
        const diagnose = makeButton(doc, 'Vérifier prérequis', 'diagnose-product', true);
        diagnose.addEventListener('click', () => {
          if (readinessCheck) readinessCheck.click();
        });
        // An already approved product is also a Catalogue dossier, not a
        // forced navigation to a second dashboard. Market decisions remain
        // separate audited authorities, accessible as a contextual extra.
        const primary = makeButton(doc, 'Dossier produit', 'open-catalog-inspector');
        primary.className = 'kmc-workspace-action kmc-catalog-primary-action';
        primary.setAttribute('aria-label', 'Consulter le dossier pour ' + row.product_ref);
        primary.addEventListener('click', () =>
          openProductInspector(context, slot, doc, row, categories));
        actions.appendChild(primary);
        statusChip.title = 'Consulter le dossier produit';
        statusChip.addEventListener('click', () => primary.click());
        const extra = doc.createElement('details');
        extra.className = 'kmc-catalog-row-more';
        const more = text(doc, 'summary', '', '···');
        more.title = 'Autres actions sur ce produit';
        more.setAttribute('aria-label', 'Autres actions pour ' + row.product_ref);
        extra.appendChild(more);
        const extraList = doc.createElement('div');
        extraList.className = 'kmc-catalog-row-more-list';
        [
          ['detail', view],
          ['classify', editClassification],
          // La Raffinerie n'est jamais une action secondaire du Catalogue finalisé.
          ...(row.lifecycle_status === 'active' && row.is_active ? [['markets', market]] : []),
        ].forEach(([kind, action]) => {
          if (kind !== nextStep.kind && !(kind === 'classify' && row.lifecycle_status === 'rejected')) {
            extraList.appendChild(action);
          }
        });
        if (extraList.children.length) {
          extra.appendChild(extraList);
          actions.appendChild(extra);
        }
        actionCell.appendChild(actions);
        tr.appendChild(actionCell);
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      const tableWrap = wrapTable(doc, table);
      tableWrap.className = (tableWrap.className || '') + ' kmc-catalog-registry-table-wrap';
      slot.appendChild(tableWrap);
    }
    const pager = doc.createElement('div');
    pager.className = 'kmc-workspace-section-actions kmc-catalog-registry-pager';
    pager.appendChild(text(doc, 'span', 'kmc-workspace-subtitle',
      (page.total ? page.offset + 1 : 0) + '–' + Math.min(page.offset + rows.length, page.total) +
      ' sur ' + formatNumber(page.total)));
    if (page.has_previous) {
      const previous = makeButton(doc, '← Précédents', 'catalog-previous', true);
      previous.addEventListener('click', async () => {
        context.catalogFilters.offset = Math.max(0, page.offset - page.limit);
        await context.reload();
      });
      pager.appendChild(previous);
    }
    if (page.has_next) {
      const next = makeButton(doc, 'Suivants →', 'catalog-next', true);
      next.addEventListener('click', async () => {
        context.catalogFilters.offset = page.offset + page.limit;
        await context.reload();
      });
      pager.appendChild(next);
    }
    slot.appendChild(pager);

  }

  function renderCommercial(rootNode, ui, doc, payload) {
    // The original CLOSED-KIR commercial projection remains available as a
    // distinct read-only view; it is no longer the Catalog's source of truth.
    const slot = createSection(rootNode, ui, 'Assortiment approuvé',
      'Vue commerciale distincte · KIR clos, exposition et prix local actif. Ne confond pas validation Catalogue et vente.');
    const details = slot;
    details.className = (details.className || '') + ' kmc-catalog-assortment-view';
    const commercialRows = payload.commercial_products || [];
    if (!commercialRows.length) {
      details.appendChild(text(doc, 'p', 'kmc-workspace-empty', 'Aucun produit actuellement approuvé pour la vente.'));
    } else {
      const commercialTable = doc.createElement('table');
      commercialTable.className = 'kmc-workspace-table';
      commercialTable.innerHTML = '<thead><tr><th>Produit</th><th>KIR clos</th><th>Marchés approuvés</th></tr></thead>';
      const body = doc.createElement('tbody');
      commercialRows.forEach(row => {
        const tr = doc.createElement('tr');
        tr.appendChild(td(doc, row.product_ref + ' · ' + row.name));
        tr.appendChild(td(doc, (row.source_lots || []).join(', ') || '—'));
        tr.appendChild(td(doc, (row.approved_markets || []).join(', ') || '—'));
        body.appendChild(tr);
      });
      commercialTable.appendChild(body);
      details.appendChild(wrapTable(doc, commercialTable));
      if (commercialRows.length === 200) {
        details.appendChild(text(doc, 'small', 'kmc-workspace-subtitle',
          '200 premières références affichées ; cet extrait ne représente pas un décompte exhaustif.'));
      }
    }

  }

  function renderTaxonomy(rootNode, ui, doc, payload, context) {
    const slot = createSection(rootNode, ui, 'Taxonomie boutique', 'Catégories et sous-catégories restent globales et pilotées en base ; aucun Market ID ne duplique la taxonomie.');
    const bar = doc.createElement('div');
    bar.className = 'kmc-workspace-section-actions';
    const create = makeButton(doc, 'Nouvelle catégorie', 'create-category');
    bar.appendChild(create);
    slot.appendChild(bar);
    create.addEventListener('click', () => {
      const key = context.prompt('Clé catégorie stable');
      if (!key) return;
      const label = context.prompt('Label affiché', key);
      if (!label) return;
      runAction(context, create, {
        url: `${ENDPOINT}/categories`,
        body: { key: key.trim(), label: label.trim() },
        successMessage: `Catégorie ${key} créée.`,
      });
    });

    const rows = payload.categories || [];
    if (!rows.length) {
      slot.appendChild(text(doc, 'div', 'kmc-workspace-empty', 'Aucune catégorie.'));
      return;
    }
    const table = doc.createElement('table');
    table.className = 'kmc-workspace-table';
    table.innerHTML = '<thead><tr><th>Clé</th><th>Catégorie</th><th>Sous-catégories</th><th>Rail</th><th>État</th><th></th></tr></thead>';
    const tbody = doc.createElement('tbody');
    rows.forEach(row => {
      const tr = doc.createElement('tr');
      tr.appendChild(td(doc, row.key));
      tr.appendChild(td(doc, row.label));
      tr.appendChild(td(doc, (row.subcategories || []).filter(sub => sub.is_active).map(sub => sub.label).join(', ')));
      tr.appendChild(td(doc, row.show_in_rail ? 'Oui' : 'Non'));
      tr.appendChild(td(doc, row.is_active ? 'Active' : 'Inactive'));
      const actions = doc.createElement('td');

      const edit = makeButton(doc, 'Renommer', 'update-category', true);
      edit.addEventListener('click', () => {
        const label = context.prompt(`Label · ${row.key}`, row.label || row.key);
        if (!label) return;
        runAction(context, edit, {
          url: `${ENDPOINT}/categories/${encodeURIComponent(row.key)}/update`,
          body: { label: label.trim() },
          successMessage: `${row.key} mise à jour.`,
        });
      });
      actions.appendChild(edit);

      const sub = makeButton(doc, 'Ajouter sous-catégorie', 'create-subcategory', true);
      sub.addEventListener('click', () => {
        const subKey = context.prompt(`Clé sous-catégorie · ${row.key}`);
        if (!subKey) return;
        const label = context.prompt('Label affiché', subKey);
        if (!label) return;
        runAction(context, sub, {
          url: `${ENDPOINT}/categories/${encodeURIComponent(row.key)}/subcategories`,
          body: { key: subKey.trim(), label: label.trim() },
          successMessage: `${row.key}/${subKey} créée.`,
        });
      });
      actions.appendChild(sub);

      const toggle = makeButton(doc, row.is_active ? 'Désactiver' : 'Réactiver', 'toggle-category', true);
      toggle.addEventListener('click', () => {
        if (!context.confirm(`${row.is_active ? 'Désactiver' : 'Réactiver'} ${row.key} ?`)) return;
        runAction(context, toggle, {
          url: row.is_active
            ? `${ENDPOINT}/categories/${encodeURIComponent(row.key)}/deactivate`
            : `${ENDPOINT}/categories/${encodeURIComponent(row.key)}/update`,
          body: row.is_active ? {} : { is_active: true },
          successMessage: `${row.key} mise à jour.`,
        });
      });
      actions.appendChild(toggle);
      tr.appendChild(actions);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    const wrap = doc.createElement('div');
    wrap.className = 'kmc-workspace-table-wrap';
    wrap.appendChild(table);
    slot.appendChild(wrap);
  }

  function renderFocusedHandoff(rootNode, ui, doc, payload) {
    const handoff = payload && payload.focused_handoff;
    if (!handoff || !handoff.product_ref) return;

    const slot = createSection(
      rootNode,
      ui,
      `Suite commerciale · ${handoff.product_ref}`,
      'Le produit est publié dans le Catalogue global. Il reste visible ici tant que sa décision marché et son prix local ne sont pas terminés.'
    );

    slot.appendChild(text(
      doc,
      'p',
      'kmc-workspace-subtitle',
      handoff.state === 'BUYER_VISIBLE'
        ? 'Produit visible acheteur sur tous les marchés actifs.'
        : 'Publication Catalogue terminée · décision commerciale marché encore requise.'
    ));

    const table = doc.createElement('table');
    table.className = 'kmc-workspace-table';
    table.innerHTML = '<thead><tr><th>Marché</th><th>Exposition</th><th>Prix local</th><th>État Boutique</th><th>Suite</th></tr></thead>';
    const tbody = doc.createElement('tbody');

    (handoff.markets || []).forEach(market => {
      const tr = doc.createElement('tr');
      tr.setAttribute('data-market-code', market.code || '');
      tr.appendChild(td(doc, market.name ? `${market.name} · ${market.code}` : market.code));
      tr.appendChild(td(
        doc,
        market.exposure_decision_recorded
          ? market.commercial_exposure
          : 'À décider'
      ));
      tr.appendChild(td(
        doc,
        marketPriceLabel(market)
      ));
      tr.appendChild(td(doc, market.buyer_visible ? 'Visible' : 'Non visible'));

      const action = doc.createElement('td');
      const link = text(
        doc,
        'a',
        'kmc-workspace-action',
        market.buyer_visible ? 'Ouvrir le marché' : 'Continuer la mise en vente'
      );
      const params = new URLSearchParams({
        market: market.code,
        product_ref: handoff.product_ref,
      });
      link.href = `/dashboards/canonical/market-catalog.html?${params.toString()}#market-ready-to-sell`;
      action.appendChild(link);
      tr.appendChild(action);
      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    slot.appendChild(wrapTable(doc, table));
  }

  function renderPayload(rootNode, ui, doc, payload, context) {
    rootNode.className = 'kmc-operations-workspace';
    rootNode.replaceChildren();
    const refinery = context.workspaceView === 'refinery';
    rootNode.appendChild(createHeader(doc, refinery));
    if (refinery) {
      renderRefineryMonitoring(rootNode, ui, doc, payload);
      return;
    }
    renderCatalogTabs(rootNode, doc, context);
    if (context.catalogTab === 'assortment') {
      renderFocusedHandoff(rootNode, ui, doc, payload);
      renderCommercial(rootNode, ui, doc, payload);
    } else if (context.catalogTab === 'taxonomy') {
      renderTaxonomy(rootNode, ui, doc, payload, context);
    } else {
      renderProducts(rootNode, ui, doc, payload, context);
    }
  }

  async function mount(options = {}) {
    const rootNode = options.root;
    const doc = options.document;
    const ui = options.ui;
    const fetchFn = options.fetch;
    if (!rootNode || !doc || !ui || typeof fetchFn !== 'function') {
      throw new Error('canonical_catalog_workspace_dependencies_missing');
    }
    const locationSearch = options.location && typeof options.location.search === 'string'
      ? options.location.search
      : (typeof globalThis !== 'undefined' && globalThis.location ? globalThis.location.search : '');
    let focusedProductRef = null;
    try {
      focusedProductRef = new URLSearchParams(locationSearch || '').get('product_ref');
    } catch (_) {
      focusedProductRef = null;
    }
    const context = {
      // Historical ?view=refinery routes now land on the master Catalogue.
      // Explicit diagnostic mode retains the read-only technical monitoring.
      workspaceView: new URLSearchParams(locationSearch || '').get('view') === 'refinery' &&
        new URLSearchParams(locationSearch || '').get('diagnostic') === '1' ? 'refinery' : 'catalog',
      catalogTab: ['registry', 'assortment', 'taxonomy'].includes(new URLSearchParams(locationSearch || '').get('tab'))
        ? new URLSearchParams(locationSearch || '').get('tab') : 'registry',
      root: rootNode,
      document: doc,
      user: options.user || {},
      fetch: fetchFn,
      confirm: options.confirm || (typeof window !== 'undefined' ? window.confirm.bind(window) : () => true),
      prompt: options.prompt || (typeof window !== 'undefined' ? window.prompt.bind(window) : () => null),
      reload: null,
      // Hook de présentation : rejoué après CHAQUE rendu (le rendu vide la racine).
      afterRender: typeof options.afterRender === 'function' ? options.afterRender : null,
      approvalLimit: 50,
      approvalOffset: 0,
      refineryOffset: 0,
      refineryRecheckOffset: 0,
      catalogFilters: {
        search: new URLSearchParams(locationSearch || '').get('search') || '',
        supplier: '', category: '', subcategory: '', status: '', offset: 0,
      },
      focusedProductRef: String(focusedProductRef || '').trim() || null,
      autoFrenchAttempted: new Set(),
      autoFrenchFailed: new Set(),
      autoFrenchRunning: false,
    };
    context.reload = async (reloadOptions = {}) => {
      try {
        const params = new URLSearchParams({
          ...(context.workspaceView === 'refinery'
            ? { include_readiness: '1', refinery_view: '1', refinery_limit: '30',
              refinery_offset: String(context.refineryOffset),
              refinery_recheck_offset: String(context.refineryRecheckOffset) }
            : {}),
          approval_limit: String(context.approvalLimit),
          approval_offset: String(context.approvalOffset),
        });
        if (context.focusedProductRef) params.set('product_ref', context.focusedProductRef);
        if (context.workspaceView !== 'refinery') {
          params.set('unified', '1');
          const filters = context.catalogFilters;
          ['search', 'supplier', 'category', 'subcategory', 'status'].forEach(key => {
            if (filters[key]) params.set(key, filters[key]);
          });
          params.set('catalog_limit', '50');
          params.set('catalog_offset', String(filters.offset || 0));
        }
        const payload = await jsonRequest(fetchFn, `${ENDPOINT}?${params.toString()}`);
        renderPayload(rootNode, ui, doc, payload, context);
        if (context.afterRender) context.afterRender(payload);
        activeContext = context;
        activePayload = payload;
        // No browser-triggered preparation: workers and explicit Catalogue actions own mutations.
        return payload;
      } catch (error) {
        rootNode.replaceChildren();
        const panel = doc.createElement('section');
        panel.className = 'kmc-workspace-header';
        panel.appendChild(text(doc, 'span', 'kmc-workspace-kicker', context.workspaceView === 'refinery' ? 'WORKSPACE · RAFFINERIE' : 'WORKSPACE · CATALOGUE'));
        panel.appendChild(text(doc, 'h1', 'kmc-workspace-title', context.workspaceView === 'refinery' ? 'Raffinerie indisponible' : 'Catalogue indisponible'));
        panel.appendChild(text(doc, 'p', 'kmc-workspace-subtitle', error.message));
        rootNode.appendChild(panel);
        throw error;
      }
    };
    return context.reload();
  }

  return Object.freeze({
    ENDPOINT,
    metricItems,
    stageLabel,
    curationState,
    openCatalogCompare,
    closeCatalogCompare,
    frenchAssistantPrompt,
    parseFrenchAssistantOutput,
    sourceLanguageTag,
    autoTranslateFrench,
    autoPrepareFrenchQueue,
    scheduleAutoFrenchPreparation,
    suggestBoutiquePair,
    hasPrimedFrenchTranslator,
    resumeAutoFrenchPreparation,
    mount,
  });
});
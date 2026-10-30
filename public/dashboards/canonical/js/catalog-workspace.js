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
      copy.appendChild(text(doc, 'p', 'kmc-workspace-subtitle', 'Préparer, contrôler et soumettre les fiches à validation. Les prix se décident dans l’Atelier.'));
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
      const successMessage = options.successMessage || 'Action appliquée.';
      setFeedback(context.root, successMessage, 'positive');
      setInlineActionFeedback(inlineFeedback, successMessage, 'positive');
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
    const cost = Number(row.cost_kmf);
    const costText = Number.isFinite(cost) && cost > 0
      ? `Coût d’achat estimé : ${formatKmf(cost)} (estimation, pas un coût réel).`
      : 'Coût d’achat estimé non renseigné.';
    if (hasGlobalReferencePrice(row)) return `Prix de référence global : ${formatKmf(row.price_kmf)}. ${costText}`;
    if (hasPublishablePrice(row)) {
      return `Référence globale sans prix : validation Catalogue possible. Le responsable pays décide ensuite du prix local ; aucune mise en vente acheteur avant LOCAL_ACTIVE. ${costText}`;
    }
    return `Prix global manquant ou invalide : ce produit non sourcé reste bloqué à la publication. ${costText}`;
  }

  function marketPriceLabel(market = {}) {
    if (market.price_status === 'LOCAL_ACTIVE') {
      return `Prix local actif · ${market.local_price_amount == null ? '—' : market.local_price_amount} ${market.local_price_currency || market.currency || ''}`.trim();
    }
    if (market.price_status === 'LOCAL_MARKET_DECISION') return 'Prix local en brouillon, à activer';
    if (market.price_status === 'LOCAL_AUTHORIZED_PENDING_CUTOVER') return 'Prix local autorisé, bascule en attente';
    if (!market.price_status) return 'Prix local non défini pour ce marché : non visible acheteur';
    return market.price_status;
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
    // La préparation FR appartient exclusivement à la Raffinerie.
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
        ? 'Correction éditoriale Raffinerie d’un produit déjà actif : la source reste intacte. Aucun prix, stock ou marché n’est modifié.'
        : 'La source fournisseur reste intacte. Le français est enregistré comme override tracé, puis relu avant validation Catalogue.'
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
    grid.appendChild(sourcePane);

    const frenchPane = doc.createElement('section');
    frenchPane.className = 'kmc-catalog-fr-editor-pane is-french';
    frenchPane.appendChild(text(doc, 'strong', 'kmc-catalog-fr-pane-title', 'Français'));

    const assistantActions = doc.createElement('div');
    assistantActions.className = 'kmc-catalog-fr-assistant-actions';
    const copy = makeButton(doc, 'Copier pour ChatGPT', 'copy-fr-editor', true);
    assistantActions.appendChild(copy);
    const paste = makeButton(doc, 'Coller la réponse', 'paste-fr-editor', true);
    assistantActions.appendChild(paste);
    frenchPane.appendChild(assistantActions);

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
        setEditorFeedback(status, 'Titre et description récupérés automatiquement. Vérifiez puis enregistrez.', 'positive');
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
          ? 'Description facultative : enregistrez un brouillon ou validez que le contenu actuel suffit.'
          : '';
      });
    });
    const submitFrench = async (accept = false) => {
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
            : `${row.product_ref} : brouillon français enregistré, travail restant en Raffinerie.`, 'positive');
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
        successMessage: `${row.product_ref} préparé en français sans API IA payante. Vérifiez Avant / après puis validez.`,
      });
    };
    save.addEventListener('click', () => submitFrench(false));
    const validate = activeRecheck
      ? makeButton(doc, 'Valider le contenu actuel', 'validate-fr-sufficient') : null;
    if (validate) {
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

  // Raffinerie = travail éditorial et certification, jamais registre commercial.
  // La projection de diagnostic n'autorise aucune mutation ni approbation.
  function renderRefineryCoverage(slot, doc, payload, context) {
    const data = payload.refinery;
    if (!data || !data.coverage) {
      slot.appendChild(text(doc, 'p', 'kmc-refinery-warning',
        'Diagnostic de préparation indisponible : impossible de conclure que la Raffinerie est vide.'));
      return;
    }
    const coverage = data.coverage;
    const overview = doc.createElement('div');
    overview.className = 'kmc-refinery-coverage';
    [
      ['En validation', coverage.in_approval_queue, 'Brouillons dans la file de contrôle'],
      ['Source à qualifier', coverage.unprepared_candidates, 'Brouillons absents de la file de validation'],
      ['Actifs à réexaminer', coverage.active_recheck, 'Remis, actifs, mais contrôles encore incomplets'],
      ['Déjà actifs après remise', coverage.handoff_already_active, 'Contexte historique, non assimilable à une approbation'],
    ].forEach(([label, value, hint]) => {
      const tile = doc.createElement('div');
      tile.className = 'kmc-refinery-count';
      tile.appendChild(text(doc, 'strong', 'kmc-refinery-count-value', formatNumber(value || 0)));
      tile.appendChild(text(doc, 'span', 'kmc-refinery-count-label', label));
      tile.appendChild(text(doc, 'small', 'kmc-refinery-count-hint', hint));
      overview.appendChild(tile);
    });
    slot.appendChild(overview);

    const recheckRows = Array.isArray(data.recheck) ? data.recheck : [];
    const recheckPage = data.recheck_page || { total: recheckRows.length, limit: 30, offset: 0 };
    if (Number(recheckPage.total) > 0) {
      const heading = doc.createElement('div');
      heading.className = 'kmc-refinery-subsection';
      heading.appendChild(text(doc, 'h3', '', 'Produits actifs à réexaminer'));
      heading.appendChild(text(doc, 'p', 'kmc-workspace-subtitle',
        'Des produits déjà actifs présentent encore des défauts de préparation. Leur présence ici ne les suspend pas des marchés : vérifier avant toute décision de retrait.'));
      slot.appendChild(heading);
      const table = doc.createElement('table');
      table.className = 'kmc-workspace-table kmc-refinery-unprepared-table';
      table.innerHTML = '<thead><tr><th>Produit</th><th>Fournisseur</th><th>Contrôles en écart</th><th>Action</th></tr></thead>';
      const body = doc.createElement('tbody');
      const reasons = {
        source_to_normalize: 'Source fournisseur à vérifier',
        taxonomy_to_confirm: 'Classement Boutique à confirmer',
        editorial_to_complete: 'Fiche française à compléter',
      };
      recheckRows.forEach(row => {
        const tr = doc.createElement('tr');
        const name = doc.createElement('td');
        const returnPath = `/admin/workspaces/catalog?view=refinery&product_ref=${encodeURIComponent(row.product_ref)}`;
        const editorRequired = (row.issues || []).includes('editorial_to_complete');
        const detailPath = contextualHref(`/admin/products/${encodeURIComponent(row.product_ref)}`,
          returnPath, 'Retour à la Raffinerie');
        const detail = text(doc, editorRequired ? 'button' : 'a',
          'kmc-refinery-product-link', row.name || row.product_ref);
        if (editorRequired) {
          detail.type = 'button';
          detail.className += ' kmc-refinery-edit-trigger';
          detail.setAttribute('aria-label', 'Corriger la fiche française de ' + row.product_ref);
          detail.addEventListener('click', () => openFrenchEditor(context, row, detail));
        } else {
          detail.href = detailPath;
        }
        name.appendChild(detail);
        name.appendChild(text(doc, 'small', 'kmc-workspace-subtitle', row.product_ref || '—'));
        tr.appendChild(name);
        tr.appendChild(td(doc, row.supplier_name || 'Provenance à vérifier'));
        const issue = doc.createElement('td');
        (row.issues || []).forEach(code => {
          issue.appendChild(text(doc, 'div', 'kmc-refinery-issue-label', reasons[code] || code));
        });
        tr.appendChild(issue);
        const action = doc.createElement('td');
        if (editorRequired) {
          const correct = makeButton(doc, 'Corriger la fiche FR', 'refinery-correct-active-fr');
          correct.className += ' kmc-refinery-recheck-primary';
          correct.addEventListener('click', () => openFrenchEditor(context, row, correct));
          action.appendChild(correct);
          const view = text(doc, 'a', 'kmc-workspace-nav-link', 'Voir Produit 360');
          view.href = detailPath;
          action.appendChild(view);
        } else {
          const inspect = text(doc, 'a', 'kmc-workspace-action', 'Examiner le produit');
          inspect.href = detailPath;
          action.appendChild(inspect);
        }
        tr.appendChild(action);
        body.appendChild(tr);
      });
      table.appendChild(body);
      const wrap = doc.createElement('div');
      wrap.className = 'kmc-workspace-table-wrap kmc-refinery-unprepared-wrap';
      wrap.appendChild(table);
      slot.appendChild(wrap);
      const pager = doc.createElement('div');
      pager.className = 'kmc-refinery-pager';
      pager.appendChild(text(doc, 'span', 'kmc-workspace-subtitle',
        `${recheckPage.total ? recheckPage.offset + 1 : 0}–${Math.min(recheckPage.offset + recheckRows.length, recheckPage.total)} sur ${formatNumber(recheckPage.total)} actif(s) à réexaminer`));
      if (recheckPage.has_previous) {
        const previous = makeButton(doc, '← Précédents', 'refinery-recheck-previous', true);
        previous.addEventListener('click', async () => {
          context.refineryRecheckOffset = Math.max(0, recheckPage.offset - recheckPage.limit);
          await context.reload();
        });
        pager.appendChild(previous);
      }
      if (recheckPage.has_next) {
        const next = makeButton(doc, 'Suivants →', 'refinery-recheck-next', true);
        next.addEventListener('click', async () => {
          context.refineryRecheckOffset = recheckPage.offset + recheckPage.limit;
          await context.reload();
        });
        pager.appendChild(next);
      }
      slot.appendChild(pager);
    }

    const rows = Array.isArray(data.unprepared) ? data.unprepared : [];
    const page = data.unprepared_page || { total: rows.length, limit: 30, offset: 0 };
    if (Number(page.total) > 0) {
      const heading = doc.createElement('div');
      heading.className = 'kmc-refinery-subsection';
      heading.appendChild(text(doc, 'h3', '', 'Fiches à qualifier'));
      heading.appendChild(text(doc, 'p', 'kmc-workspace-subtitle',
        'Ces brouillons existent, mais leur origine éditoriale ne permet pas leur entrée dans la file de validation. Diagnostic uniquement ; aucune publication.'));
      slot.appendChild(heading);
      const table = doc.createElement('table');
      table.className = 'kmc-workspace-table kmc-refinery-unprepared-table';
      table.innerHTML = '<thead><tr><th>Produit</th><th>Provenance</th><th>À examiner</th><th>Action</th></tr></thead>';
      const tbody = doc.createElement('tbody');
      rows.forEach(row => {
        const tr = doc.createElement('tr');
        const name = doc.createElement('td');
        const detailPath = `/admin/products/${encodeURIComponent(row.product_ref)}`;
        const returnPath = `/admin/workspaces/catalog?view=refinery&product_ref=${encodeURIComponent(row.product_ref)}`;
        const product = text(doc, 'a', 'kmc-refinery-product-link', row.name || row.product_ref);
        product.href = contextualHref(detailPath, returnPath, 'Retour à la Raffinerie');
        name.appendChild(product);
        name.appendChild(text(doc, 'small', 'kmc-workspace-subtitle', row.product_ref || '—'));
        tr.appendChild(name);
        tr.appendChild(td(doc, row.supplier_name || 'Provenance à vérifier'));
        const issue = doc.createElement('td');
        const reason = row.reason || {};
        issue.appendChild(text(doc, 'strong', 'kmc-refinery-issue-label', reason.label || 'Diagnostic à examiner'));
        issue.appendChild(text(doc, 'small', 'kmc-workspace-subtitle', reason.detail || ''));
        tr.appendChild(issue);
        const action = doc.createElement('td');
        const inspect = text(doc, 'a', 'kmc-workspace-action', 'Examiner la fiche');
        inspect.href = product.href;
        action.appendChild(inspect);
        if (row.candidate_ref) {
          const source = text(doc, 'a', 'kmc-workspace-nav-link', 'Voir source');
          source.href = contextualHref(
            `/admin/workspaces/sourcing?candidate_ref=${encodeURIComponent(row.candidate_ref)}`,
            returnPath,
            'Retour à la Raffinerie'
          );
          action.appendChild(source);
        }
        tr.appendChild(action);
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      const wrap = doc.createElement('div');
      wrap.className = 'kmc-workspace-table-wrap kmc-refinery-unprepared-wrap';
      wrap.appendChild(table);
      slot.appendChild(wrap);
      const pager = doc.createElement('div');
      pager.className = 'kmc-refinery-pager';
      pager.appendChild(text(doc, 'span', 'kmc-workspace-subtitle',
        `${page.total ? page.offset + 1 : 0}–${Math.min(page.offset + rows.length, page.total)} sur ${formatNumber(page.total)} fiche(s) à qualifier`));
      if (page.has_previous) {
        const previous = makeButton(doc, '← Précédentes', 'refinery-unprepared-previous', true);
        previous.addEventListener('click', async () => {
          context.refineryOffset = Math.max(0, page.offset - page.limit);
          await context.reload();
        });
        pager.appendChild(previous);
      }
      if (page.has_next) {
        const next = makeButton(doc, 'Suivantes →', 'refinery-unprepared-next', true);
        next.addEventListener('click', async () => {
          context.refineryOffset = page.offset + page.limit;
          await context.reload();
        });
        pager.appendChild(next);
      }
      slot.appendChild(pager);
    }
  }

  function renderApproval(rootNode, ui, doc, payload, context) {
    const slot = createSection(rootNode, ui, 'Préparation et validation', 'Préparez les fiches produit puis soumettez-les à la validation humaine. Les prix restent sous l’autorité de l’Atelier.');
    if (slot.parentNode) slot.parentNode.className += ' kmc-refinery-main-panel';
    renderRefineryCoverage(slot, doc, payload, context);
    const rows = payload.approval || [];
    const breakdown = payload.approval_breakdown || {};
    const strategy = payload.approval_strategy || {};
    const page = payload.approval_page || {
      total: rows.length,
      limit: context.approvalLimit,
      offset: context.approvalOffset,
      has_previous: context.approvalOffset > 0,
      has_next: false,
    };
    if (!rows.length) {
      const empty = doc.createElement('div');
      empty.className = 'kmc-refinery-empty';
      empty.appendChild(text(doc, 'strong', '', 'Aucune fiche dans la file de validation.'));
      const pending = Number(payload.refinery?.coverage?.unprepared_candidates) || 0;
      const recheck = Number(payload.refinery?.coverage?.active_recheck) || 0;
      const active = Number(payload.refinery?.coverage?.handoff_already_active) || 0;
      empty.appendChild(text(doc, 'p', '', pending
        ? `${formatNumber(pending)} fiche(s) nécessitent encore une qualification du contenu, affichées ci-dessus.`
        : recheck
          ? `${formatNumber(recheck)} produit(s) actifs à réexaminer dans la file dédiée ci-dessus.`
          : active
            ? `${formatNumber(active)} produit(s) déjà actifs après une remise Sourcing ; aucun nouveau travail Raffinerie identifié.`
            : 'Aucun brouillon en préparation identifié. Vérifiez les remises depuis le Sourcing si des produits sont attendus.'));
      const sourcing = text(doc, 'a', 'kmc-workspace-nav-link', 'Ouvrir le Sourcing');
      sourcing.href = '/admin/workspaces/sourcing';
      empty.appendChild(sourcing);
      slot.appendChild(empty);
      return;
    }
    const queueTitle = doc.createElement('div');
    queueTitle.className = 'kmc-refinery-subsection';
    queueTitle.appendChild(text(doc, 'h3', '', 'En attente de contrôle et validation'));
    queueTitle.appendChild(text(doc, 'p', 'kmc-workspace-subtitle',
      'La présence dans cette file ne vaut ni certification ni autorisation de publication.'));
    slot.appendChild(queueTitle);
    const summary = doc.createElement('div');
    summary.className = 'kmc-workspace-section-actions';
    ['PRIORITY', 'TEST', 'WATCH', 'AVOID', 'LOSS', 'UNKNOWN'].forEach(key => {
      const count = Number(breakdown[key]) || 0;
      if (!count && key !== 'UNKNOWN') return;
      summary.appendChild(text(doc, 'span', `kmc-workspace-feedback ${sourcingDecisionTone(key)}`, `${sourcingDecisionLabel(key)} · ${formatNumber(count)}`));
    });
    slot.appendChild(summary);
    slot.appendChild(renderCurationChain(doc, rows, page));
    if (strategy.value_density_used === false) {
      slot.appendChild(text(doc, 'p', 'kmc-workspace-subtitle', 'Classement indicatif : signal sourcing + confiance + stock. Densité de valeur non utilisée tant qu’elle n’est pas calibrée.'));
    }

    const table = doc.createElement('table');
    table.className = 'kmc-workspace-table kmc-catalog-curation-table';
    table.innerHTML = '<thead><tr><th>Produit</th><th>Catégorie</th><th>Signal sourcing</th><th>État</th><th>Action</th></tr></thead>';
    const tbody = doc.createElement('tbody');
    rows.forEach(row => {
      const tr = doc.createElement('tr');
      tr.setAttribute('data-product-ref', row.product_ref || '');
      const productCell = doc.createElement('td');
      productCell.className = 'kmc-catalog-product-cell';
      const returnTo = row.product_ref
        ? `/admin/workspaces/catalog?view=refinery&product_ref=${encodeURIComponent(row.product_ref)}`
        : '/admin/workspaces/catalog';
      const productTitle = text(doc, 'a', 'kmc-catalog-product-title', row.name || row.product_ref);
      productTitle.href = contextualHref(
        `/admin/products/${encodeURIComponent(row.product_ref)}`,
        returnTo,
        'Retour à la curation'
      );
      productCell.appendChild(productTitle);

      const productMeta = doc.createElement('div');
      productMeta.className = 'kmc-catalog-product-meta';
      const refLink = text(doc, 'a', 'kmc-workspace-nav-link', row.product_ref);
      refLink.href = productTitle.href;
      productMeta.appendChild(refLink);
      productMeta.appendChild(text(
        doc,
        'span',
        'kmc-workspace-subtitle',
        `${formatSource(row)}${row.supplier_name ? ` · ${row.supplier_name}` : ''}`
      ));
      productCell.appendChild(productMeta);
      appendBeforeAfter(context, productCell, row);
      tr.appendChild(productCell);

      tr.appendChild(td(doc, row.category));

      const signalCell = doc.createElement('td');
      signalCell.className = 'kmc-catalog-signal-cell';
      const signalContent = doc.createElement('div');
      signalContent.className = 'kmc-catalog-cell-stack';
      signalContent.appendChild(text(doc, 'strong', sourcingDecisionTone(row.sourcing_decision), sourcingDecisionLabel(row.sourcing_decision)));
      const signalMeta = [
        row.sourcing_confidence ? `confiance ${row.sourcing_confidence}` : null,
        row.economic_health_status ? `santé ${row.economic_health_status}` : null,
        row.supplier_stock == null ? null : `stock fournisseur ${formatNumber(row.supplier_stock)}`,
      ].filter(Boolean).join(' · ');
      if (signalMeta) signalContent.appendChild(text(doc, 'small', 'kmc-workspace-subtitle', signalMeta));
      signalContent.appendChild(text(doc, 'small', 'kmc-catalog-reason', row.sourcing_reason || 'Aucune raison sourcing persistée.'));
      signalCell.appendChild(signalContent);
      tr.appendChild(signalCell);

      const state = curationState(row);
      const stateCell = doc.createElement('td');
      stateCell.className = 'kmc-catalog-state-cell';
      const stateContent = doc.createElement('div');
      stateContent.className = 'kmc-catalog-cell-stack';
      stateContent.appendChild(text(doc, 'strong', state.tone, state.label));
      if (row.certification) {
        const reasons = Array.isArray(row.certification.reasons) ? row.certification.reasons : [];
        const next = reasons.length
          ? reasons.map(certificationReasonLabel).join(' · ')
          : 'Contrôles de certification satisfaits · validation humaine requise';
        const details = text(doc, 'small', 'kmc-workspace-subtitle', next);
        details.setAttribute('data-refinery-readiness', row.certification.certified ? 'ready' : 'blocked');
        stateContent.appendChild(details);
      }

      const classNote = classificationNote(row);
      if (classNote) {
        const flag = text(doc, 'small', 'kmc-workspace-subtitle', classNote);
        flag.setAttribute('data-classification-status', 'fallback_unresolved');
        stateContent.appendChild(flag);
      }
      const priceNote = text(doc, 'small', 'kmc-workspace-subtitle', priceExplanation(row));
      priceNote.setAttribute('data-price-explanation', '');
      stateContent.appendChild(priceNote);
      stateCell.appendChild(stateContent);
      tr.appendChild(stateCell);

      const actions = doc.createElement('td');
      actions.className = 'kmc-catalog-actions-cell';
      const actionContent = doc.createElement('div');
      actionContent.className = 'kmc-catalog-actions-inner';
      const actionFeedback = text(doc, 'div', 'kmc-catalog-action-feedback', '');
      actionFeedback.setAttribute('data-catalog-action-feedback', '');
      actionFeedback.setAttribute('role', 'status');

      const mustPrepareFrench = needsFrenchPreparation(row);
      const priceReady = hasPublishablePrice(row);
      if (mustPrepareFrench) {
        const autoPending = hasPrimedFrenchTranslator(row) && !context.autoFrenchFailed.has(row.product_ref);
        if (autoPending) {
          const pending = makeButton(doc, 'Préparation FR automatique…', 'prepare-fr-auto', true);
          pending.disabled = true;
          actionContent.appendChild(pending);
        } else {
          const copy = makeButton(doc, 'Copier pour ChatGPT', 'copy-fr', true);
          copy.addEventListener('click', async () => {
            try {
              await copyForAssistant(context, row);
            } catch (error) {
              setFeedback(context.root, error.message || 'Copie impossible.', 'critical');
            }
          });
          actionContent.appendChild(copy);

          const prepare = makeButton(doc, 'Préparer en français', 'prepare-fr');
          prepare.addEventListener('click', async () => openFrenchEditor(context, row, prepare));
          actionContent.appendChild(prepare);
        }
      } else if (!priceReady) {
        const pricing = text(doc, 'a', 'kmc-workspace-action is-price', 'Définir le prix');
        pricing.setAttribute('data-workspace-action', 'define-price');
        const nav = globalThis.KomerceCanonicalNavigation;
        const basePricingPath = `/admin/workspaces/pricing?product_ref=${encodeURIComponent(row.product_ref)}`;
        // Marché / période / périmètre de la page transportés quand ils existent (aucun paramètre inventé).
        const pricingPath = nav && typeof nav.withContext === 'function'
          ? nav.withContext(basePricingPath, nav.readContext(globalThis.location && globalThis.location.search))
          : basePricingPath;
        const returnTo = `/admin/workspaces/catalog?view=refinery&product_ref=${encodeURIComponent(row.product_ref)}`;
        pricing.href = `${contextualHref(pricingPath, returnTo, 'Retour à la curation')}#pricing-products`;
        actionContent.appendChild(pricing);
      } else {
        const approveLabel = (row.needs_review || row.content_source === 'manual')
          ? 'Valider après relecture'
          : 'Ajouter à la sélection';
        const approve = makeButton(doc, approveLabel, 'approve');
        approve.className += ' is-approve';
        approve.addEventListener('click', async () => {
          if (!context.confirm(`Ajouter ${row.product_ref} · ${row.name} à la sélection publiée ?`)) return;
          await runAction(context, approve, {
            url: `${ENDPOINT}/approval/${encodeURIComponent(row.product_ref)}/approve`,
            successMessage: `${row.product_ref} ajouté à la sélection publiée.`,
            feedbackTarget: actionFeedback,
          });
        });
        actionContent.appendChild(approve);
      }

      const correct = makeButton(doc, 'Corriger + ajouter', 'override', true);
      correct.addEventListener('click', () => {
        const name = context.prompt('Nom corrigé', row.name || '');
        if (name == null) return;
        const description = context.prompt('Description corrigée', row.description || '');
        if (description == null) return;
        const category = context.prompt('Catégorie corrigée', row.category || '');
        if (category == null) return;
        const reason = context.prompt('Raison de la correction', '') || undefined;
        const fields = {};
        if (name.trim() !== String(row.name || '').trim()) fields.name = name.trim();
        if (description.trim() !== String(row.description || '').trim()) fields.description = description.trim();
        if (category.trim() !== String(row.category || '').trim()) fields.category = category.trim();
        if (!Object.keys(fields).length) {
          setFeedback(context.root, 'Aucun champ modifié.', 'critical');
          return;
        }
        runAction(context, correct, {
          url: `${ENDPOINT}/approval/${encodeURIComponent(row.product_ref)}/override`,
          body: { fields, reason },
          successMessage: `${row.product_ref} corrigé puis ajouté à la sélection.`,
          feedbackTarget: actionFeedback,
        });
      });
      if (!mustPrepareFrench && priceReady) actionContent.appendChild(correct);

      const reject = makeButton(doc, 'Écarter', 'reject', true);
      reject.className += ' is-danger';
      reject.addEventListener('click', () => {
        const reason = context.prompt(`Raison pour écarter ${row.product_ref}`);
        if (!reason || !reason.trim()) return;
        runAction(context, reject, {
          url: `${ENDPOINT}/approval/${encodeURIComponent(row.product_ref)}/reject`,
          body: { reason: reason.trim() },
          successMessage: `${row.product_ref} écarté de la sélection.`,
          feedbackTarget: actionFeedback,
        });
      });
      actionContent.appendChild(reject);
      actions.appendChild(actionContent);
      actions.appendChild(actionFeedback);
      tr.appendChild(actions);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    const wrap = doc.createElement('div');
    wrap.className = 'kmc-workspace-table-wrap';
    wrap.appendChild(table);
    slot.appendChild(wrap);

    const pager = doc.createElement('div');
    pager.className = 'kmc-workspace-section-actions';
    const start = page.total ? page.offset + 1 : 0;
    const end = Math.min(page.offset + rows.length, page.total);
    pager.appendChild(text(doc, 'span', 'kmc-workspace-subtitle', `${start}–${end} sur ${formatNumber(page.total)} candidat(s)`));

    if (page.has_previous) {
      const previous = makeButton(doc, '← Précédents', 'approval-previous', true);
      previous.addEventListener('click', async () => {
        context.approvalOffset = Math.max(0, page.offset - page.limit);
        await context.reload();
      });
      pager.appendChild(previous);
    }

    if (page.has_next) {
      const next = makeButton(doc, 'Suivants →', 'approval-next', true);
      next.addEventListener('click', async () => {
        context.approvalOffset = page.offset + page.limit;
        await context.reload();
      });
      pager.appendChild(next);
    }
    slot.appendChild(pager);
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
      return { kind: 'refinery', label: 'Examiner pour validation', status: 'À valider en Raffinerie' };
    }
    if (row.work_status === 'catalog_approved' && row.is_active === true) {
      return { kind: 'markets', label: 'Décisions marchés', status: 'Approuvé Catalogue' };
    }
    return { kind: 'diagnose', label: 'Vérifier prérequis', status: 'À diagnostiquer' };
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
    categorySelect.addEventListener('change', () => {
      refresh('');
      note.textContent = 'Vérifiez le nouveau classement avant de l’enregistrer.';
      feedback.textContent = '';
    });
    subcategorySelect.addEventListener('change', () => {
      save.disabled = !categorySelect.value || !subcategorySelect.value;
      feedback.textContent = '';
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
      });
      if (result) close();
    });
    doc.body.appendChild(dialog);
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    if (typeof categorySelect.focus === 'function') categorySelect.focus();
  }


  function registryCorrectionItems(row = {}) {
    const issues = Array.isArray(row.issues) ? row.issues : [];
    if (row.lifecycle_status === 'rejected') return [{ code: 'rejected', label: 'Décision de rejet à examiner' }];
    if (row.work_status === 'catalog_approved' && row.is_active) {
      return [{ code: 'market', label: 'Validation Catalogue acquise · vérifier chaque marché' }];
    }
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

  function renderRegistryCorrections(doc, cell, row, context, nextStep) {
    const issues = registryCorrectionItems(row);
    const summary = text(doc, 'div', 'kmc-catalog-correction-heading',
      row.work_status === 'catalog_approved' && row.is_active
        ? 'Catalogue validé'
        : (issues.length === 1 && issues[0].code === 'check'
          ? 'Contrôle nécessaire' : issues.length + ' point(s) signalé(s)'));
    cell.appendChild(summary);
    const checklist = doc.createElement('ul');
    checklist.className = 'kmc-catalog-corrections';
    issues.forEach(issue => {
      const item = text(doc, 'li', 'kmc-catalog-correction-item', issue.label);
      item.setAttribute('data-issue', issue.code);
      checklist.appendChild(item);
    });
    cell.appendChild(checklist);
    if (row.is_active === true) {
      const note = row.is_active === true
        ? 'L’approbation Catalogue ne confirme pas la vente sur chaque marché.'
        : 'État à examiner : aucune publication déduite.';
      cell.appendChild(text(doc, 'small', 'kmc-catalog-correction-hint', note));
      return null;
    }
    const check = text(doc, 'button', 'kmc-catalog-readiness-check', 'Vérifier tous les prérequis');
    check.type = 'button';
    check.setAttribute('aria-expanded', 'false');
    const result = doc.createElement('div');
    result.className = 'kmc-catalog-readiness-result';
    result.setAttribute('role', 'status');
    result.setAttribute('aria-live', 'polite');
    check.addEventListener('click', async () => {
      if (check.getAttribute('aria-expanded') === 'true') {
        check.setAttribute('aria-expanded', 'false');
        result.replaceChildren();
        return;
      }
      check.disabled = true;
      check.textContent = 'Vérification…';
      try {
        const state = await jsonRequest(context.fetch, ENDPOINT + '?diagnose_product_ref=' +
          encodeURIComponent(row.product_ref));
        result.replaceChildren();
        if (state.phase === 'product_review') {
          const reasons = state.findings || [];
          result.appendChild(text(doc, 'strong', 'kmc-catalog-readiness-title',
            reasons.length
              ? reasons.length + ' points techniques à réexaminer'
              : 'Aucun écart technique courant détecté · état métier à réexaminer'));
          const list = doc.createElement('ul');
          list.className = 'kmc-catalog-readiness-reasons';
          reasons.forEach(reason => {
            const item = doc.createElement('li');
            item.appendChild(text(doc, 'span', '', certificationReasonLabel(reason)));
            item.appendChild(text(doc, 'small', '', registryReasonOwner(reason)));
            list.appendChild(item);
          });
          result.appendChild(list);
          result.appendChild(text(doc, 'small', 'kmc-catalog-correction-hint', state.note));
        } else if (state.phase !== 'catalog_approval' || !state.certification) {
          result.appendChild(text(doc, 'p', 'kmc-catalog-correction-hint',
            state.note || 'Ce contrôle ne s’applique pas à cette étape.'));
        } else {
          const reasons = state.certification.reasons || [];
          result.appendChild(text(doc, 'strong', 'kmc-catalog-readiness-title',
            state.certification.certified
              ? 'Contrôle technique réussi · validation humaine toujours requise'
              : reasons.length + ' prérequis de certification à résoudre'));
          const list = doc.createElement('ul');
          list.className = 'kmc-catalog-readiness-reasons';
          reasons.forEach(reason => {
            const item = doc.createElement('li');
            item.appendChild(text(doc, 'span', '', certificationReasonLabel(reason)));
            item.appendChild(text(doc, 'small', '', registryReasonOwner(reason)));
            list.appendChild(item);
          });
          result.appendChild(list);
          result.appendChild(text(doc, 'small', 'kmc-catalog-correction-hint',
            'Contrôle technique candidat uniquement. Revue visuelle FR et activation par marché restent distinctes.'));
        }
        check.setAttribute('aria-expanded', 'true');
      } catch (err) {
        result.replaceChildren(text(doc, 'p', 'kmc-catalog-readiness-error',
          'Diagnostic indisponible : ' + actionErrorMessage(err)));
        check.setAttribute('aria-expanded', 'true');
      } finally {
        check.disabled = false;
        check.textContent = 'Vérifier tous les prérequis';
      }
    });
    cell.appendChild(check);
    cell.appendChild(result);
    return check;
  }

  // The Catalogue is one operator surface; each mutation is still sent to
  // its canonical domain route, which checks its own grant and business gate.
  // Supplier originals always remain read-only.
  function formatCatalogKmf(value) {
    if (value == null || value === '') return 'Non calculé';
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return 'Non calculé';
    return Math.round(number).toLocaleString('fr-FR') + ' KMF';
  }

  // Values come from the last persisted Sourcing scan, never from a browser
  // estimation. The indicative test price is NOT a market selling price.
  function appendCatalogEconomicSummary(panel, doc, row) {
    const section = doc.createElement('section');
    section.className = 'kmc-catalog-economic-summary';
    section.setAttribute('data-catalog-economic-summary', '');
    section.appendChild(text(doc, 'strong', 'kmc-catalog-inspector-section',
      'Économie · diagnostic Sourcing'));
    const grid = doc.createElement('dl');
    grid.className = 'kmc-catalog-economic-grid';
    [
      ['Achat fournisseur', row.purchase_price_kmf],
      ['Coût variable complet', row.variable_cost_complete_kmf],
      ['Plancher de sécurité', row.minimum_safe_price_kmf],
      ['Prix test indicatif', row.test_price_kmf],
    ].forEach(([label, amount]) => {
      const item = doc.createElement('div');
      item.className = 'kmc-catalog-economic-item';
      item.appendChild(text(doc, 'dt', '', label));
      item.appendChild(text(doc, 'dd', '', formatCatalogKmf(amount)));
      grid.appendChild(item);
    });
    section.appendChild(grid);
    section.appendChild(text(doc, 'p', 'kmc-catalog-economic-note',
      (row.economic_category_key
        ? 'Catégorie économique : ' + row.economic_category_key + '. '
        : 'Catégorie économique non confirmée. ') +
      (row.record_kind === 'candidate'
        ? 'Aucun prix de vente marché décidé : candidat non remis au Catalogue.'
        : 'Les prix de vente par marché relèvent de la décision commerciale, pas du prix test.')));
    panel.appendChild(section);
  }

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
    panel.appendChild(text(doc, 'p', 'kmc-catalog-inspector-next-step',
      'Situation : ' + nextStep.status));
    appendCatalogEconomicSummary(panel, doc, row);
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
    sourceDetails.appendChild(text(doc, 'summary', '', 'Informations fournisseur · Lecture seule'));
    sourceDetails.appendChild(facts);
    panel.appendChild(sourceDetails);
    const feedback = text(doc, 'div', 'kmc-catalog-inspector-feedback', '');
    feedback.setAttribute('role', 'status');
    feedback.setAttribute('aria-live', 'polite');
    const actions = doc.createElement('div');
    actions.className = 'kmc-catalog-inspector-actions';
    panel.appendChild(actions);
    panel.appendChild(feedback);
    slot.appendChild(panel);
    if (typeof panel.scrollIntoView === 'function') panel.scrollIntoView({ block: 'nearest' });
    return { panel, actions, feedback };
  }

  // The Sourcing category picker is the proven existing form, not a new
  // classifier. The candidate service supplies the active pairs and evidence.
  function openCandidateInspector(context, slot, doc, row) {
    const { panel, actions, feedback } = inspectorFrame(slot, doc, row, 'candidate');
    panel.appendChild(text(doc, 'small', 'kmc-catalog-correction-hint',
      'État Sourcing : ' + (row.candidate_state || 'inconnu') +
      ' · Décision de scan : ' + (row.sourcing_decision || 'non mesurée')));

    if (row.work_status === 'sourcing_category_review') {
      feedback.textContent =
        'Le scanner demande une catégorie économique/douanière. ' +
        'La catégorie Boutique est une décision distincte : aucun brouillon ne sera créé.';
      const classify = makeButton(doc, 'Corriger la catégorie économique',
        'candidate-economic-category-review');
      actions.appendChild(classify);
      classify.addEventListener('click', async () => {
        classify.disabled = true;
        feedback.textContent = 'Lecture des catégories économiques actives…';
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
          form.appendChild(save);
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
              const e = result.scan?.economics || {};
              const numbers = [
                ['Coût variable',e.variable_cost_complete_kmf],
                ['Plancher de sécurité',e.minimum_safe_price_kmf],
                ['Prix test indicatif',e.test_price_kmf],
              ].filter(([,v]) => v != null && Number.isFinite(Number(v)) && Number(v)>0)
               .map(([label,value]) => label + ' : ' + formatKmf(value));
              await context.reload();
              setFeedback(context.root,
                'Catégorie économique enregistrée pour ' + row.candidate_ref +
                  '. Nouveau verdict Sourcing : ' +
                  (result.scan?.decision || 'à relire') +
                  (numbers.length ? '. ' + numbers.join(' · ') : '. Coûts encore à qualifier') +
                  '. Prix de vente marché non décidé, aucune publication.', 'positive');
            } catch (err) {
              feedback.textContent = actionErrorMessage(err);
              save.disabled = false;
            }
          });
          panel.appendChild(form);
          feedback.textContent = '';
        } catch (err) {
          feedback.textContent = actionErrorMessage(err);
        } finally {
          classify.disabled = false;
        }
      });
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
        form.appendChild(save);
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
        panel.appendChild(form);
        feedback.textContent = '';
      } catch (error) {
        feedback.textContent = actionErrorMessage(error);
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
    const price = value => value == null ? 'Non décidé' : formatCatalogKmf(value);
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
    facts('Prix de référence · non décision marché', [
      ['Coût stocké', price(dossier.economics?.reference_cost_kmf)],
      ['Prix global de référence', price(dossier.economics?.reference_price_kmf)],
    ]);
    const markets = Array.isArray(dossier.markets) ? dossier.markets : [];
    const mgroup = doc.createElement('section');
    mgroup.className = 'kmc-catalog-dossier-group';
    mgroup.appendChild(text(doc, 'strong', '', 'Vente par marché'));
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
          'Prix : ' + (market.price_status || 'Non décidé') +
          (market.local_price_amount == null ? '' :
            ' · ' + market.local_price_amount + ' ' +
            (market.local_price_currency || market.currency || ''))));
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
    panel.insertBefore(dossierSlot, actions);
    void loadProductDossier(context, doc, dossierSlot, row);
    const issues = Array.isArray(row.issues) ? row.issues : [];
    panel.appendChild(text(doc, 'strong', 'kmc-catalog-inspector-section',
      'Situation actuelle · ' + (registryNextStep(row).status)));
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
    issues.forEach(code => {
      if (labels[code]) list.appendChild(text(doc, 'li', '', labels[code]));
    });
    if (list.children.length) panel.appendChild(list);
    if (row.work_status === 'activation_to_reconcile') {
      feedback.textContent =
        'Activation d’une fiche encore marquée candidate : origine et autorisation à vérifier. ' +
        'Réconciliation avec la preuve d’origine indispensable. ' +
        'Aucune approbation ni correction de média proposée automatiquement.';
      return panel;
    }
    if (row.lifecycle_status === 'rejected' || row.work_status === 'approval_unproven') {
      feedback.textContent = row.work_status === 'approval_unproven'
        ? 'Produit actif sans décision d’approbation démontrée : réconciliation nécessaire, ' +
          'aucune validation automatique.'
        : 'Produit écarté : un réexamen autorisé est nécessaire.';
      return panel;
    }

    if (issues.includes('media_missing')) {
      panel.appendChild(text(doc, 'strong', 'kmc-catalog-inspector-section',
        'Contrôle média · informations vérifiées'));
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
      panel.appendChild(mediaFacts);
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
            await context.reload();
            setFeedback(context.root,
              row.product_ref + ' · médias réintégrés et tracés. Certification à revérifier.',
              'positive');
          } catch (err) {
            feedback.textContent = actionErrorMessage(err);
            recover.disabled = false;
          }
        });
        actions.appendChild(recover);
      }
      panel.appendChild(text(doc, 'p', 'kmc-catalog-correction-hint',
        'Aucune validation ni publication implicite : la certification devra être relancée.'));
    }
    if (issues.includes('source_to_normalize'))
      feedback.textContent = row.candidate_ref
        ? 'Contrat source à recontrôler via Sourcing : aucune validation Catalogue tant que la source n’est pas certifiée.'
        : 'La provenance manque. Aucune source fournisseur ne sera inventée.';
    if (issues.includes('taxonomy_to_confirm') && row.candidate_ref) {
      const btn = makeButton(doc, 'Corriger le classement', 'inspector-classify');
      btn.addEventListener('click', () =>
        openProductClassificationDialog(context, row, categories, btn));
      actions.appendChild(btn);
    }
    if (row.candidate_ref && (row.lifecycle_status === 'candidate' ||
        (row.lifecycle_status === 'active' && row.is_active === true))) {
      const btn = makeButton(doc,
        issues.includes('editorial_to_complete') ? 'Compléter le français' : 'Corriger le français',
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
      actions.appendChild(btn);
    }
    if (row.work_status === 'approval_pending' || issues.includes('approval_pending')) {
      const review = makeButton(doc, 'Vérifier avant validation', 'inspector-check-approval');
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
                feedback.textContent = actionErrorMessage(error);
                approve.disabled = false;
              }
            });
            actions.appendChild(approve);
          }
          feedback.textContent = 'Certification serveur acquise. Après contrôle visuel, vous pouvez valider.';
        } catch (error) {
          feedback.textContent = actionErrorMessage(error);
        } finally { review.disabled = false; }
      });
      actions.appendChild(review);
    }
    if (!actions.children.length && !feedback.textContent)
      feedback.textContent = 'Aucune correction justifiée à cette étape. ' +
        'Les décisions de prix et de marché restent distinctes.';
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
        const refinery = text(doc, 'a', '', 'Consulter la Raffinerie');
        refinery.href = '/admin/workspaces/catalog?view=refinery&product_ref=' +
          encodeURIComponent(context.focusedProductRef);
        notice.appendChild(refinery);
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
      table.innerHTML = '<thead><tr><th>Produit</th><th>Fournisseur</th><th>Classement boutique</th><th>Statut Catalogue</th><th>Consulter</th></tr></thead>';
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
        diagnostic.setAttribute('data-label', 'Statut Catalogue');
        const nextStep = registryNextStep(row);
        const statusChip = text(doc, 'button', 'kmc-catalog-status', nextStep.status);
        statusChip.type = 'button';
        statusChip.title = 'Aller à l’action : ' + nextStep.label;
        statusChip.setAttribute('data-status', row.work_status || 'inactive');
        diagnostic.appendChild(statusChip);
        const readinessCheck = renderRegistryCorrections(doc, diagnostic, row, context, nextStep);
        tr.appendChild(diagnostic);
        const actionCell = doc.createElement('td');
        actionCell.className = 'kmc-catalog-action-cell';
        actionCell.setAttribute('data-label', 'Consulter');
        if (row.work_status !== 'catalog_approved') {
          actionCell.setAttribute('data-label', 'Corriger');
          const main = makeButton(doc,
            row.work_status === 'approval_pending' ? 'Examiner / valider' :
              'Corriger / examiner', 'open-catalog-inspector');
          main.className = 'kmc-workspace-action kmc-catalog-primary-action';
          main.addEventListener('click', () =>
            openProductInspector(context, slot, doc, row, categories));
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
      renderApproval(rootNode, ui, doc, payload, context);
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
      workspaceView: new URLSearchParams(locationSearch || '').get('view') === 'refinery' ? 'refinery' : 'catalog',
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
        search: '', supplier: '', category: '', subcategory: '', status: '', offset: 0,
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
        if (context.workspaceView === 'refinery' && !reloadOptions.skipAutoFrenchSchedule) scheduleAutoFrenchPreparation(context, payload);
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
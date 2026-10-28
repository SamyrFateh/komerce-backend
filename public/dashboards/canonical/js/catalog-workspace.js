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
      copy.appendChild(text(doc, 'p', 'kmc-workspace-subtitle', 'Corriger, enrichir, tarifer et valider avant toute mise au catalogue.'));
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
      'La source fournisseur reste intacte. Le français est enregistré comme override tracé, puis relu avant validation Catalogue.'
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
    const descriptionField = editorField(doc, 'Description française', 'description', true);
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
    const cancel = makeButton(doc, 'Annuler', 'cancel-fr-editor', true);
    cancel.addEventListener('click', () => closeFrenchEditor(context, triggerButton));
    footer.appendChild(cancel);
    const save = makeButton(doc, 'Enregistrer la préparation FR', 'save-fr-editor');
    save.addEventListener('click', async () => {
      const name = String(nameField.control.value || '').trim();
      const description = String(descriptionField.control.value || '').trim();
      if (!name || !description) {
        setEditorFeedback(status, 'Titre et description français sont obligatoires.', 'critical');
        return;
      }
      setEditorFeedback(status, 'Enregistrement en cours…');
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
    });
    footer.appendChild(save);
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

  function renderApproval(rootNode, ui, doc, payload, context) {
    const slot = createSection(rootNode, ui, 'Produits à finaliser', 'Préparez les fiches, définissez les prix et validez les produits proposés.');
    renderPricingParameters(slot, doc, payload);
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
      slot.appendChild(text(doc, 'div', 'kmc-workspace-empty', 'Aucun candidat en attente de curation.'));
      return;
    }
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
        const returnTo = `/admin/workspaces/catalog?product_ref=${encodeURIComponent(row.product_ref)}`;
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
    const issues = Array.isArray(row.issues) ? row.issues : [];
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
      ['inactive', 'rejected'].includes(row.work_status)).length;
    return [
      { key: 'registry', label: 'Produits remis · filtre', value: formatNumber(payload.registry_page?.total || 0), tone: 'neutral' },
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
      ['source_to_normalize', 'Source fournisseur à vérifier'],
      ['taxonomy_to_confirm', 'Classement boutique à corriger'],
      ['editorial_to_complete', 'Contenu français à compléter'],
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
    select('À traiter', 'status', [
      { value: '', label: 'Tous les états' },
      { value: 'source_to_normalize', label: 'Source à normaliser' },
      { value: 'taxonomy_to_confirm', label: 'Catégorie à confirmer' },
      { value: 'editorial_to_complete', label: 'Fiche FR à compléter' },
      { value: 'approval_pending', label: 'Validation attendue' },
      { value: 'catalog_approved', label: 'Approuvé Catalogue' },
      { value: 'rejected', label: 'Écarté' },
      { value: 'inactive', label: 'Inactif' },
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
    [
      ['', 'Tous les produits'],
      ['source_to_normalize', 'Source à vérifier'],
      ['taxonomy_to_confirm', 'À classer'],
      ['editorial_to_complete', 'Fiche FR'],
      ['approval_pending', 'À valider'],
      ['catalog_approved', 'Approuvés'],
    ].forEach(([value, label]) => {
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
      formatNumber(page.total) + ' produit(s) correspondant aux filtres · source : remise canonique à la Raffinerie'));
    if (!rows.length) {
      slot.appendChild(text(doc, 'div', 'kmc-workspace-empty',
        'Aucun produit remis ne correspond aux filtres. Vérifiez les filtres ou le parcours de remise Raffinerie → Catalogue.'));
    } else {
      const table = doc.createElement('table');
      table.className = 'kmc-workspace-table kmc-catalog-registry-table';
      table.innerHTML = '<thead><tr><th>Produit</th><th>Fournisseur</th><th>Classement boutique</th><th>À corriger avant marchés</th><th>Action suivante</th></tr></thead>';
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
        tr.setAttribute('data-product-ref', row.product_ref);
        tr.setAttribute('data-status', row.work_status || 'inactive');
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
        const link = text(doc, 'a', 'kmc-catalog-product-title', row.name || row.product_ref);
        link.href = contextualHref('/admin/products/' + encodeURIComponent(row.product_ref),
          '/admin/workspaces/catalog?product_ref=' + encodeURIComponent(row.product_ref), 'Retour au Catalogue');
        link.title = row.name || row.product_ref;
        productCopy.className = 'kmc-catalog-product-copy';
        productCopy.appendChild(link);
        productCopy.appendChild(text(doc, 'small', 'kmc-catalog-product-reference', row.product_ref));
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
          row.boutique_category_label || row.boutique_category_key || 'À classer'));
        if (row.boutique_subcategory_label || row.boutique_subcategory_key) {
          category.appendChild(text(doc, 'small', '',
            row.boutique_subcategory_label || row.boutique_subcategory_key));
        }
        tr.appendChild(category);

        const diagnostic = doc.createElement('td');
        diagnostic.className = 'kmc-catalog-diagnostic';
        diagnostic.setAttribute('data-label', 'À corriger avant marchés');
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
        actionCell.setAttribute('data-label', 'Action suivante');
        const actions = doc.createElement('div');
        actions.className = 'kmc-catalog-actions-inner';
        const view = text(doc, 'a', 'kmc-workspace-action is-secondary kmc-catalog-view-link', 'Voir fiche');
        view.href = contextualHref('/admin/products/' + encodeURIComponent(row.product_ref),
          '/admin/workspaces/catalog?product_ref=' + encodeURIComponent(row.product_ref), 'Retour au Catalogue');
        const editClassification = makeButton(doc,
          (row.issues || []).includes('taxonomy_to_confirm') ? 'Classer' : 'Modifier classement',
          'classify-product', true);
        editClassification.addEventListener('click', () =>
          openProductClassificationDialog(context, row, categories, editClassification));
        const issues = row.issues || [];
        const source = text(doc, 'a', 'kmc-workspace-action is-secondary', 'Examiner source');
        source.href = '/admin/workspaces/sourcing' +
          (row.candidate_ref ? '?candidate_ref=' + encodeURIComponent(row.candidate_ref) : '');
        const refinery = text(doc, 'a', 'kmc-workspace-action is-secondary', 'Ouvrir Raffinerie');
        refinery.href = '/admin/workspaces/catalog?view=refinery&product_ref=' +
          encodeURIComponent(row.product_ref);
        const market = text(doc, 'a', 'kmc-workspace-action is-secondary', 'Décisions marchés');
        market.href = '/dashboards/canonical/market-catalog.html?product_ref=' +
          encodeURIComponent(row.product_ref);
        const diagnose = makeButton(doc, 'Vérifier prérequis', 'diagnose-product', true);
        diagnose.addEventListener('click', () => {
          if (readinessCheck) readinessCheck.click();
        });
        const primaryByKind = { detail: view, source, classify: editClassification,
          refinery, markets: market, diagnose };
        const primary = primaryByKind[nextStep.kind] || view;
        primary.textContent = nextStep.label;
        primary.setAttribute('aria-label', nextStep.label + ' pour ' + row.product_ref);
        primary.className = 'kmc-workspace-action kmc-catalog-primary-action' +
          (nextStep.kind === 'detail' ? ' is-secondary' : '');
        actions.appendChild(primary);
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
          ...(issues.includes('source_to_normalize') && row.candidate_ref ? [['source', source]] : []),
          ...(row.lifecycle_status === 'candidate' ? [['refinery', refinery]] : []),
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
          ...(context.workspaceView === 'refinery' ? { include_readiness: '1' } : {}),
          approval_limit: String(context.approvalLimit),
          approval_offset: String(context.approvalOffset),
        });
        if (context.focusedProductRef) params.set('product_ref', context.focusedProductRef);
        if (context.workspaceView !== 'refinery') {
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
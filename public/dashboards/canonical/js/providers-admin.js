/**
 * @komerce-arch
 * @role          canonical-providers-admin
 * @domain        admin-dashboard
 * @layer         ui-orchestration
 * @criticality   medium
 * @inputs        authenticated_admin, provider_capability_matrix_with_runtime_decision
 * @outputs       providers_certification_dom
 * @depends       canonical primitives, GET /api/admin/providers/capabilities
 * @used-by       canonical admin entrypoint
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      activation_is_not_authorization, provider_secrets_never_exposed, dashboard_no_business_recompute, read_only_projection
 * @impact-areas  admin-dashboard, supplier-connectivity
 * @version       2026-10
 */
'use strict';

(function initProvidersAdmin(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.KomerceCanonicalProvidersAdmin = api;
})(typeof window !== 'undefined' ? window : null, function createProvidersAdmin() {
  const ENDPOINT = '/api/admin/providers/capabilities';

  const CLASSIFICATION_MARK = Object.freeze({ CONFIRMED: '✓', RECLASSIFIED: '↻', GAP: '✖' });

  const REASON_LABELS = Object.freeze({
    CERTIFICATION_CAPABILITY_GAP: 'Capability non disponible (GAP)',
    CERTIFICATION_CAPABILITY_NOT_PROVEN: 'Capability non prouvée',
    CERTIFICATION_CAPABILITY_NOT_RECORDED: 'Capability non enregistrée',
    CERTIFICATION_ENVIRONMENT_MISMATCH: 'Environnement certifié ≠ environnement d’exécution',
    CERTIFICATION_RUNTIME_ENVIRONMENT_REQUIRED: 'Environnement d’exécution non déclaré',
    CERTIFICATION_PROVIDER_UNSUPPORTED: 'Provider hors garde d’exécution',
  });

  function classificationLabel(value) {
    if (!value) return '? non classé';
    const mark = CLASSIFICATION_MARK[value] || '?';
    return value === 'GAP' ? `${mark} GAP — non disponible` : `${mark} ${value}`;
  }

  // La décision affichée est celle du serveur (evaluateRuntimeCapability) : l'UI ne la recalcule pas.
  function decisionLabel(decision) {
    if (decision && decision.allowed === true) return '✓ Autorisée au runtime';
    const reason = decision && decision.reason;
    return `✖ Refusée — ${REASON_LABELS[reason] || reason || 'raison non fournie'}`;
  }

  function rowsFor(provider) {
    const records = provider && Array.isArray(provider.records) ? provider.records : [];
    return records.map(row => ({
      capability: row.capability,
      classification: classificationLabel(row.classification),
      availability: row.availability || '—',
      proof: row.highest_proof || '— aucune preuve',
      environment: row.environment || '—',
      decision: decisionLabel(row.runtime_decision),
      limitations: (row.limitations || []).join(' · ') || '—',
    }));
  }

  const COLUMNS = Object.freeze([
    { key: 'capability', label: 'Capability' },
    { key: 'classification', label: 'Classification' },
    { key: 'availability', label: 'Disponibilité prouvée' },
    { key: 'proof', label: 'Preuve max', },
    { key: 'environment', label: 'Environnement certifié' },
    { key: 'decision', label: 'Décision runtime' },
    { key: 'limitations', label: 'Limites' },
  ]);

  function node(doc, tag, className, value) {
    const el = doc.createElement(tag);
    if (className) el.className = className;
    if (value != null) el.textContent = String(value);
    return el;
  }

  function renderPayload(rootNode, payload, doc, ui) {
    rootNode.className = 'kmc-admin-shell kmc-entity-shell';
    rootNode.replaceChildren();

    const header = node(doc, 'header', 'kmc-entity-header');
    header.appendChild(node(doc, 'span', 'kmc-entity-kicker', 'ADMINISTRATION'));
    header.appendChild(node(doc, 'h1', 'kmc-entity-title', 'Providers & certifications'));
    header.appendChild(node(doc, 'p', 'kmc-entity-subtitle', 'Preuves par capability et décision d’exécution réellement appliquée par le serveur.'));
    rootNode.appendChild(header);

    const notice = node(doc, 'section', 'kmc-providers-notice');
    notice.setAttribute('data-providers-notice', '');
    notice.appendChild(node(doc, 'strong', '', payload.activation_notice || 'Activer un provider n’autorise pas son exécution.'));
    const env = payload.runtime_environment
      ? `Environnement d’exécution : ${payload.runtime_environment}`
      : (payload.runtime_environment_error
        ? `Environnement d’exécution invalide (${payload.runtime_environment_error}) — toute exécution est refusée`
        : 'Environnement d’exécution non déclaré — toute exécution certifiée est refusée');
    notice.appendChild(node(doc, 'p', 'kmc-providers-env', env));
    rootNode.appendChild(notice);

    (payload.providers || []).forEach(provider => {
      const section = node(doc, 'section', 'kmc-decision-surface-card');
      section.setAttribute('data-provider', provider.provider);
      const title = provider.runtime_guarded ? provider.provider : `${provider.provider} — preuves documentées, hors garde d’exécution`;
      section.appendChild(node(doc, 'h2', 'kmc-decision-dashboard-section-title', title));
      const body = node(doc, 'div');
      section.appendChild(body);
      if (ui && ui.DenseTable) {
        ui.DenseTable.render(body, { columns: COLUMNS, rows: rowsFor(provider) });
      }
      rootNode.appendChild(section);
    });
  }

  async function render(rootNode, options = {}) {
    const doc = options.document || rootNode.ownerDocument || document;
    const fetchImpl = options.fetch || (typeof fetch === 'function' ? fetch : null);
    const ui = options.ui || (typeof window !== 'undefined' ? window.KomerceDecisionUI : null);
    if (ui && ui.Skeleton) ui.Skeleton.render(rootNode, { shape: 'table' });
    const response = await fetchImpl(ENDPOINT, { method: 'GET', credentials: 'include', headers: { Accept: 'application/json' } });
    if (!response.ok) {
      rootNode.replaceChildren();
      rootNode.appendChild(node(doc, 'p', 'kmc-providers-error', `Impossible de charger les providers (${response.status}).`));
      return null;
    }
    const payload = await response.json();
    renderPayload(rootNode, payload, doc, ui);
    return payload;
  }

  return Object.freeze({ ENDPOINT, REASON_LABELS, COLUMNS, classificationLabel, decisionLabel, rowsFor, renderPayload, render });
});

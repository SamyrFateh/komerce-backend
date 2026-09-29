/**
 * @komerce-arch
 * @role          canonical-domain-cockpit-pattern
 * @domain        admin-dashboard
 * @layer         ui-component
 * @criticality   medium
 * @inputs        domain-owned presentation projections
 * @outputs       shared cockpit presentation contract and DOM decoration
 * @depends       none
 * @used-by       canonical Pilotage, Commerce, Operations, Finance and future domain cockpits
 * @db-read       none
 * @db-write      none
 * @db-txn        none
 * @doctrine      dashboard_no_business_recompute, cockpit_pattern_is_presentation_only, legacy_visual_language
 * @impact-areas  admin-dashboard
 * @version       2026-09-v1
 */
'use strict';

(function initCanonicalCockpitPattern(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.KomerceCanonicalCockpitPattern = api;
})(typeof globalThis !== 'undefined' ? globalThis : null, function createCanonicalCockpitPattern() {
  'use strict';

  const DOMAIN_DEFS = Object.freeze({
    pilotage: Object.freeze({
      label: 'Pilotage',
      purpose: 'Comprendre la situation globale et les décisions qui traversent plusieurs domaines.',
    }),
    commerce: Object.freeze({
      label: 'Commerce',
      purpose: 'Lire le passage de l’offre à la vente et les décisions commerciales ouvertes.',
    }),
    operations: Object.freeze({
      label: 'Opérations',
      purpose: 'Suivre l’exécution réelle, les files de travail et les exceptions terrain.',
    }),
    finance: Object.freeze({
      label: 'Finance',
      purpose: 'Lire les encaissements, les coûts, la marge et les écarts nécessitant une décision.',
    }),
    catalog: Object.freeze({
      label: 'Catalogue',
      purpose: 'Décider ce qui mérite d’exister dans le catalogue global et ce qui doit être corrigé.',
    }),
    imports: Object.freeze({
      label: 'Imports',
      purpose: 'Suivre un lot de la source au Catalogue puis aux décisions aval, sans exposer la plomberie saine.',
    }),
    markets: Object.freeze({
      label: 'Marchés',
      purpose: 'Décider ce qui peut être vendu sur un marché donné à partir de la vérité globale.',
    }),
  });

  const MODEL_KEYS = Object.freeze([
    'situation',
    'flow',
    'decisions',
    'exceptions',
    'drilldowns',
    'history',
  ]);

  function domainDefinition(domain) {
    return DOMAIN_DEFS[String(domain || '').trim().toLowerCase()] || null;
  }

  function buildPresentationModel(input = {}) {
    const domain = String(input.domain || '').trim().toLowerCase();
    const definition = domainDefinition(domain);
    if (!definition) throw new Error(`canonical_cockpit_unknown_domain:${domain || '<empty>'}`);

    // Présentation uniquement : aucun seuil, score, statut ou décision métier
    // n'est dérivé ici. Les domaines fournissent déjà leurs faits projetés.
    const model = {
      domain,
      label: definition.label,
      purpose: input.purpose || definition.purpose,
      title: input.title || definition.label,
      subtitle: input.subtitle || '',
      situation: input.situation || null,
      flow: Array.isArray(input.flow) ? input.flow : [],
      decisions: Array.isArray(input.decisions) ? input.decisions : [],
      exceptions: Array.isArray(input.exceptions) ? input.exceptions : [],
      drilldowns: Array.isArray(input.drilldowns) ? input.drilldowns : [],
      history: input.history || null,
    };
    return Object.freeze(model);
  }

  function decorateDashboard(element, domain) {
    if (!element || typeof element.setAttribute !== 'function') return element;
    const definition = domainDefinition(domain);
    if (!definition) return element;
    const classes = new Set(String(element.className || '').split(/\s+/).filter(Boolean));
    classes.add('kmc-domain-cockpit');
    element.className = Array.from(classes).join(' ');
    element.setAttribute('data-cockpit-pattern', 'v1');
    element.setAttribute('data-cockpit-domain', String(domain));
    element.setAttribute('data-cockpit-language', 'legacy');
    return element;
  }

  function contractKeys() {
    return MODEL_KEYS.slice();
  }

  return Object.freeze({
    DOMAIN_DEFS,
    MODEL_KEYS,
    domainDefinition,
    buildPresentationModel,
    decorateDashboard,
    contractKeys,
  });
});

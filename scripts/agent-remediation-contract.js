'use strict';

/**
 * B5 — Agent Remediation Contract.
 *
 * One machine-readable vocabulary for measured deviations across Backend,
 * Dashboards and Boutique. A gate may detect; this registry tells an agent
 * how to repair without inventing a new owner, bypass or larger baseline.
 */
const CONTRACT_VERSION = 'ARC-1.0';

function contract(scope, owner, cause, action, forbidden, opts = {}) {
  return Object.freeze({
    scope,
    owner,
    cause,
    action,
    forbidden,
    baselinePolicy: opts.baselinePolicy || 'never-increase-to-pass',
    severity: opts.severity || 'error',
    autoRemediation: opts.autoRemediation !== false,
  });
}

const CONTRACTS = Object.freeze({
  // Backend / architecture / governance
  'BACKEND-ARCH': contract('backend', 'feature manifest + scripts/audit-backend-arch.js',
    'Une règle d’architecture backend est violée ou une exception connue a dérivé.',
    'Corriger le fichier signalé selon le remedy I-BACK correspondant et conserver l’owner canonique.',
    'Ne pas ajouter le fichier à une allowlist ni élargir une exception pour faire passer le gate.'),
  'BACKEND-QUALITY': contract('backend', 'owner canonique du fichier dans features/*.feature.js',
    'Une règle de qualité détecte complexité, taille, duplication ou construction interdite.',
    'Réduire la cause dans le fichier owner; extraire par responsabilité si nécessaire puis relancer quality:gate.',
    'Ne pas ajouter quality-disable, exemption de fichier ou budget supplémentaire sans décision architecturale explicite.'),
  'BACKEND-FEATURE-OWNERSHIP': contract('backend', 'features/*.feature.js',
    'Un fichier ou une dépendance backend n’est pas correctement rattaché à une feature canonique.',
    'Rattacher le fichier à l’owner métier réel ou déplacer la responsabilité vers cet owner, puis régénérer les projections.',
    'Ne pas revendiquer arbitrairement le fichier dans une feature voisine pour faire disparaître l’orphelin.'),
  'BACKEND-CONTRACT': contract('backend', 'contrat API canonique + owner route/service',
    'Le producteur backend et son contrat consommateur divergent.',
    'Corriger l’implémentation ou le contrat au niveau de la source de vérité puis mettre à jour les témoins concernés.',
    'Ne pas dupliquer le contrat dans un second fichier ni masquer l’écart côté consommateur.'),
  'BACKEND-SECURITY': contract('backend', 'owner de la frontière de sécurité concernée',
    'Une protection de sécurité mesurée a régressé ou son snapshot n’est plus frais.',
    'Restaurer le contrôle dans l’owner existant et régénérer la preuve Security 360 si la modification est volontaire.',
    'Ne pas relever une baseline sécurité pour accepter une nouvelle faiblesse.'),
  'BACKEND-MIGRATION-IMMUTABILITY': contract('backend', 'migrations/ + migrations/GAPS.md',
    'Une migration déjà publiée a été modifiée ou une collision non gouvernée est apparue.',
    'Créer une nouvelle migration corrective; pour une collision historique, conserver l’ensemble exact documenté.',
    'Ne jamais réécrire ou renommer une migration déjà versionnée pour faire passer le gate.'),
  'BACKEND-SCHEMA-FRESHNESS': contract('backend', 'docs/db/railway-live-schema.sql + migrations/',
    'Le snapshot de schéma et la chaîne de migrations ne décrivent plus le même état.',
    'Régénérer/promouvoir le snapshot par les commandes canoniques après avoir corrigé la migration source.',
    'Ne pas éditer le dump à la main pour masquer un drift.'),
  'BACKEND-SCHEMA-RESURRECTION': contract('backend', 'migrations/ + schéma canonique',
    'Un objet supprimé ou obsolète réapparaît dans le schéma.',
    'Identifier la migration qui ressuscite l’objet et corriger cette nouvelle migration ou son ordre.',
    'Ne pas ajouter l’objet ressuscité à une allowlist.'),
  'BACKEND-GOLDEN-CDR': contract('backend', 'pricing/economic canonical owners + tools/golden-cdr',
    'Le comportement économique a divergé du snapshot Golden CDR.',
    'Corriger la logique si la divergence est accidentelle; sinon recapturer le golden avec justification métier explicite.',
    'Ne pas recapturer le golden uniquement pour rendre la CI verte.'),
  'BACKEND-REVIEWED-EXCEPTION': contract('backend', 'exception exacte documentée dans son gate source',
    'Une exception historique, de glue, de test ou de chaos est mesurée et explicitement justifiée.',
    'Ne rien changer tant que la responsabilité reste identique; réauditer si le fichier, le périmètre ou le comportement évolue.',
    'Ne pas copier cette exception sur un nouveau fichier.', { severity: 'info', autoRemediation: false }),
  'BACKEND-HEALTHY-MEASUREMENT': contract('backend', 'gate ou ratchet source qui produit la mesure',
    'Une mesure de gouvernance est présente dans le rapport mais sa dette effective est déjà à zéro.',
    'Ne rien corriger; conserver le cliquet à zéro et réagir uniquement si sa valeur future augmente.',
    'Ne pas transformer une mesure saine en allowlist ni relever le cliquet.', { severity: 'info', autoRemediation: false }),

  // Dashboards
  'DASH-ORPHAN-ROUTE': contract('dashboard', 'public/dashboards/admin/js/app.js + vue déclarée',
    'Une route SPA pointe vers une vue absente.',
    'Restaurer/créer la vue owner attendue ou retirer la route devenue morte, puis régénérer DASHBOARDS_360.',
    'Ne pas créer une vue placeholder uniquement pour satisfaire le gate.'),
  'DASH-DEAD-API-METHOD': contract('dashboard', 'public/dashboards/admin/js/api-client.js',
    'Une méthode KmcApi est exportée mais n’a plus de consommateur dashboard.',
    'Supprimer l’export réellement mort ou restaurer le consommateur canonique s’il manque.',
    'Ne pas ajouter un appel factice pour conserver une API morte.'),
  'DASH-MISSING-API-METHOD': contract('dashboard', 'public/dashboards/admin/js/api-client.js',
    'Une vue appelle une méthode KmcApi qui n’est pas exportée.',
    'Ajouter/rétablir la méthode dans api-client.js ou corriger la vue vers la méthode canonique existante.',
    'Ne pas faire de fetch() brut dans la vue pour contourner KmcApi.'),
  'DASH-DOCTRINE-FETCH': contract('dashboard', 'KmcApi / api-client.js',
    'Une vue sous doctrine kmc_api_only effectue un accès réseau brut.',
    'Déplacer l’accès dans api-client.js (ou helper réseau owner déjà documenté) et appeler KmcApi depuis la vue.',
    'Ne pas ajouter kmc-api-allow sans justification locale réelle.'),
  'DASH-UNPROVEN-CONTRACT': contract('dashboard', 'route backend + docs/contract/openapi.json + test de contrat',
    'Un endpoint consommé par le dashboard est connu mais pas encore PROVEN dans le contrat.',
    'Ajouter/compléter le test de contrat backend et régénérer le contrat OpenAPI pour faire passer UNKNOWN à PROVEN.',
    'Ne pas marquer PROVEN manuellement sans témoin exécutable.', { severity: 'warning' }),
  'DASH-CANONICAL': contract('dashboard', 'public/dashboards/canonical + DashboardSchema',
    'La projection Canonical, le DashboardSchema ou ses sources backend divergent.',
    'Corriger la source backend ou le schéma canonique owner, puis régénérer les artefacts dashboard dépendants.',
    'Ne pas patcher une vue Canonical pour compenser une divergence de source.'),

  // Boutique
  'BOUTIQUE-CASCADE': contract('boutique', 'owner principal du sélecteur dans critical-selector-ownership.js',
    'Deux chemins CSS donnent des valeurs différentes à la même propriété dans le même contexte.',
    'Conserver la valeur gagnante voulue dans l’owner canonique et supprimer/re-homer la déclaration concurrente.',
    'Ne jamais relever .css-guard-baseline.json pour accepter le conflit.'),
  'BOUTIQUE-SPECIFICITY': contract('boutique', 'owner principal du sélecteur',
    'Une classe globale crée un override silencieux de spécificité.',
    'Re-homer la propriété dans l’owner canonique ou neutraliser la spécificité sans changer la valeur gagnante.',
    'Ne jamais relever .css-specificity-guard-baseline.json pour accepter l’override.'),
  'BOUTIQUE-IMPORTANT': contract('boutique', 'owner CSS concerné + REVIEWED_GUARDS',
    'Un !important non revu apparaît ou une exception exacte a dérivé.',
    'Supprimer le !important par ownership/cascade normale ou documenter une exception exacte réellement indispensable.',
    'Ne pas augmenter la baseline de dette !important ouverte.'),
  'BOUTIQUE-SELECTOR-OWNERSHIP': contract('boutique', 'critical-selector-ownership.js',
    'Un sélecteur critique est touché par un owner ou contexte non autorisé, ou son principal a disparu.',
    'Modifier le principal/contextuel déjà contracté; si le design change réellement, modifier explicitement le contrat avec preuve.',
    'Ne pas ajouter un owner au registre uniquement pour faire passer le gate.'),
  'BOUTIQUE-RUNTIME-VAR-OWNERSHIP': contract('boutique', 'runtime-css-var-ownership.js',
    'Une variable CSS runtime a un nouveau producteur, trop de chemins d’écriture ou perd son principal.',
    'Conserver le producteur principal et les adaptations contractées; fusionner les chemins d’écriture redondants.',
    'Ne pas ajouter producteur/maxWrites pour masquer une duplication.'),
  'BOUTIQUE-GLOBAL-OWNERSHIP': contract('boutique', 'features/*.feature.js + public/boutique/features/*.feature.js',
    'Un fichier runtime Boutique n’a pas d’owner canonique unique.',
    'Rattacher le fichier à la feature qui possède réellement la responsabilité ou déplacer le code vers cet owner.',
    'Ne pas rattacher artificiellement un fichier pour obtenir 100%.'),
  'BOUTIQUE-STATIC-GATE': contract('boutique', 'owner du fichier Boutique signalé',
    'Un invariant statique Boutique (imports, tokens, breakpoints, z-index, sticky, body classes, injection, HTML) est violé.',
    'Corriger la ligne signalée dans son owner canonique et relancer le gate source.',
    'Ne pas créer d’exception globale ou de deuxième chemin de modification.'),
  'BOUTIQUE-ARCH': contract('boutique', 'BOUTIQUE_ARCHITECTURE.md + registres exécutables',
    'L’architecture observée ne respecte plus ses invariants canoniques.',
    'Corriger la source owner ou le registre canonique si la responsabilité a réellement changé, puis régénérer le LIVE.',
    'Ne pas modifier le LIVE à la main.'),

  // Cross-scope governance
  'GOV-BUSINESS-GRAPH': contract('governance', 'features/*.feature.js + Business Feature Graph generator',
    'Le graphe business n’est plus reconstructible/frais ou un fichier est mal projeté.',
    'Corriger l’ownership/import dans la source canonique puis régénérer le graphe.',
    'Ne pas éditer BUSINESS_FEATURE_GRAPH à la main.'),
  'GOV-FEATURE-360': contract('governance', 'Feature 360 canonical projection',
    'La projection Feature 360 est stale ou incohérente avec les manifests/gate findings.',
    'Corriger les sources, régénérer Gate Findings puis Feature 360.',
    'Ne pas éditer FEATURE_360 à la main.'),
  'GOV-REMEDIATION-CONTRACT': contract('governance', 'scripts/agent-remediation-contract.js',
    'Un gate mesuré n’a pas de stratégie de remédiation machine-readable ou l’index est stale.',
    'Ajouter/corriger le contrat, puis régénérer AGENT_REMEDIATION_INDEX.json.',
    'Ne pas exclure le gate du checker pour faire passer la CI.'),
});

const DASHBOARD_METRICS = Object.freeze({
  orphanRoutes: 'DASH-ORPHAN-ROUTE',
  deadApiMethods: 'DASH-DEAD-API-METHOD',
  missingApiMethods: 'DASH-MISSING-API-METHOD',
  doctrineViolations: 'DASH-DOCTRINE-FETCH',
  unprovenContracts: 'DASH-UNPROVEN-CONTRACT',
});

const GATE_FAMILY_MAP = Object.freeze({
  'gate:feature-registry-check': 'BACKEND-FEATURE-OWNERSHIP',
  'gate:feature-classification-check': 'BACKEND-FEATURE-OWNERSHIP',
  'gate:feature-guard': 'BACKEND-FEATURE-OWNERSHIP',
  'check:group-wording': 'BOUTIQUE-STATIC-GATE',
  'check:imports': 'BOUTIQUE-STATIC-GATE',
  'check:body-classes': 'BOUTIQUE-STATIC-GATE',
  'check:no-injection': 'BOUTIQUE-STATIC-GATE',
  'check:important': 'BOUTIQUE-IMPORTANT',
  'check:css-guard': 'BOUTIQUE-CASCADE',
  'check:css-specificity-guard': 'BOUTIQUE-SPECIFICITY',
  'check:breakpoints': 'BOUTIQUE-STATIC-GATE',
  'check:css-vars': 'BOUTIQUE-STATIC-GATE',
  'check:zindex': 'BOUTIQUE-STATIC-GATE',
  'check:keyframes': 'BOUTIQUE-STATIC-GATE',
  'check:sticky': 'BOUTIQUE-STATIC-GATE',
  'audit:modal-ownership': 'BOUTIQUE-ARCH',
  'audit:modal-layout': 'BOUTIQUE-ARCH',
});

const CI_REQUIRED = Object.freeze([
  { code: 'BACKEND-QUALITY', needle: 'node scripts/code-quality-gate.js --strict' },
  { code: 'BACKEND-FEATURE-OWNERSHIP', needle: 'node scripts/feature-guard.js --strict' },
  { code: 'BACKEND-CONTRACT', needle: 'node scripts/contract-check.js' },
  { code: 'BACKEND-SECURITY', needle: 'npm run security:360:check' },
  { code: 'BACKEND-MIGRATION-IMMUTABILITY', needle: 'node scripts/check-migration-immutability.js' },
  { code: 'BACKEND-SCHEMA-FRESHNESS', needle: 'node scripts/check-schema-freshness.js' },
  { code: 'BACKEND-SCHEMA-RESURRECTION', needle: 'node scripts/check-schema-resurrection.js' },
  { code: 'DASH-CANONICAL', needle: 'npm run dashboards:360:check' },
  { code: 'BOUTIQUE-GLOBAL-OWNERSHIP', needle: 'node scripts/boutique-ownership-full-check.js --strict' },
  { code: 'BOUTIQUE-SELECTOR-OWNERSHIP', needle: 'node public/boutique/scripts/check-selector-ownership.js' },
  { code: 'BOUTIQUE-RUNTIME-VAR-OWNERSHIP', needle: 'node public/boutique/scripts/check-runtime-css-var-ownership.js' },
  { code: 'GOV-BUSINESS-GRAPH', needle: 'node scripts/business-graph-gen.js --check' },
  { code: 'GOV-FEATURE-360', needle: 'node scripts/feature-360-check.js' },
  { code: 'GOV-REMEDIATION-CONTRACT', needle: 'node scripts/gen-agent-remediation-index.js --check' },
]);

function baseBackendRule(rule) {
  return String(rule || '').replace(/\s*\(reviewed\)\s*$/i, '');
}

function backendDebtCode(debt) {
  const rule = String(debt?.rule || '');
  const count = Number(debt?.count || 0);
  const text = `${debt?.lot || ''} ${debt?.note || ''}`.toLowerCase();

  if (count === 0 || /tous les .*cliquets.*(?:à|a) 0|dette .*ferm[ée]e/.test(text)) {
    return 'BACKEND-HEALTHY-MEASUREMENT';
  }
  if (
    /\(reviewed\)/i.test(rule)
    || /exception document/i.test(text)
    || /l[ée]gitim/.test(text)
    || /(?:r[ée]audit|revalid)/.test(text)
  ) {
    return 'BACKEND-REVIEWED-EXCEPTION';
  }
  return 'BACKEND-ARCH';
}

function gateFindingCode(finding) {
  if (finding?.scope === 'dashboard') {
    return DASHBOARD_METRICS[finding.type] || 'DASH-CANONICAL';
  }
  if (finding?.scope === 'backend' || finding?.scope === 'root') {
    return GATE_FAMILY_MAP[finding.gate] || 'BACKEND-ARCH';
  }
  return GATE_FAMILY_MAP[finding?.gate] || 'BOUTIQUE-STATIC-GATE';
}

function remediation(code, evidence = {}) {
  const policy = CONTRACTS[code];
  if (!policy) return null;
  return { code, ...policy, evidence };
}

function remediationForBackendDebt(debt) {
  const code = backendDebtCode(debt);
  return remediation(code, {
    rule: baseBackendRule(debt?.rule),
    lot: debt?.lot || null,
    note: debt?.note || null,
    entries: Array.isArray(debt?.entries) ? debt.entries : [],
  });
}

function remediationForGateFinding(finding) {
  return remediation(gateFindingCode(finding), {
    gate: finding?.gate || null,
    feature: finding?.feature || null,
    file: finding?.sourceFile || finding?.file || null,
    message: finding?.message || null,
  });
}

module.exports = {
  CONTRACT_VERSION,
  CONTRACTS,
  DASHBOARD_METRICS,
  GATE_FAMILY_MAP,
  CI_REQUIRED,
  backendDebtCode,
  gateFindingCode,
  remediation,
  remediationForBackendDebt,
  remediationForGateFinding,
};

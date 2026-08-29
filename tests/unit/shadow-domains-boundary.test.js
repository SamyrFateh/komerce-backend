'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * Boundary test — Vague 1 Shadow (PR A + PR B)
 *
 * Objectif : empêcher une régression SILENCIEUSE où local-stock ou
 * providers-services deviendraient joignables depuis un chemin HTTP ou
 * un fichier Boutique SANS décision explicite de Vague 2 (exposition
 * graduelle, IMPACT_FEATURE_FIRST_DISCOVERY_LOCALE.md §9).
 *
 * Ce n'est pas un test sur le COMPORTEMENT des services (déjà couvert par
 * local-stock-service.test.js / providers-service.test.js) — c'est un test
 * sur leur ABSENCE de tout branchement. S'il échoue un jour, c'est que
 * quelqu'un a commencé la Vague 2 sans le décider consciemment : le test
 * doit alors être retiré/adapté comme preuve que la décision a été prise,
 * pas contourné silencieusement.
 *
 * Méthode : analyse statique du texte source, pas de mock, pas de require —
 * un import mocké resterait invisible à un scan par require() réel, alors
 * qu'une chaîne de caractères dans le fichier ne peut pas se cacher.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const SHADOW_SERVICES = ['local-stock-service', 'providers-service'];
const SHADOW_TABLES = ['local_stock', 'providers', 'services', 'physical_offers', 'inquiries'];
// Conventions kebab-case réellement utilisées pour TOUTES les routes REST de
// ce dépôt (/api/admin-costing, /api/auto-distribute, etc.) — distinct des
// noms de table snake_case. Une fuite réelle via fetch()/apiPost() prendrait
// cette forme, jamais le nom de table brut.
const SHADOW_URL_SEGMENTS = ['local-stock', 'providers', 'physical-offers', 'inquiries'];

function walk(dir, exts, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, exts, out);
    else if (exts.some(e => entry.name.endsWith(e))) out.push(full);
  }
  return out;
}

describe('Shadow boundary — local-stock & providers-services (Vague 1 + Vague 2)', () => {

  // Vague 2 D2 (28-08-2026) : deux points d'intégration backend ÉCRITURE,
  // délibérés et revus — routes/orders/create.js (allocateForOrderItem,
  // dans la même transaction que la commande) et services/order-status-
  // machine.js (consumeAllocationsForOrder/releaseAllocationsForOrder, sur
  // les transitions confirmed/cancelled déjà existantes).
  const ALLOWED_WRITE_CONSUMERS = [
    'routes/orders/create.js',
    'services/order-status-machine.js',
  ];

  // Vague 2 D4 (28-08-2026) : routes GET read-only shadow — testables,
  // JAMAIS montées dans bootstrap/api-routes.js (voir test dédié plus bas,
  // déjà générique et suffisant : il matche tout mount qui contiendrait le
  // mot-clé du domaine, donc protège aussi ces 2 fichiers sans modification).
  const ALLOWED_ROUTE_FILE_CONSUMERS = [
    'routes/local-stock.js',
    'routes/providers-services.js',
  ];

  // Vague 2 D5 (28-08-2026) : composition en mémoire du rail Discovery local
  // (DiscoveryCard) — recommendations lit l'exposabilité via les fonctions
  // propriétaires, jamais de SQL direct sur local_stock/services/
  // physical_offers. Jamais branché à une route ou à Boutique dans ce lot.
  const ALLOWED_COMPOSITION_CONSUMERS = [
    'services/discovery-rail-composer.js',
  ];

  // Vague 2 D6 (28-08-2026) : bootstrap/api-routes.js monte désormais les
  // deux routes GET (routes/local-stock.js, routes/providers-services.js)
  // — capability != exposure, le montage rend la capacité joignable,
  // commercial_exposure=DISABLED partout garde tout invisible. Décision
  // délibérée et revue, pas une fuite : voir les 2 tests D6 dédiés
  // ci-dessous pour la preuve du montage GET-only.
  const ALLOWED_BOOTSTRAP_CONSUMERS = [
    'bootstrap/api-routes.js',
  ];

  const ALLOWED_LOCAL_STOCK_CONSUMERS = [
    ...ALLOWED_WRITE_CONSUMERS, ...ALLOWED_ROUTE_FILE_CONSUMERS,
    ...ALLOWED_COMPOSITION_CONSUMERS, ...ALLOWED_BOOTSTRAP_CONSUMERS,
  ];

  test('aucune route (routes/) ne require() les services shadow, sauf les points d\'intégration D2/D4 revus', () => {
    const routeFiles = walk(path.join(ROOT, 'routes'), ['.js']);
    const offenders = [];
    for (const file of routeFiles) {
      const rel = path.relative(ROOT, file);
      const src = fs.readFileSync(file, 'utf8');
      for (const svc of SHADOW_SERVICES) {
        if (src.includes(svc) && !ALLOWED_LOCAL_STOCK_CONSUMERS.includes(rel)) {
          offenders.push(`${rel} → ${svc}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  // Ancien test "bootstrap/api-routes.js ne monte aucune route pour les
  // domaines shadow" retiré à D6 : sa prémisse (jamais montées) contredit
  // directement la décision délibérée de cette vague. Remplacé par les deux
  // tests D6 ci-dessous (montage confirmé + GET-only + market résolu serveur).

  test('aucun fichier Boutique (JS) ne référence les services shadow ou leurs tables', () => {
    // Vague 2 D6 : discovery-api.js mentionne légitimement l'URL /api/
    // providers-services (route réelle, pluriel) — qui contient
    // "providers-service" (singulier, SHADOW_SERVICES) comme sous-chaîne
    // par pure coïncidence de nommage, pas une fuite vers le fichier
    // service backend lui-même (que le frontend ne peut de toute façon
    // jamais require() — ce test protège contre une mention textuelle
    // accidentelle, pas contre un vrai import impossible en navigateur).
    const ALLOWED_URL_MENTION_FILES = [
      'public/boutique/js/discovery-api.js',
    ];
    const boutiqueFiles = walk(path.join(ROOT, 'public', 'boutique', 'js'), ['.js']);
    const featureFiles = walk(path.join(ROOT, 'public', 'boutique', 'features'), ['.js']);
    const offenders = [];
    for (const file of [...boutiqueFiles, ...featureFiles]) {
      const rel = path.relative(ROOT, file);
      if (ALLOWED_URL_MENTION_FILES.includes(rel)) continue;
      const src = fs.readFileSync(file, 'utf8');
      for (const svc of SHADOW_SERVICES) {
        if (src.includes(svc)) offenders.push(`${rel} → ${svc}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test('aucun fichier Boutique n\'appelle une URL /api/<segment-kebab-case> des domaines shadow, sauf le point d\'intégration D6 revu (fetch/apiGet/apiPost)', () => {
    // C'est le vecteur de fuite le plus réaliste : toutes les routes REST de
    // ce dépôt suivent une convention kebab-case (/api/admin-costing,
    // /api/auto-distribute...), jamais le nom de table snake_case brut.
    // Prouvé nécessaire par un test volontairement cassé : une fuite simulée
    // via fetch('/api/local-stock/foo') n'était pas détectée avant ce test.
    //
    // Vague 2 D6 (28-08-2026) : discovery-api.js EST le point d'intégration
    // frontend délibéré et revu — la seule frontière autorisée à appeler ces
    // URLs. local-stock-badge.js les appelle uniquement via discovery-api.js
    // (jamais un fetch direct), donc reste hors de cette liste par
    // construction, mais un futur composant qui contournerait discovery-
    // api.js pour un fetch direct serait détecté ici.
    const ALLOWED_FRONTEND_URL_CONSUMERS = [
      'public/boutique/js/discovery-api.js',
    ];
    const boutiqueFiles = walk(path.join(ROOT, 'public', 'boutique', 'js'), ['.js']);
    const offenders = [];
    for (const file of boutiqueFiles) {
      const rel = path.relative(ROOT, file);
      if (ALLOWED_FRONTEND_URL_CONSUMERS.includes(rel)) continue;
      const src = fs.readFileSync(file, 'utf8');
      for (const segment of SHADOW_URL_SEGMENTS) {
        const re = new RegExp(`/api/${segment}\\b`, 'i');
        if (re.test(src)) offenders.push(`${rel} → "/api/${segment}"`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test('aucun fichier Boutique ne référence directement les tables shadow en contexte SQL/requête', () => {
    // Volontairement plus précis qu'un simple mot entier : 'local_stock' est
    // par coïncidence déjà un littéral UI existant (fulfillmentType de badge
    // produit, product-card-view-model.js) — un concept d'affichage sans
    // aucun lien avec la table backend. Un mot entier suffirait à déclencher
    // un faux positif dessus. On cible donc un contexte de requête réel :
    // FROM/JOIN/INTO suivi du nom de table, ou une URL /api/<table>.
    //
    // Vague 2 D6 : discovery-api.js fait un second faux positif par un
    // mécanisme voisin — l'URL réelle /api/providers-services/services/...
    // matche accidentellement /api/providers\b (le trait d'union après
    // "providers" est une frontière de mot valide pour \b). C'est le point
    // d'intégration légitime (déjà validé par les 2 tests dédiés D6
    // ci-dessus), pas une fuite vers la table providers elle-même.
    const ALLOWED_URL_MENTION_FILES = [
      'public/boutique/js/discovery-api.js',
    ];
    const boutiqueFiles = walk(path.join(ROOT, 'public', 'boutique', 'js'), ['.js']);
    const offenders = [];
    for (const file of boutiqueFiles) {
      const rel = path.relative(ROOT, file);
      if (ALLOWED_URL_MENTION_FILES.includes(rel)) continue;
      const src = fs.readFileSync(file, 'utf8');
      for (const table of SHADOW_TABLES) {
        const sqlContext = new RegExp(`(FROM|JOIN|INTO)\\s+${table}\\b`, 'i');
        const urlContext = new RegExp(`/api/${table}\\b`, 'i');
        if (sqlContext.test(src) || urlContext.test(src)) {
          offenders.push(`${rel} → "${table}" (contexte requête/URL)`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test('local-stock-service.js et providers-service.js ne sont require() que par les points d\'intégration D2/D4 revus', () => {
    const allJs = walk(ROOT, ['.js'])
      .filter(f => !f.includes(`${path.sep}node_modules${path.sep}`))
      .filter(f => !f.includes(`${path.sep}tests${path.sep}`))
      .filter(f => !f.includes(`${path.sep}scripts${path.sep}`))
      .filter(f => !f.endsWith(`${path.sep}local-stock-service.js`))
      .filter(f => !f.endsWith(`${path.sep}providers-service.js`));

    const offenders = [];
    for (const file of allJs) {
      const rel = path.relative(ROOT, file);
      const src = fs.readFileSync(file, 'utf8');
      if (/require\(.*local-stock-service/.test(src) && !ALLOWED_LOCAL_STOCK_CONSUMERS.includes(rel)) {
        offenders.push(`${rel} → local-stock-service`);
      }
      // Vague 2 D4 : routes/providers-services.js require() légitimement
      // providers-service désormais (route GET shadow, jamais montée) —
      // même allowlist que local-stock-service, plus le même filet.
      if (/require\(.*providers-service/.test(src) && !ALLOWED_LOCAL_STOCK_CONSUMERS.includes(rel)) {
        offenders.push(`${rel} → providers-service`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test('migration 155 — commercial_exposure reste DISABLED par défaut dans le schéma source', () => {
    const migration = fs.readFileSync(
      path.join(ROOT, 'migrations', '155_providers_services_shadow.sql'), 'utf8'
    );
    expect(migration).toMatch(/commercial_exposure\s+text\s+NOT\s+NULL\s+DEFAULT\s+'DISABLED'/i);
  });

  test('migration 156 — physical_offers.commercial_exposure reste DISABLED par défaut, même patron que services', () => {
    const migration = fs.readFileSync(
      path.join(ROOT, 'migrations', '156_physical_offers_and_neutral_inquiries.sql'), 'utf8'
    );
    expect(migration).toMatch(/commercial_exposure\s+text\s+NOT\s+NULL\s+DEFAULT\s+'DISABLED'/i);
  });

  test('migration 156 — inquiries porte bien la contrainte exactement-une-cible (num_nonnulls)', () => {
    const migration = fs.readFileSync(
      path.join(ROOT, 'migrations', '156_physical_offers_and_neutral_inquiries.sql'), 'utf8'
    );
    expect(migration).toMatch(/CHECK\s*\(\s*num_nonnulls\(service_id,\s*physical_offer_id\)\s*=\s*1\s*\)/i);
    // offer_type / offer_id (association polymorphe rejetée) ne doit jamais
    // apparaître comme une VRAIE colonne SQL — seulement en commentaire
    // explicatif (pourquoi ce modèle a été écarté). On cible une déclaration
    // réelle (nom de colonne suivi d'un type), pas n'importe quelle occurrence
    // du mot dans un commentaire.
    expect(migration).not.toMatch(/\boffer_type\s+(text|uuid|varchar)/i);
  });

  test('les deux manifests déclarent explicitement status=staging (pas production) tant que la Vague 2 n\'a pas eu lieu', () => {
    const localStock = require('../../features/local-stock.feature.js');
    const providersServices = require('../../features/providers-services.feature.js');
    expect(localStock.status).toBe('staging');
    expect(providersServices.status).toBe('staging');
  });

  test('Vague 2 D6 — routes/local-stock.js et routes/providers-services.js sont désormais montées dans bootstrap/api-routes.js, exclusivement en lecture', () => {
    // Ère D4 : "jamais montées" (routes shadow, inaccessibles). Ère D6 :
    // le montage EST la décision explicite de cette vague — capability !=
    // exposure, l'invisibilité vient de commercial_exposure=DISABLED et de
    // l'absence de candidats réels, jamais de l'absence de route. Ce test
    // remplace l'ancien "jamais montées" par sa preuve inverse, et vérifie
    // que le montage reste strictement GET-only (aucune mutation possible
    // via ces deux chemins, même une fois montés).
    expect(fs.existsSync(path.join(ROOT, 'routes', 'local-stock.js'))).toBe(true);
    expect(fs.existsSync(path.join(ROOT, 'routes', 'providers-services.js'))).toBe(true);
    expect(() => require('../../routes/local-stock.js')).not.toThrow();
    expect(() => require('../../routes/providers-services.js')).not.toThrow();

    const bootstrapSrc = fs.readFileSync(path.join(ROOT, 'bootstrap', 'api-routes.js'), 'utf8');
    expect(bootstrapSrc).toMatch(/app\.use\(\s*['"]\/api\/local-stock['"]\s*,\s*localStockRouter\s*\)/);
    expect(bootstrapSrc).toMatch(/app\.use\(\s*['"]\/api\/providers-services['"]\s*,\s*providersServicesRouter\s*\)/);

    const localStockSrc = fs.readFileSync(path.join(ROOT, 'routes', 'local-stock.js'), 'utf8');
    const providersServicesSrc = fs.readFileSync(path.join(ROOT, 'routes', 'providers-services.js'), 'utf8');
    for (const src of [localStockSrc, providersServicesSrc]) {
      expect(src).not.toMatch(/router\.(post|put|patch|delete)\(/);
    }
  });

  test('Vague 2 D6 — les deux routes montées ne font jamais confiance à un market_id brut, market reste un CODE résolu serveur', () => {
    const localStockSrc = fs.readFileSync(path.join(ROOT, 'routes', 'local-stock.js'), 'utf8');
    const providersServicesSrc = fs.readFileSync(path.join(ROOT, 'routes', 'providers-services.js'), 'utf8');
    for (const src of [localStockSrc, providersServicesSrc]) {
      expect(src).toMatch(/resolveMarketId/);
      expect(src).not.toMatch(/req\.query\.market_id/);
    }
  });

});

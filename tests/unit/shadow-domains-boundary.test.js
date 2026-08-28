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

describe('Shadow boundary — local-stock & providers-services (Vague 1)', () => {

  test('aucune route (routes/) ne require() les services shadow', () => {
    const routeFiles = walk(path.join(ROOT, 'routes'), ['.js']);
    const offenders = [];
    for (const file of routeFiles) {
      const src = fs.readFileSync(file, 'utf8');
      for (const svc of SHADOW_SERVICES) {
        if (src.includes(svc)) offenders.push(`${path.relative(ROOT, file)} → ${svc}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test('bootstrap/api-routes.js ne monte aucune route pour les domaines shadow', () => {
    const src = fs.readFileSync(path.join(ROOT, 'bootstrap', 'api-routes.js'), 'utf8');
    expect(src).not.toMatch(/local-stock/i);
    expect(src).not.toMatch(/providers-service/i);
    expect(src).not.toMatch(/\/api\/local-stock/i);
    expect(src).not.toMatch(/\/api\/providers/i);
    expect(src).not.toMatch(/\/api\/services/i);
    expect(src).not.toMatch(/\/api\/inquiries/i);
  });

  test('aucun fichier Boutique (JS) ne référence les services shadow ou leurs tables', () => {
    const boutiqueFiles = walk(path.join(ROOT, 'public', 'boutique', 'js'), ['.js']);
    const featureFiles = walk(path.join(ROOT, 'public', 'boutique', 'features'), ['.js']);
    const offenders = [];
    for (const file of [...boutiqueFiles, ...featureFiles]) {
      const src = fs.readFileSync(file, 'utf8');
      for (const svc of SHADOW_SERVICES) {
        if (src.includes(svc)) offenders.push(`${path.relative(ROOT, file)} → ${svc}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test('aucun fichier Boutique n\'appelle une URL /api/<segment-kebab-case> des domaines shadow (fetch/apiGet/apiPost)', () => {
    // C'est le vecteur de fuite le plus réaliste : toutes les routes REST de
    // ce dépôt suivent une convention kebab-case (/api/admin-costing,
    // /api/auto-distribute...), jamais le nom de table snake_case brut.
    // Prouvé nécessaire par un test volontairement cassé : une fuite simulée
    // via fetch('/api/local-stock/foo') n'était pas détectée avant ce test.
    const boutiqueFiles = walk(path.join(ROOT, 'public', 'boutique', 'js'), ['.js']);
    const offenders = [];
    for (const file of boutiqueFiles) {
      const src = fs.readFileSync(file, 'utf8');
      for (const segment of SHADOW_URL_SEGMENTS) {
        const re = new RegExp(`/api/${segment}\\b`, 'i');
        if (re.test(src)) offenders.push(`${path.relative(ROOT, file)} → "/api/${segment}"`);
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
    const boutiqueFiles = walk(path.join(ROOT, 'public', 'boutique', 'js'), ['.js']);
    const offenders = [];
    for (const file of boutiqueFiles) {
      const src = fs.readFileSync(file, 'utf8');
      for (const table of SHADOW_TABLES) {
        const sqlContext = new RegExp(`(FROM|JOIN|INTO)\\s+${table}\\b`, 'i');
        const urlContext = new RegExp(`/api/${table}\\b`, 'i');
        if (sqlContext.test(src) || urlContext.test(src)) {
          offenders.push(`${path.relative(ROOT, file)} → "${table}" (contexte requête/URL)`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test('services/local-stock-service.js et services/providers-service.js ne sont require() par AUCUN fichier hors tests/scripts', () => {
    const allJs = walk(ROOT, ['.js'])
      .filter(f => !f.includes(`${path.sep}node_modules${path.sep}`))
      .filter(f => !f.includes(`${path.sep}tests${path.sep}`))
      .filter(f => !f.includes(`${path.sep}scripts${path.sep}`))
      .filter(f => !f.endsWith(`${path.sep}local-stock-service.js`))
      .filter(f => !f.endsWith(`${path.sep}providers-service.js`));

    const offenders = [];
    for (const file of allJs) {
      const src = fs.readFileSync(file, 'utf8');
      if (/require\(.*local-stock-service/.test(src)) offenders.push(`${path.relative(ROOT, file)} → local-stock-service`);
      if (/require\(.*providers-service/.test(src)) offenders.push(`${path.relative(ROOT, file)} → providers-service`);
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

});

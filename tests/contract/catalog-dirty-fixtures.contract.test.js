'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/contract/catalog-dirty-fixtures.contract.test.js
 *
 * ING-3 — Corpus de fixtures sales (doctrine ING-I7 : « les tests attaquent,
 * ils ne documentent pas »). Chaque fixture de tests/fixtures/catalog/ est un
 * incident fournisseur réel ou plausible (audit ingestion 2026-07-04). Ce
 * fichier rejoue le connecteur RÉEL (services/suppliers/connectors/csv-connector.js)
 * sur chaque fixture et vérifie que le sale ne passe jamais en silence.
 *
 * Contrat vérifié à chaque fixture :
 *   - compte d'acceptés / rejetés
 *   - raisons de rejet (au moins un mot-clé attendu par ligne rejetée)
 *   - intégrité des noms/prix pour les lignes acceptées (aucune corruption)
 *
 * ING-I7 : ce corpus grandit à chaque incident réel, il ne rétrécit jamais
 * (doctrine §7). N'assouplissez jamais une assertion ici pour faire passer
 * un connecteur qui aurait régressé — corrigez le connecteur.
 *
 * Note d'implémentation : contrairement à la table de
 * CHANTIERS_INGESTION_CATALOGUE.md qui regroupe "SKU dupliqués" et "headers
 * dupliqués" dans un seul fixture `dirty-duplicates.csv`, ces deux cas sont
 * répartis ici sur deux fichiers distincts (`dirty-duplicates.csv` +
 * `dirty-duplicate-headers.csv`) : un header dupliqué fait échouer le parsing
 * du fichier ENTIER avant même d'atteindre la déduplication SKU (voir
 * csv-connector.js), les deux comportements ne sont donc jamais observables
 * dans la même exécution. Aucune perte de couverture — les deux cas restent
 * testés, chacun dans son fichier.
 */

const fs = require('fs');
const path = require('path');
const { fetchProducts } = require('../../services/suppliers/connectors/csv-connector');

const FIXTURES_DIR = path.join(__dirname, '../fixtures/catalog');

function loadFixture(name) {
  return fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf8');
}

function run(fixtureName, supplierName = 'Fixture Supplier') {
  const csvText = loadFixture(fixtureName);
  return fetchProducts({ supplier_name: supplierName, csv_text: csvText });
}

/** Concatène toutes les raisons d'erreur d'un résultat invalid[] en une seule chaîne (pour .toContain / regex). */
function allReasons(invalid) {
  return invalid.flatMap(i => i.errors || [i.error]).join(' | ');
}

describe('Corpus de fixtures sales — catalogue (ING-3)', () => {
  it('dirty-commas-quotes.csv — virgules/guillemets/multi-lignes → noms et prix intacts, 0 corruption', () => {
    const result = run('dirty-commas-quotes.csv');
    expect(result.invalid).toEqual([]);
    expect(result.products).toHaveLength(3);

    const byName = Object.fromEntries(result.products.map(p => [p.product_name, p]));
    expect(byName['Casque, Bluetooth Pro'].purchase_price).toBe(5000);
    expect(byName['Support "Premium" XL'].purchase_price).toBe(3000);
    expect(byName['Support "Premium" XL'].description).toBe('Multi-lignes\nDescription ligne 2');
    expect(byName['Enceinte, Compacte, Noire'].purchase_price).toBe(4500);
  });

  it('dirty-currencies.csv — devise absente/inconnue rejetée motivée ; minuscule acceptée et normalisée', () => {
    const result = run('dirty-currencies.csv');

    expect(result.products).toHaveLength(1);
    expect(result.products[0].product_name).toBe('Enceinte');
    expect(result.products[0].currency).toBe('USD'); // 'usd' -> normalisé majuscule

    expect(result.invalid).toHaveLength(3); // absente, GBP (hors enum), "120 USD" non numérique
    const reasons = allReasons(result.invalid);
    expect(reasons).toMatch(/devise absente/);
    expect(reasons).toMatch(/currency doit être AED, EUR, USD ou KMF/); // GBP rejeté par le contrat v1
    expect(reasons).toMatch(/purchase_price non numérique/); // "120 USD"
  });

  it('dirty-stock.csv — négatif (bornes contrat) et illisible (parsing) : tous rejetés, aucun null silencieux', () => {
    const result = run('dirty-stock.csv');

    expect(result.products).toEqual([]);
    expect(result.invalid).toHaveLength(5);
    const reasons = allReasons(result.invalid);
    expect(reasons).toMatch(/stock_available hors bornes \[0, ∞\)/); // -50 : rejeté par le contrat (bornes)
    expect(reasons).toMatch(/stock_available non entier/); // many / yes / 12 units / 12.9
  });

  it('dirty-duplicates.csv — SKU dupliqué rejeté bruyamment, colonne d\'une lettre conservée en raw_payload', () => {
    const result = run('dirty-duplicates.csv');

    expect(result.products).toHaveLength(2);
    expect(result.products.map(p => p.product_name)).toEqual(['Casque', 'Enceinte']);
    expect(result.products[0].raw_payload.a).toBe('x'); // colonne 1 lettre conservée intégralement

    expect(result.invalid).toHaveLength(1);
    expect(allReasons(result.invalid)).toMatch(/duplicate_sku_in_file/);
  });

  it('dirty-duplicate-headers.csv — en-têtes dupliqués (price,price) → import refusé en bloc', () => {
    expect(() => run('dirty-duplicate-headers.csv')).toThrow(/en-têtes dupliqués/);
  });

  it('dirty-extremes.csv — poids/prix/titre/dimensions hors bornes → tous rejetés par le contrat', () => {
    const result = run('dirty-extremes.csv');

    expect(result.products).toEqual([]);
    expect(result.invalid).toHaveLength(4);
    const reasons = allReasons(result.invalid);
    expect(reasons).toMatch(/purchase_price doit être un nombre positif/); // prix 0
    expect(reasons).toMatch(/purchase_price hors bornes \(0, 10000000\]/); // prix 999999999 hors borne haute
    expect(reasons).toMatch(/weight_kg/); // poids 0 et 25000 hors bornes
    expect(reasons).toMatch(/product_name/); // titre 500 caractères hors borne
    expect(reasons).toMatch(/dimensions/); // w_cm 90000 hors borne
  });

  it('dirty-hazmat-hidden.csv — colonnes non mappées vitales conservées en raw_payload + signalées', () => {
    const result = run('dirty-hazmat-hidden.csv');

    expect(result.products).toHaveLength(1);
    expect(result.invalid).toEqual([]);
    const product = result.products[0];
    expect(product.raw_payload.hazmat_class).toBe('none');
    expect(product.raw_payload.battery_type).toBe('li-ion');
    expect(result.unmapped_columns).toEqual(expect.arrayContaining(['hazmat_class', 'battery_type']));
  });

  it('clean-baseline.csv — 20 lignes parfaites → 20/20 acceptées (anti-régression : le strict ne rejette pas le propre)', () => {
    const result = run('clean-baseline.csv');
    expect(result.products).toHaveLength(20);
    expect(result.invalid).toEqual([]);
    expect(result.products.every(p => p.currency === 'AED')).toBe(true);
    expect(result.products[0].product_name).toBe('Produit 1');
    expect(result.products[19].product_name).toBe('Produit 20');
  });
});

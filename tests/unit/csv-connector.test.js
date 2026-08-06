'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/csv-connector.test.js
 * Couvre services/suppliers/connectors/csv-connector.js (ING-2)
 *
 * Connecteur fonctionnel pur (pas de DB, pas de mock nécessaire) :
 * parseCSVRows → rowsToNormalized → fetchProducts (délègue à partitionValid
 * de normalized-product.js, lui aussi pur — comportement réel testé).
 *
 * ING-2 inverse plusieurs tests qui verrouillaient les failles de l'ancien
 * connecteur (colonnes inconnues ignorées, devise inventée, champs
 * numériques droppés silencieusement) — chaque cas ci-dessous documente
 * explicitement le AVANT/APRÈS dans son titre quand c'est un renversement.
 */

const {
  fetchProducts,
  parseCSVRows,
  rowsToNormalized,
  DEFAULT_HEADER_ALIASES,
} = require('../../services/suppliers/connectors/csv-connector');

describe('parseCSVRows', () => {
  it('csvText vide/null/undefined → rows/invalid/unmappedColumns vides', () => {
    expect(parseCSVRows('')).toEqual({ rows: [], invalid: [], unmappedColumns: [] });
    expect(parseCSVRows(null)).toEqual({ rows: [], invalid: [], unmappedColumns: [] });
    expect(parseCSVRows(undefined)).toEqual({ rows: [], invalid: [], unmappedColumns: [] });
  });

  it('csvText non-string → vide', () => {
    expect(parseCSVRows(42)).toEqual({ rows: [], invalid: [], unmappedColumns: [] });
  });

  it('une seule ligne (headers seuls, pas de données) → vide', () => {
    expect(parseCSVRows('name,price')).toEqual({ rows: [], invalid: [], unmappedColumns: [] });
  });

  it('CSV séparé par virgules, headers anglais → mappe correctement', () => {
    const csv = 'name,price,stock,currency\nCasque,5000,10,AED';
    const { rows } = parseCSVRows(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(expect.objectContaining({
      product_name: 'Casque', purchase_price: 5000, stock_available: 10,
    }));
  });

  it('CSV séparé par point-virgules (auto-détection)', () => {
    const csv = 'name;price;currency\nCasque;5000;AED';
    const { rows } = parseCSVRows(csv);
    expect(rows[0]).toEqual(expect.objectContaining({ product_name: 'Casque', purchase_price: 5000 }));
  });

  it('headers français reconnus via DEFAULT_HEADER_ALIASES', () => {
    const csv = 'nom,prix_achat,categorie,devise\nCasque,5000,Audio,AED';
    const { rows } = parseCSVRows(csv);
    expect(rows[0]).toEqual(expect.objectContaining({
      product_name: 'Casque', purchase_price: 5000, supplier_category: 'Audio',
    }));
  });

  it('headers insensibles à la casse', () => {
    const csv = 'NAME,PRICE,CURRENCY\nCasque,5000,AED';
    const { rows } = parseCSVRows(csv);
    expect(rows[0].product_name).toBe('Casque');
  });

  it('plusieurs lignes de données → une entrée par ligne, dans l\'ordre', () => {
    const csv = 'name,price,currency\nA,100,AED\nB,200,AED\nC,300,AED';
    const { rows } = parseCSVRows(csv);
    expect(rows.map(r => r.product_name)).toEqual(['A', 'B', 'C']);
  });

  it('ligne sans product_name → exclue du résultat (pas une erreur — ligne vide)', () => {
    const csv = 'name,price,currency\n,100,AED\nB,200,AED';
    const { rows, invalid } = parseCSVRows(csv);
    expect(rows).toEqual([expect.objectContaining({ product_name: 'B' })]);
    expect(invalid).toEqual([]);
  });

  it('lignes vides (blank lines) → ignorées', () => {
    const csv = 'name,price,currency\nA,100,AED\n\n\nB,200,AED';
    const { rows } = parseCSVRows(csv);
    expect(rows).toHaveLength(2);
  });

  it('virgule dans un titre entre guillemets (papaparse RFC-4180) → nom intact, prix intact', () => {
    const csv = 'name,price,currency\n"Casque, Bluetooth Pro",5000,AED';
    const { rows } = parseCSVRows(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].product_name).toBe('Casque, Bluetooth Pro');
    expect(rows[0].purchase_price).toBe(5000);
  });

  it('valeur multi-lignes entre guillemets → préservée sans corrompre les lignes suivantes', () => {
    const csv = 'name,description,currency\nCasque,"Ligne1\nLigne2",AED\nEnceinte,ok,AED';
    const { rows } = parseCSVRows(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0].description).toBe('Ligne1\nLigne2');
    expect(rows[1].product_name).toBe('Enceinte');
  });

  it('champ numérique avec virgule décimale (FR) → convertie en point', () => {
    const csvSemi = 'name;weight;currency\nCasque;1,5;AED';
    const { rows } = parseCSVRows(csvSemi);
    expect(rows[0].weight_kg).toBe(1.5);
  });

  // ── ING-2 : renversement — un champ illisible REJETTE la ligne ──────────

  it('[AVANT: ignoré][APRÈS: rejeté] champ numérique invalide ("non-numerique") → ligne en invalid, pas droppée', () => {
    const csv = 'name,price,currency\nCasque,non-numerique,AED';
    const { rows, invalid } = parseCSVRows(csv);
    expect(rows).toEqual([]);
    expect(invalid).toHaveLength(1);
    expect(invalid[0].errors).toEqual(
      expect.arrayContaining([expect.stringContaining('purchase_price non numérique')])
    );
  });

  it('[AVANT: ignoré][APRÈS: rejeté] "120 USD" en colonne prix → non numérique, ligne rejetée', () => {
    const csv = 'name,price,currency\nCasque,120 USD,AED';
    const { invalid } = parseCSVRows(csv);
    expect(invalid).toHaveLength(1);
    expect(invalid[0].errors[0]).toContain('purchase_price non numérique');
  });

  it('[AVANT: ignoré][APRÈS: rejeté] stock "beaucoup" → non entier, ligne rejetée', () => {
    const csv = 'name,stock,currency\nCasque,beaucoup,AED';
    const { invalid } = parseCSVRows(csv);
    expect(invalid).toHaveLength(1);
    expect(invalid[0].errors[0]).toContain('stock_available non entier');
  });

  it('stock "12.9" (décimal) → non entier, ligne rejetée', () => {
    const csv = 'name,stock,currency\nCasque,12.9,AED';
    const { invalid } = parseCSVRows(csv);
    expect(invalid).toHaveLength(1);
    expect(invalid[0].errors[0]).toContain('stock_available non entier');
  });

  it('stock "-50" → numériquement valide (le rejet de la borne est au contrat, pas ici)', () => {
    const csv = 'name,stock,currency\nCasque,-50,AED';
    const { rows, invalid } = parseCSVRows(csv);
    expect(invalid).toEqual([]);
    expect(rows[0].stock_available).toBe(-50);
  });

  // ── ING-2 : renversement — colonnes inconnues conservées + signalées ────

  it('[AVANT: ignorées silencieusement][APRÈS: conservées + signalées] colonnes sans alias → dans raw_payload et unmappedColumns', () => {
    const csv = 'name,currency,couleur_preferee\nCasque,AED,bleu';
    const { rows, unmappedColumns } = parseCSVRows(csv);
    expect(rows[0].raw_payload).toEqual({ name: 'Casque', currency: 'AED', couleur_preferee: 'bleu' });
    expect(unmappedColumns).toEqual(['couleur_preferee']);
  });

  it('raw_payload contient TOUTES les colonnes, y compris non mappées (hazmat caché — ING-I3)', () => {
    const csv = 'name,currency,hazmat_class,battery_type\nCasque,AED,none,li-ion';
    const { rows } = parseCSVRows(csv);
    expect(rows[0].raw_payload).toEqual({ name: 'Casque', currency: 'AED', hazmat_class: 'none', battery_type: 'li-ion' });
  });

  it('customMapping → force le mapping même si le header ne matche pas les alias par défaut', () => {
    const csv = 'libelle,montant,devise\nCasque,5000,AED';
    const { rows } = parseCSVRows(csv, { product_name: 'libelle', purchase_price: 'montant', currency: 'devise' });
    expect(rows[0]).toEqual(expect.objectContaining({ product_name: 'Casque', purchase_price: 5000 }));
  });

  it('customMapping insensible à la casse', () => {
    const csv = 'LIBELLE,DEVISE\nCasque,AED';
    const { rows } = parseCSVRows(csv, { product_name: 'libelle', currency: 'devise' });
    expect(rows[0].product_name).toBe('Casque');
  });

  it('retours chariot Windows (\\r\\n) → gérés comme \\n', () => {
    const csv = 'name,price,currency\r\nCasque,5000,AED\r\nEnceinte,8000,AED';
    const { rows } = parseCSVRows(csv);
    expect(rows).toHaveLength(2);
  });

  it('toutes les colonnes DEFAULT_HEADER_ALIASES sont mappables', () => {
    const fields = Object.keys(DEFAULT_HEADER_ALIASES);
    expect(fields).toContain('product_name');
    expect(fields).toContain('purchase_price');
    expect(fields).toContain('supplier_product_id');
    expect(fields.length).toBe(15);
  });

  // ── ING-2 : renversement — devise absente n'est plus un défaut AED ──────

  it('[AVANT: défaut AED][APRÈS: rejeté] devise absente → ligne rejetée avec raison explicite', () => {
    const csv = 'name,price\nCasque,5000';
    const { rows, invalid } = parseCSVRows(csv);
    expect(rows).toEqual([]);
    expect(invalid).toHaveLength(1);
    expect(invalid[0].errors).toEqual(
      expect.arrayContaining([expect.stringContaining('devise absente')])
    );
  });

  it('devise en minuscule ("usd") → acceptée, normalisée en majuscule par rowsToNormalized', () => {
    const csv = 'name,price,currency\nCasque,5000,usd';
    const { rows } = parseCSVRows(csv);
    expect(rows[0].currency).toBe('usd'); // uppercase appliqué en aval (rowsToNormalized)
  });

  // ── ING-2 : en-têtes dupliqués → import refusé en bloc ──────────────────

  it('[AVANT: première colonne gagne silencieusement][APRÈS: throw] en-têtes dupliqués (price,price) → import refusé', () => {
    const csv = 'name,price,price\nCasque,5000,6000';
    expect(() => parseCSVRows(csv)).toThrow(/en-têtes dupliqués/);
  });

  it('en-têtes dupliqués insensibles à la casse (Price,price) → détectés', () => {
    const csv = 'name,Price,price\nCasque,5000,6000';
    expect(() => parseCSVRows(csv)).toThrow(/en-têtes dupliqués/);
  });

  // ── ING-2 : ligne malformée (nombre de colonnes ≠ en-têtes) ─────────────

  it('ligne avec moins de colonnes que les en-têtes → rejetée motif malformée', () => {
    const csv = 'name,price,currency\nCasque';
    const { rows, invalid } = parseCSVRows(csv);
    expect(rows).toEqual([]);
    expect(invalid).toHaveLength(1);
    expect(invalid[0].errors[0]).toContain('ligne malformée');
  });

  it('ligne avec plus de colonnes que les en-têtes → rejetée motif malformée', () => {
    const csv = 'name,price\nCasque,5000,en-trop';
    const { invalid } = parseCSVRows(csv);
    expect(invalid).toHaveLength(1);
    expect(invalid[0].errors[0]).toContain('ligne malformée');
  });

  // ── ING-2 : doublon SKU intra-fichier ────────────────────────────────────

  it('SKU dupliqué → la première ligne gagne, la suivante rejetée bruyamment', () => {
    const csv = 'name,sku,price,currency\nCasque,SKU1,5000,AED\nCasque V2,SKU1,6000,AED';
    const { rows, invalid } = parseCSVRows(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].product_name).toBe('Casque');
    expect(invalid).toHaveLength(1);
    expect(invalid[0].errors[0]).toContain('duplicate_sku_in_file');
  });

  it('lignes sans SKU → aucune déduplication appliquée (rien à comparer)', () => {
    const csv = 'name,price,currency\nA,100,AED\nB,200,AED';
    const { rows, invalid } = parseCSVRows(csv);
    expect(rows).toHaveLength(2);
    expect(invalid).toEqual([]);
  });
});

describe('rowsToNormalized', () => {
  it('rows null/undefined → tableau vide', () => {
    expect(rowsToNormalized(null, 'Fournisseur')).toEqual([]);
    expect(rowsToNormalized(undefined, 'Fournisseur')).toEqual([]);
  });

  it('mappe les champs simples et applique supplier_name', () => {
    const result = rowsToNormalized([{ product_name: 'Casque', purchase_price: 5000, currency: 'AED' }], 'Dragon Mart');
    expect(result[0]).toEqual(expect.objectContaining({
      supplier_name: 'Dragon Mart', product_name: 'Casque', purchase_price: 5000, currency: 'AED',
    }));
  });

  it('currency uppercase appliqué', () => {
    const r = rowsToNormalized([{ product_name: 'A', currency: 'eur' }], 'F')[0];
    expect(r.currency).toBe('EUR');
  });

  it('currency absente → null (ING-2 : plus de défaut AED)', () => {
    const r = rowsToNormalized([{ product_name: 'A' }], 'F')[0];
    expect(r.currency).toBeNull();
  });

  it('champs optionnels absents → null', () => {
    const r = rowsToNormalized([{ product_name: 'A' }], 'F')[0];
    expect(r.supplier_product_id).toBeNull();
    expect(r.supplier_category).toBeNull();
    expect(r.purchase_price).toBeNull();
    expect(r.image_url).toBeNull();
    expect(r.product_url).toBeNull();
    expect(r.description).toBeNull();
    expect(r.stock_available).toBeNull();
    expect(r.min_order_qty).toBeNull();
    expect(r.supplier_delay_days).toBeNull();
    expect(r.weight_kg).toBeNull();
    expect(r.dimensions).toBeNull();
  });

  it('regroupe les dimensions (dim_l_cm/dim_w_cm/dim_h_cm) dans un sous-objet', () => {
    const r = rowsToNormalized([{ product_name: 'A', dim_l_cm: 10, dim_w_cm: 20, dim_h_cm: 30 }], 'F')[0];
    expect(r.dimensions).toEqual({ l_cm: 10, w_cm: 20, h_cm: 30 });
  });

  it('dimensions partielles (une seule fournie) → sous-objet partiel', () => {
    const r = rowsToNormalized([{ product_name: 'A', dim_l_cm: 10 }], 'F')[0];
    expect(r.dimensions).toEqual({ l_cm: 10 });
  });

  it('aucune dimension fournie → dimensions:null', () => {
    const r = rowsToNormalized([{ product_name: 'A' }], 'F')[0];
    expect(r.dimensions).toBeNull();
  });

  it('conserve raw_payload posé par parseCSVRows (brut intégral)', () => {
    const row = { product_name: 'A', purchase_price: 100, raw_payload: { name: 'A', price: '100', extra: 'x' } };
    const r = rowsToNormalized([row], 'F')[0];
    expect(r.raw_payload).toEqual(row.raw_payload);
    expect(r.raw_payload).not.toBe(row.raw_payload); // copie, pas la même référence
  });

  it('plusieurs lignes → une entrée normalisée par ligne, dans l\'ordre', () => {
    const result = rowsToNormalized([{ product_name: 'A' }, { product_name: 'B' }], 'F');
    expect(result.map(r => r.product_name)).toEqual(['A', 'B']);
  });
});

describe('fetchProducts — intégration parse + normalize + validation', () => {
  it('supplier_name manquant → throw', () => {
    expect(() => fetchProducts({ csv_text: 'name,price\nA,1' })).toThrow('supplier_name requis');
  });

  it('supplier_name vide (espaces) → throw', () => {
    expect(() => fetchProducts({ csv_text: 'name,price\nA,1', supplier_name: '   ' })).toThrow('supplier_name requis');
  });

  it('csv_text manquant → throw', () => {
    expect(() => fetchProducts({ supplier_name: 'Fournisseur' })).toThrow('csv_text requis');
  });

  it('csv_text vide → throw', () => {
    expect(() => fetchProducts({ supplier_name: 'Fournisseur', csv_text: '' })).toThrow('csv_text requis');
  });

  it('nominal → produits valides dans products, total = nombre de lignes parsées', () => {
    const result = fetchProducts({
      supplier_name: 'Dragon Mart',
      csv_text: 'name,price,currency\nCasque,5000,AED\nEnceinte,8000,AED',
    });
    expect(result.products).toHaveLength(2);
    expect(result.invalid).toEqual([]);
    expect(result.total).toBe(2);
    expect(result.products[0].supplier_name).toBe('Dragon Mart');
    expect(result.unmapped_columns).toEqual([]);
  });

  it('produit avec currency invalide (hors enum) → rejeté dans invalid avec ses erreurs (contrat v1)', () => {
    const result = fetchProducts({ supplier_name: 'F', csv_text: 'name,currency\nCasque,XYZ' });
    expect(result.products).toEqual([]);
    expect(result.invalid).toHaveLength(1);
    expect(result.invalid[0].errors).toContain('currency doit être AED, EUR, USD ou KMF');
  });

  it('produit avec purchase_price négatif → rejeté par le contrat (bornes, pas le parsing)', () => {
    const result = fetchProducts({
      supplier_name: 'F',
      csv_text: 'name,price,currency\nCasque,-100,AED',
    });
    expect(result.invalid).toHaveLength(1);
    expect(result.invalid[0].errors).toContain('purchase_price doit être un nombre positif');
  });

  it('csv_mapping personnalisé propagé jusqu\'au parsing', () => {
    const result = fetchProducts({
      supplier_name: 'F',
      csv_text: 'libelle,devise\nCasque,AED',
      csv_mapping: { product_name: 'libelle', currency: 'devise' },
    });
    expect(result.products[0].product_name).toBe('Casque');
  });

  it('mix produits valides et invalides → partition correcte, total = somme des deux', () => {
    const result = fetchProducts({
      supplier_name: 'F',
      csv_text: 'name,currency\nValide,AED\nInvalide,XYZ',
    });
    expect(result.products).toHaveLength(1);
    expect(result.invalid).toHaveLength(1);
    expect(result.total).toBe(2);
  });

  it('CSV sans lignes de données → products/invalid vides, total 0', () => {
    const result = fetchProducts({ supplier_name: 'F', csv_text: 'name,price' });
    expect(result.products).toEqual([]);
    expect(result.invalid).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('en-têtes dupliqués → fetchProducts relaie le throw (l\'orchestrateur le transforme en 400)', () => {
    expect(() => fetchProducts({
      supplier_name: 'F',
      csv_text: 'name,price,price\nCasque,5000,6000',
    })).toThrow(/en-têtes dupliqués/);
  });

  it('devise absente sur toutes les lignes → total compte les rejets connecteur + colonnes remontées', () => {
    const result = fetchProducts({
      supplier_name: 'F',
      csv_text: 'name,couleur\nCasque,bleu\nEnceinte,rouge',
    });
    expect(result.products).toEqual([]);
    expect(result.invalid).toHaveLength(2);
    expect(result.total).toBe(2);
    expect(result.unmapped_columns).toEqual(['couleur']);
  });

  it('hazmat_class inconnu du mapping → présent dans raw_payload du produit importé', () => {
    const result = fetchProducts({
      supplier_name: 'F',
      csv_text: 'name,currency,hazmat_class\nCasque,AED,none',
    });
    expect(result.products).toHaveLength(1);
    expect(result.products[0].raw_payload).toEqual({ name: 'Casque', currency: 'AED', hazmat_class: 'none' });
    expect(result.unmapped_columns).toEqual(['hazmat_class']);
  });
});
